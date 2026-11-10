import { Array, Deferred, Effect, Fiber, Option, Queue, Ref, Schema, Stream } from 'effect'
import type { BridgeEvent, BridgeModule } from 'glossshift/native'
import { expect, test } from 'nsh/test'

import { createController } from './controller'
import { RequestId } from './domain'
import { connectNative } from './native-adapter'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))
const wire = (requestId: string, seq: number, kind: BridgeEvent['kind'], text = ''): BridgeEvent => ({
  requestId,
  seq,
  kind,
  text,
  targetLanguage: 'Japanese',
})
const provider = (id: string, seq: number, kind: BridgeEvent['kind'], text = '') =>
  wire(`fixture:${id}`, seq, kind, text)
const fixture = Effect.gen(function* () {
  const events = yield* Queue.bounded<BridgeEvent>(1024)
  const controls = yield* Queue.bounded<BridgeEvent>(8)
  const translations = yield* Queue.bounded<{ readonly id: string; readonly text: string }>(8)
  const cancellations = yield* Queue.bounded<string>(8)
  const readers = yield* Ref.make(0)
  const maxReaders = yield* Ref.make(0)
  const received = yield* Ref.make(0)
  const saturated = yield* Deferred.make<void>()
  const promise = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
  const bridge: BridgeModule = {
    openTransport: () => promise(Effect.succeed('fixture')),
    closeTransport: () => promise(Effect.void),
    initializeTerminal: () => bridge.initialize(),
    initialize: () =>
      promise(
        Effect.succeed({
          schemaVersion: 1,
          sourceLanguage: 'auto',
          status: 'Synthetic bridge',
          accessibilityGranted: true,
          providerName: 'offline',
          shortcuts: [],
          window: { width: 560, height: 360, minWidth: 320, minHeight: 180 },
        }),
      ),
    nextEvent: () =>
      promise(
        Effect.acquireUseRelease(
          Ref.updateAndGet(readers, (value) => value + 1).pipe(
            Effect.tap((value) => Ref.update(maxReaders, (previous) => (previous > value ? previous : value))),
          ),
          () =>
            Queue.take(events).pipe(
              Effect.tap(() =>
                Effect.gen(function* () {
                  const count = yield* Ref.updateAndGet(received, (value) => value + 1)
                  if (count === 257) yield* Deferred.succeed(saturated, undefined)
                }),
              ),
            ),
          () => Ref.update(readers, (value) => value - 1),
        ),
      ),
    nextControl: () => promise(Queue.take(controls)),
    translate: (id, text) => promise(Queue.offer(translations, { id, text }).pipe(Effect.asVoid)),
    cancel: (id) => promise(Queue.offer(cancellations, id).pipe(Effect.asVoid)),
    selection: () => promise(Effect.die('Recapture must not run')),
    copy: () => promise(Effect.void),
    reveal: () => promise(Effect.void),
    hide: () => promise(Effect.void),
    quit: () => promise(Effect.void),
  }
  yield* Effect.addFinalizer(() => Queue.shutdown(events).pipe(Effect.andThen(Queue.shutdown(controls))))
  return { bridge, events, controls, translations, cancellations, maxReaders, saturated }
})

test('typed native adapter routes captured ID and text and preserves ordered provider deltas', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture
        const connection = yield* connectNative(f.bridge)
        const controller = yield* createController(connection.ports)
        yield* Queue.offer(f.controls, wire('native-71', 0, 'capture', '# Foreground selection'))
        const command = yield* connection.commands.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        if (command._tag !== 'Captured') return yield* Effect.die('Expected captured command')
        yield* controller.requestCaptured(command)
        expect(yield* Queue.take(f.translations)).toEqual({ id: 'fixture:native-71', text: '# Foreground selection' })
        yield* Queue.offer(f.events, provider('old-id', 1, 'delta', 'stale'))
        yield* Queue.offer(f.events, provider('native-71', 1, 'started', '# Foreground selection'))
        yield* Queue.offer(f.events, provider('native-71', 2, 'delta', 'translated'))
        yield* Queue.offer(f.events, provider('native-71', 2, 'delta', 'duplicate'))
        yield* Queue.offer(f.events, provider('native-71', 3, 'finished'))
        const result = yield* controller.snapshots.pipe(
          Stream.filter((state) => state.phase === 'Complete'),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        expect(result.output).toBe('translated')
        expect(yield* Ref.get(f.maxReaders)).toBe(1)
      }),
    ),
  )
})

test('typed native adapter replaces requests without creating a second pending native receiver', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture
        const connection = yield* connectNative(f.bridge)
        const id1 = Schema.decodeUnknownSync(RequestId)('native-1')
        const id2 = Schema.decodeUnknownSync(RequestId)('native-2')
        const first = yield* connection.ports
          .translate({ id: id1, text: 'one', sourceLanguage: 'auto', targetLanguage: 'ja' })
          .pipe(Stream.runDrain, Effect.forkScoped)
        yield* Queue.take(f.translations)
        yield* Fiber.interrupt(first)
        yield* connection.ports.cancel(id1)
        const second = yield* connection.ports
          .translate({ id: id2, text: 'two', sourceLanguage: 'auto', targetLanguage: 'ja' })
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
        yield* Queue.take(f.translations)
        yield* Queue.offer(f.events, provider('native-1', 1, 'delta', 'old'))
        yield* Queue.offer(f.events, provider('native-2', 1, 'started', 'two'))
        yield* Queue.offer(f.events, provider('native-2', 2, 'finished'))
        const result = yield* Fiber.join(second)
        expect(Array.length(result)).toBe(2)
        expect(yield* Ref.get(f.maxReaders)).toBe(1)
      }),
    ),
  )
})

test('typed native adapter control intake bypasses a full bounded provider queue', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture
        const connection = yield* connectNative(f.bridge)
        yield* Effect.forEach(
          Array.makeBy(300, (index) => index),
          (index) => Queue.offer(f.events, provider('old', index + 1, 'delta', 'old')),
          { discard: true },
        )
        yield* Deferred.await(f.saturated)
        yield* Queue.offer(f.controls, wire('new', 0, 'capture', 'New foreground source'))
        const command = yield* connection.commands.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        expect(command._tag).toBe('Captured')
        yield* connection.ports.cancel(Schema.decodeUnknownSync(RequestId)('old'))
        expect(yield* Queue.take(f.cancellations)).toBe('fixture:old')
      }),
    ),
  )
})

test('typed native adapter rejects sequence gaps with an actionable failure', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture
        const connection = yield* connectNative(f.bridge)
        const id = Schema.decodeUnknownSync(RequestId)('native-gap')
        const consumer = yield* connection.ports
          .translate({ id, text: 'source', sourceLanguage: 'auto', targetLanguage: 'ja' })
          .pipe(Stream.runDrain, Effect.flip, Effect.forkScoped)
        yield* Queue.take(f.translations)
        yield* Queue.offer(f.events, provider(id, 2, 'delta', 'missing start'))
        expect((yield* Fiber.join(consumer)).message).toBe('The native translation event sequence was interrupted.')
      }),
    ),
  )
})
