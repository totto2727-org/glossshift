import { Array, Deferred, Effect, Layer, Option, Queue, Ref, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { blockedReveal, floodFixture } from './controller.test.fixture.ts'
import { controllerFromNative, createController } from './controller.ts'
import type { PopupController } from './controller.ts'
import { RequestIdSchema, TranslationEvents } from './domain.ts'
import type { PopupState, RequestId, TranslationEvent } from './domain.ts'
import { FaultSchema, Native } from './ports.ts'
import type { Fault, NativePorts, TranslationRequest } from './ports.ts'

interface ControllerFixture {
  actions: Ref.Ref<Readonly<string[]>>
  cancelled: Queue.Queue<RequestId>
  clipboard: Ref.Ref<string>
  events: Queue.Queue<TranslationEvent>
  ports: NativePorts
  requests: Queue.Queue<TranslationRequest>
}

const fixture = (
  capture: Effect.Effect<string, Fault> = Effect.succeed('# Captured'),
): Effect.Effect<ControllerFixture> =>
  Effect.gen(function* () {
    const requests = yield* Queue.bounded<TranslationRequest>(8)
    const events = yield* Queue.bounded<TranslationEvent>(16)
    const cancelled = yield* Queue.bounded<RequestId>(8)
    const clipboard = yield* Ref.make('')
    const actions = yield* Ref.make<Readonly<string[]>>([])
    const record = (action: string): Effect.Effect<void, never, never> => Ref.update(actions, Array.append(action))
    const ports: NativePorts = {
      cancel: (id) => Queue.offer(cancelled, id).pipe(Effect.asVoid),
      capture: capture.pipe(Effect.tap(() => record('capture'))),
      copy: (text) => Ref.set(clipboard, text),
      hide: record('hide'),
      quit: record('quit'),
      reveal: record('reveal'),
      settings: Effect.succeed({
        initialStatus: 'Synthetic offline',
        sourceLanguage: 'auto',
        window: { height: 360, minHeight: 180, minWidth: 320, width: 560 },
      }),
      shortcuts: Stream.empty,
      translate: (request) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Queue.offer(requests, request)
            return Stream.fromQueue(events)
          }),
        ),
    }
    return { actions, cancelled, clipboard, events, ports, requests }
  })

const until = (
  controller: PopupController,
  predicate: (state: PopupState) => boolean,
): Effect.Effect<PopupState, never, never> =>
  controller.snapshots.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

const run = <A, E>(program: Effect.Effect<A, E, never>): Promise<A> =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
  Effect.runPromise(program.pipe(Effect.timeout('5 seconds')))

const capturedStreaming = (controller: PopupController, text: string): Effect.Effect<PopupState> =>
  until(controller, (state) => state.phase === 'Streaming' && state.sourceText === text)

const nextRequest = (
  controller: PopupController,
  context: ControllerFixture,
  language: string,
): Effect.Effect<TranslationRequest> => Effect.andThen(controller.request(language), Queue.take(context.requests))

const emitEvents = (context: ControllerFixture, events: Readonly<TranslationEvent[]>): Effect.Effect<void> =>
  Effect.forEach(events, (event) => Queue.offer(context.events, event), { discard: true })

const captureReplacement = Effect.gen(function* () {
  const count = yield* Ref.make(0)
  return Ref.updateAndGet(count, (value) => value + 1).pipe(
    Effect.flatMap((value) =>
      value === 1 ? Effect.succeed('First source') : Effect.fail(FaultSchema.make({ message: 'Selection denied' })),
    ),
  )
})

const verifyCopyWhileStreaming = (controller: PopupController, context: ControllerFixture): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* controller.setMode('Plain')
    yield* until(controller, (state) => state.mode === 'Plain')
    yield* controller.copy('Translation')
    yield* until(controller, (state) => state.status === 'Text copied')
    expect(yield* Ref.get(context.clipboard)).toBe('**First**\nSecond')
    yield* controller.hide
    yield* Effect.yieldNow
    expect(yield* Ref.get(context.actions)).toEqual(['capture', 'reveal', 'hide'])
    expect(Option.isNone(yield* Queue.poll(context.cancelled))).toBe(true)
  })

const cancelAndReceive = (controller: PopupController, context: ControllerFixture): Effect.Effect<RequestId> =>
  Effect.andThen(controller.cancel, Queue.take(context.cancelled))

test('Effect controller preserves the native captured ID and text without recapturing the revealed popup', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* fixture(Effect.fail(FaultSchema.make({ message: 'Recapture must not run' })))
        const controller = yield* createController(testContext.ports)
        const id = RequestIdSchema.make('native-42')
        yield* controller.requestCaptured({ id, targetLanguage: 'Japanese', text: '# Selected before activation' })
        const request = yield* Queue.take(testContext.requests)
        expect(request).toMatchObject({ id, text: '# Selected before activation' })
        const snapshot = yield* capturedStreaming(controller, request.text)
        expect(snapshot.output).toBe('')
        expect(yield* Ref.get(testContext.actions)).not.toContain('capture')
        expect(yield* cancelAndReceive(controller, testContext)).toBe(id)
      }),
    ),
  )
})

test('Effect controller control overflow invalidates the request without waiting for stream delivery', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* fixture()
        const { release, reveal, revealing } = yield* blockedReveal
        const controller = yield* createController({ ...testContext.ports, reveal })
        const request = yield* nextRequest(controller, testContext, 'Japanese')
        yield* Deferred.await(revealing)
        yield* Effect.forEach(
          Array.makeBy(17, (value) => value),
          () => controller.setMode('Plain'),
          { discard: true },
        )
        yield* Deferred.succeed(release, true)
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('The translation queue is busy. Try the shortcut again.')
        expect(yield* Queue.take(testContext.cancelled)).toBe(request.id)
      }),
    ),
  )
})

test('Effect controller a reveal error is visible and does not retry activation forever', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* fixture()
        const controller = yield* createController({
          ...testContext.ports,
          reveal: Effect.fail(FaultSchema.make({ message: 'Window unavailable' })),
        })
        yield* controller.request('Japanese')
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('Window unavailable')
        yield* Queue.take(testContext.cancelled)
        expect(Option.isNone(yield* Queue.poll(testContext.cancelled))).toBe(true)
      }),
    ),
  )
})

test('Effect controller initializes through an injected service layer with no native startup', async () => {
  const snapshot = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* fixture()
        const controller = yield* controllerFromNative.pipe(Effect.provide(Layer.succeed(Native, testContext.ports)))
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
        const capture = yield* captureReplacement
        const testContext = yield* fixture(capture)
        const controller = yield* createController(testContext.ports)
        const first = yield* nextRequest(controller, testContext, 'Japanese')
        yield* controller.request('English')
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('Selection denied')
        expect(yield* Queue.take(testContext.cancelled)).toBe(first.id)
        expect(Option.isNone(yield* Queue.poll(testContext.requests))).toBe(true)
      }),
    ),
  )
})

test('Effect controller streams ordered deltas, copies raw text, and hides without cancellation', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* fixture()
        const controller = yield* createController(testContext.ports)
        const request = yield* nextRequest(controller, testContext, 'Japanese')
        expect(request).toMatchObject({ sourceLanguage: 'auto', targetLanguage: 'Japanese', text: '# Captured' })
        yield* emitEvents(testContext, [
          TranslationEvents.Started({ id: request.id, sourceText: request.text }),
          TranslationEvents.Delta({ id: request.id, text: '**First**' }),
          TranslationEvents.Delta({ id: request.id, text: '\nSecond' }),
        ])
        yield* until(controller, (state) => state.output === '**First**\nSecond')
        yield* verifyCopyWhileStreaming(controller, testContext)
        yield* emitEvents(testContext, [TranslationEvents.Finished({ id: request.id })])
        const complete = yield* until(controller, (state) => state.phase === 'Complete')
        expect({ cancelled: yield* Queue.take(testContext.cancelled), output: complete.output }).toEqual({
          cancelled: request.id,
          output: '**First**\nSecond',
        })
      }),
    ),
  )
})

test('Effect controller replaces the native request and filters old transport events', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* fixture()
        const controller = yield* createController(testContext.ports)
        const first = yield* nextRequest(controller, testContext, 'Japanese')
        const second = yield* nextRequest(controller, testContext, 'English')
        expect(second.id).not.toBe(first.id)
        expect(yield* Queue.take(testContext.cancelled)).toBe(first.id)
        yield* emitEvents(testContext, [
          TranslationEvents.Delta({ id: first.id, text: 'STALE' }),
          TranslationEvents.Delta({ id: second.id, text: 'Current' }),
          TranslationEvents.Finished({ id: second.id }),
        ])
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
        const testContext = yield* fixture(Effect.fail(FaultSchema.make({ message: 'Selection denied' })))
        const controller = yield* createController(testContext.ports)
        yield* controller.request('Japanese')
        const failed = yield* until(controller, (state) => state.phase === 'Error')
        expect(failed.output).toBe('Selection denied')
        expect(Option.isNone(yield* Queue.poll(testContext.requests))).toBe(true)
        yield* Effect.yieldNow
        expect(yield* Ref.get(testContext.actions)).toEqual(['reveal'])
      }),
    ),
  )
})

test('Effect controller cancellation bypasses saturated translation delivery', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* fixture()
        const flood = yield* floodFixture(testContext)
        const controller = yield* createController(flood.ports)
        const request = yield* nextRequest(controller, testContext, 'Japanese')
        yield* Deferred.await(flood.revealing)
        yield* Deferred.await(flood.saturated)
        yield* controller.cancel.pipe(Effect.andThen(Deferred.succeed(flood.release, true)))
        const cancelled = yield* until(controller, (state) => state.status === 'Translation cancelled')
        expect(cancelled).toMatchObject({ output: '', phase: 'Ready' })
        expect(yield* Queue.take(testContext.cancelled)).toBe(request.id)
      }),
    ),
  )
})
