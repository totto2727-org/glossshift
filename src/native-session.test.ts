import { Deferred, Effect, Fiber, Option, Queue, Ref, Stream } from 'effect'
import type { BridgeEvent, BridgeModule } from 'glossshift/native'
import { expect, test } from 'nsh/test'

import { createController } from './controller'
import { connectNative } from './native-adapter'

type Session = {
  readonly id: string
  readonly closed: Deferred.Deferred<void>
  readonly events: Queue.Queue<BridgeEvent>
  readonly controls: Queue.Queue<BridgeEvent>
}
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))
const fixture = Effect.gen(function* () {
  const sequence = yield* Ref.make(0)
  const active = yield* Ref.make(Option.none<Session>())
  const waiting = yield* Queue.bounded<string>(16)
  const settled = yield* Queue.bounded<string>(16)
  const translations = yield* Queue.bounded<string>(8)
  const closed = yield* Queue.bounded<string>(8)
  const promise = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
  const close = (id: string) =>
    Effect.gen(function* () {
      yield* Queue.offer(closed, id)
      const current = yield* Ref.get(active)
      if (Option.isSome(current) && current.value.id === id) {
        yield* Deferred.succeed(current.value.closed, undefined)
        yield* Ref.set(active, Option.none())
      }
    })
  // These promises run in separate fibers. Interrupting the adapter's Effect
  // consumer alone cannot release their pending queue receives.
  const receive = (id: string, kind: 'events' | 'controls') =>
    promise(
      Effect.gen(function* () {
        const current = yield* Ref.get(active)
        if (Option.isNone(current) || current.value.id !== id) return yield* Effect.die('Stale native session')
        const session = current.value
        yield* Queue.offer(waiting, `${id}:${kind}`)
        return yield* Effect.raceFirst(
          Queue.take(session[kind]),
          Deferred.await(session.closed).pipe(Effect.andThen(Effect.die('Native session closed'))),
        ).pipe(Effect.ensuring(Queue.offer(settled, `${id}:${kind}`)))
      }),
    )
  const bootstrap = Effect.succeed({
    schemaVersion: 1,
    sourceLanguage: 'auto',
    status: 'Synthetic native session',
    accessibilityGranted: true,
    providerName: 'offline',
    shortcuts: [],
    window: { width: 560, height: 360, minWidth: 320, minHeight: 180 },
  })
  const bridge: BridgeModule = {
    initialize: () => promise(bootstrap),
    initializeTerminal: () => promise(bootstrap),
    openTransport: () =>
      promise(
        Effect.gen(function* () {
          const previous = yield* Ref.get(active)
          if (Option.isSome(previous)) yield* close(previous.value.id)
          const next = yield* Ref.updateAndGet(sequence, (value) => value + 1)
          const session = {
            id: `session-${next}`,
            closed: yield* Deferred.make<void>(),
            events: yield* Queue.bounded<BridgeEvent>(8),
            controls: yield* Queue.bounded<BridgeEvent>(8),
          }
          yield* Ref.set(active, Option.some(session))
          return session.id
        }),
      ),
    closeTransport: (id) => promise(close(id)),
    nextEvent: (id) => receive(id, 'events'),
    nextControl: (id) => receive(id, 'controls'),
    translate: (id) => promise(Queue.offer(translations, id).pipe(Effect.asVoid)),
    cancel: () => promise(Effect.void),
    selection: () => promise(Effect.die('Desktop recapture is forbidden')),
    copy: () => promise(Effect.void),
    reveal: () => promise(Effect.void),
    hide: () => promise(Effect.void),
    quit: () => promise(Effect.void),
  }
  return { bridge, waiting, settled, active, translations, closed }
})

test('native adapter closes idle non-cancellable receives and reconnects without old request-ID aliasing', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture
        const first = yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connectNative(f.bridge)
            yield* connection.commands.pipe(Stream.runDrain, Effect.forkScoped)
            yield* Effect.never
          }),
        ).pipe(Effect.forkScoped)
        yield* Queue.take(f.waiting)
        yield* Queue.take(f.waiting)
        yield* Fiber.interrupt(first)
        const ended1 = yield* Queue.take(f.settled)
        const ended2 = yield* Queue.take(f.settled)
        expect(ended1 === 'session-1:events' || ended1 === 'session-1:controls').toBe(true)
        expect(ended1 !== ended2).toBe(true)

        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connectNative(f.bridge)
            const controller = yield* createController(connection.ports)
            // A late finalizer from the old generation must not close the new one.
            yield* Effect.promise(() => f.bridge.closeTransport('session-1'))
            yield* connection.commands.pipe(
              Stream.runForEach((command) =>
                command._tag === 'Captured' ? controller.requestCaptured(command) : Effect.void,
              ),
              Effect.forkScoped,
            )
            const session = Option.getOrThrow(yield* Ref.get(f.active))
            const event = (kind: BridgeEvent['kind'], requestId: string, seq: number, text: string): BridgeEvent => ({
              kind,
              requestId,
              seq,
              text,
              targetLanguage: 'ja',
            })
            yield* Queue.offer(session.controls, event('capture', 'request-1', 0, 'fresh source'))
            expect(yield* Queue.take(f.translations)).toBe('session-2:request-1')
            yield* Queue.offer(session.events, event('delta', 'session-1:request-1', 1, 'stale prior generation'))
            yield* Queue.offer(session.events, event('started', 'session-2:request-1', 1, 'fresh source'))
            yield* Queue.offer(session.events, event('delta', 'session-2:request-1', 2, 'fresh output'))
            yield* Queue.offer(session.events, event('finished', 'session-2:request-1', 3, ''))
            const result = yield* controller.snapshots.pipe(
              Stream.filter((state) => state.phase === 'Complete'),
              Stream.runHead,
              Effect.map(Option.getOrThrow),
            )
            expect(result.sourceText).toBe('fresh source')
            expect(result.output).toBe('fresh output')
          }),
        )
        expect(yield* Queue.take(f.closed)).toBe('session-1')
        expect(yield* Queue.take(f.closed)).toBe('session-1')
        expect(yield* Queue.take(f.closed)).toBe('session-2')
        expect(Option.isNone(yield* Queue.poll(f.closed))).toBe(true)
      }),
    ),
  )
})
