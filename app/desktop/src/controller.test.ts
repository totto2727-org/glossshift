import { Array, Deferred, Effect, Fiber, Layer, Option, Queue, Ref, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { controllerFromNative, createController } from './controller'
import type { PopupController } from './controller'
import { RequestId } from './domain'
import type { PopupState, TranslationEvent } from './domain'
import type { Fault, NativePorts, TranslationRequest } from './ports'
import { Native } from './ports'

const fixture = (capture: Effect.Effect<string, Fault> = Effect.succeed('# Captured')) =>
  Effect.gen(function* () {
    const requests = yield* Queue.bounded<TranslationRequest>(8)
    const events = yield* Queue.bounded<TranslationEvent>(16)
    const cancelled = yield* Queue.bounded<RequestId>(8)
    const clipboard = yield* Ref.make('')
    const actions = yield* Ref.make<ReadonlyArray<string>>([])
    const record = (action: string) => Ref.update(actions, Array.append(action))
    const ports: NativePorts = {
      settings: Effect.succeed({
        sourceLanguage: 'auto',
        initialStatus: 'Synthetic offline',
        window: { width: 560, height: 360, minWidth: 320, minHeight: 180 },
      }),
      capture: capture.pipe(Effect.tap(() => record('capture'))),
      translate: (request) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Queue.offer(requests, request)
            return Stream.fromQueue(events)
          }),
        ),
      cancel: (id) => Queue.offer(cancelled, id).pipe(Effect.asVoid),
      copy: (text) => Ref.set(clipboard, text),
      reveal: record('reveal'),
      hide: record('hide'),
      quit: record('quit'),
      shortcuts: Stream.empty,
    }
    return { ports, requests, events, cancelled, clipboard, actions }
  })

const until = (controller: PopupController, predicate: (state: PopupState) => boolean) =>
  controller.snapshots.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

const run = <A, E>(program: Effect.Effect<A, E, never>) => Effect.runPromise(program.pipe(Effect.timeout('5 seconds')))

test('Effect controller preserves the native captured ID and text without recapturing the revealed popup', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture(Effect.fail({ _tag: 'ActionRequired', message: 'Recapture must not run' }))
        const controller = yield* createController(f.ports)
        const id = Schema.decodeUnknownSync(RequestId)('native-42')
        yield* controller.requestCaptured({ id, text: '# Selected before activation', targetLanguage: 'Japanese' })
        const request = yield* Queue.take(f.requests)
        expect(request.id).toBe(id)
        expect(request.text).toBe('# Selected before activation')
        const snapshot = yield* until(
          controller,
          (state) => state.phase === 'Streaming' && state.sourceText === request.text,
        )
        expect(snapshot.output).toBe('')
        expect(Array.contains(yield* Ref.get(f.actions), 'capture')).toBe(false)
        yield* controller.cancel
        expect(yield* Queue.take(f.cancelled)).toBe(id)
      }),
    ),
  )
})

test('Effect controller control overflow invalidates the request without waiting for stream delivery', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture()
        const revealing = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const controller = yield* createController({
          ...f.ports,
          reveal: Deferred.succeed(revealing, undefined).pipe(Effect.andThen(Deferred.await(release))),
        })
        yield* controller.request('Japanese')
        const request = yield* Queue.take(f.requests)
        yield* Deferred.await(revealing)
        yield* Effect.forEach(
          Array.makeBy(17, (value) => value),
          () => controller.setMode('Plain'),
          { discard: true },
        )
        yield* Deferred.succeed(release, undefined)
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('The translation queue is busy. Try the shortcut again.')
        expect(yield* Queue.take(f.cancelled)).toBe(request.id)
      }),
    ),
  )
})

test('Effect controller a reveal error is visible and does not retry activation forever', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture()
        const controller = yield* createController({
          ...f.ports,
          reveal: Effect.fail({ _tag: 'ActionRequired', message: 'Window unavailable' }),
        })
        yield* controller.request('Japanese')
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('Window unavailable')
        yield* Queue.take(f.cancelled)
        expect(Option.isNone(yield* Queue.poll(f.cancelled))).toBe(true)
      }),
    ),
  )
})

test('Effect runtime yields, interrupts, and finalizes a scoped fiber once in NSH', async () => {
  const result = await run(
    Effect.gen(function* () {
      const cleaned = yield* Ref.make(0)
      const started = yield* Deferred.make<void>()
      yield* Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.acquireRelease(Effect.void, () => Ref.update(cleaned, (n) => n + 1)).pipe(
            Effect.flatMap(() => Deferred.succeed(started, undefined)),
            Effect.andThen(Effect.sleep('1 millis')),
            Effect.andThen(Effect.never),
            Effect.scoped,
            Effect.forkScoped,
          )
          yield* Deferred.await(started)
          yield* Effect.yieldNow
          yield* Effect.sleep('1 millis')
          yield* Fiber.interrupt(fiber)
        }),
      )
      return yield* Ref.get(cleaned)
    }),
  )
  expect(result).toBe(1)
})

test('Effect controller initializes through an injected service layer with no native startup', async () => {
  const snapshot = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture()
        const controller = yield* controllerFromNative.pipe(Effect.provide(Layer.succeed(Native, f.ports)))
        return yield* controller.snapshot
      }),
    ),
  )
  expect(snapshot.phase).toBe('Ready')
  expect(snapshot.status).toBe('Synthetic offline')
})

test('Effect controller a failed replacement still cancels the previous native request', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const count = yield* Ref.make(0)
        const capture = Ref.updateAndGet(count, (value) => value + 1).pipe(
          Effect.flatMap((value) =>
            value === 1
              ? Effect.succeed('First source')
              : Effect.fail({ _tag: 'ActionRequired', message: 'Selection denied' } satisfies Fault),
          ),
        )
        const f = yield* fixture(capture)
        const controller = yield* createController(f.ports)
        yield* controller.request('Japanese')
        const first = yield* Queue.take(f.requests)
        yield* controller.request('English')
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('Selection denied')
        expect(yield* Queue.take(f.cancelled)).toBe(first.id)
        expect(Option.isNone(yield* Queue.poll(f.requests))).toBe(true)
      }),
    ),
  )
})

test('Effect controller streams ordered deltas, copies raw text, and hides without cancellation', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture()
        const controller = yield* createController(f.ports)
        yield* controller.request('Japanese')
        const request = yield* Queue.take(f.requests)
        expect(request.text).toBe('# Captured')
        expect(request.sourceLanguage).toBe('auto')
        expect(request.targetLanguage).toBe('Japanese')
        yield* Queue.offer(f.events, { _tag: 'Started', id: request.id, sourceText: request.text })
        yield* Queue.offer(f.events, { _tag: 'Delta', id: request.id, text: '**First**' })
        yield* Queue.offer(f.events, { _tag: 'Delta', id: request.id, text: '\nSecond' })
        yield* until(controller, (state) => state.output === '**First**\nSecond')
        yield* controller.setMode('Plain')
        yield* until(controller, (state) => state.mode === 'Plain')
        yield* controller.copy('Translation')
        yield* until(controller, (state) => state.status === 'Text copied')
        expect(yield* Ref.get(f.clipboard)).toBe('**First**\nSecond')
        yield* controller.hide
        yield* Effect.yieldNow
        expect(yield* Ref.get(f.actions)).toEqual(['capture', 'reveal', 'hide'])
        expect(Option.isNone(yield* Queue.poll(f.cancelled))).toBe(true)
        yield* Queue.offer(f.events, { _tag: 'Finished', id: request.id })
        const complete = yield* until(controller, (state) => state.phase === 'Complete')
        expect(complete.output).toBe('**First**\nSecond')
        expect(yield* Queue.take(f.cancelled)).toBe(request.id)
      }),
    ),
  )
})

test('Effect controller replaces the native request and filters old transport events', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture()
        const controller = yield* createController(f.ports)
        yield* controller.request('Japanese')
        const first = yield* Queue.take(f.requests)
        yield* controller.request('English')
        const second = yield* Queue.take(f.requests)
        expect(second.id).not.toBe(first.id)
        expect(yield* Queue.take(f.cancelled)).toBe(first.id)
        yield* Queue.offer(f.events, { _tag: 'Delta', id: first.id, text: 'STALE' })
        yield* Queue.offer(f.events, { _tag: 'Delta', id: second.id, text: 'Current' })
        yield* Queue.offer(f.events, { _tag: 'Finished', id: second.id })
        const complete = yield* until(controller, (state) => state.phase === 'Complete')
        expect(complete.output).toBe('Current')
      }),
    ),
  )
})

test('Effect controller displays capture failures without provider or real configuration access', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture(Effect.fail({ _tag: 'ActionRequired', message: 'Selection denied' }))
        const controller = yield* createController(f.ports)
        yield* controller.request('Japanese')
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('Selection denied')
        expect(Option.isNone(yield* Queue.poll(f.requests))).toBe(true)
        yield* Effect.yieldNow
        expect(yield* Ref.get(f.actions)).toEqual(['reveal'])
      }),
    ),
  )
})

test('Effect controller cancellation bypasses saturated translation delivery', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture()
        const revealing = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const saturated = yield* Deferred.make<void>()
        const produced = yield* Ref.make(0)
        const floodPorts: NativePorts = {
          ...f.ports,
          reveal: Deferred.succeed(revealing, undefined).pipe(Effect.andThen(Deferred.await(release))),
          translate: (request) =>
            Stream.unwrap(
              Effect.gen(function* () {
                yield* Queue.offer(f.requests, request)
                return Stream.fromEffectRepeat(
                  Effect.gen(function* () {
                    const count = yield* Ref.updateAndGet(produced, (value) => value + 1)
                    if (count === 257) yield* Deferred.succeed(saturated, undefined)
                    return { _tag: 'Delta', id: request.id, text: 'x' } satisfies TranslationEvent
                  }),
                )
              }),
            ),
        }
        const controller = yield* createController(floodPorts)
        yield* controller.request('Japanese')
        const request = yield* Queue.take(f.requests)
        yield* Deferred.await(revealing)
        yield* Deferred.await(saturated)
        yield* controller.cancel
        yield* Deferred.succeed(release, undefined)
        const cancelled = yield* until(controller, (state) => state.status === 'Translation cancelled')
        expect(cancelled.phase).toBe('Ready')
        expect(cancelled.output).toBe('')
        expect(yield* Queue.take(f.cancelled)).toBe(request.id)
      }),
    ),
  )
})
