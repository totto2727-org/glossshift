import { Effect, Fiber, Option, PubSub, Queue, Ref, Schema, Stream, String } from 'effect'

import { initialState, RequestId, transition } from './domain'
import type { ControllerMessage, Directive, DisplayMode, Pane, PopupState } from './domain'
import { Native } from './ports'
import type { Fault, NativePorts, PublicSettings } from './ports'

export interface PopupController {
  readonly settings: PublicSettings
  readonly snapshot: Effect.Effect<PopupState>
  readonly snapshots: Stream.Stream<PopupState>
  readonly request: (targetLanguage: string) => Effect.Effect<void>
  readonly submit: (input: { readonly text: string; readonly targetLanguage: string }) => Effect.Effect<void>
  readonly requestCaptured: (input: {
    readonly id: RequestId
    readonly targetLanguage: string
    readonly text: string
  }) => Effect.Effect<void>
  readonly captureFailed: (message: string) => Effect.Effect<void>
  readonly cancel: Effect.Effect<void>
  readonly copy: (pane: Pane) => Effect.Effect<void>
  readonly setMode: (mode: DisplayMode) => Effect.Effect<void>
  readonly hide: Effect.Effect<void>
  readonly quit: Effect.Effect<void>
}

/** One actor owns state. Control ingress never waits for the lossless event queue. */
export const createController = (ports: NativePorts, guidance?: string) =>
  Effect.gen(function* () {
    const settings = yield* ports.settings
    const scope = yield* Effect.scope
    const state = yield* Ref.make(initialState(settings.initialStatus, guidance))
    const updates = yield* PubSub.sliding<PopupState>({ capacity: 1, replay: 1 })
    const controls = yield* Queue.bounded<ControllerMessage>(16)
    const events = yield* Queue.bounded<ControllerMessage>(256)
    const urgent = yield* Queue.sliding<ControllerMessage>(1)
    const cancellation = yield* Ref.make(false)
    const wake = yield* Queue.sliding<void>(1)
    const sequence = yield* Ref.make(0n)
    const active = yield* Ref.make(Option.none<Fiber.Fiber<void, never>>())
    yield* PubSub.publish(updates, yield* Ref.get(state))

    const notify = (message: ControllerMessage) =>
      Effect.sync(() => {
        Queue.offerUnsafe(urgent, message)
        Queue.offerUnsafe(wake, undefined)
      })

    const send = (message: ControllerMessage) =>
      Effect.gen(function* () {
        const accepted = yield* Effect.sync(() => Queue.offerUnsafe(controls, message))
        if (!accepted) {
          yield* Queue.clear(controls)
          yield* notify({ _tag: 'ActionFailed', message: 'The translation queue is busy. Try the shortcut again.' })
        }
        yield* Effect.sync(() => Queue.offerUnsafe(wake, undefined))
      }).pipe(Effect.asVoid)

    const emit = (message: ControllerMessage) =>
      Effect.gen(function* () {
        yield* Queue.offer(events, message)
        yield* Effect.sync(() => Queue.offerUnsafe(wake, undefined))
      }).pipe(Effect.asVoid)

    const stop = Effect.gen(function* () {
      const previous = yield* Ref.getAndSet(active, Option.none())
      if (Option.isSome(previous)) yield* Fiber.interrupt(previous.value)
      yield* Queue.clear(events)
    })

    const runRequest = (id: RequestId, targetLanguage: string, capture: Effect.Effect<string, Fault>) =>
      Effect.gen(function* () {
        const text = yield* capture
        yield* emit({ _tag: 'Captured', id, sourceText: text })
        yield* ports.translate({ id, text, targetLanguage, sourceLanguage: settings.sourceLanguage }).pipe(
          Stream.takeUntil((event) => event.id === id && (event._tag === 'Finished' || event._tag === 'Failed')),
          Stream.runForEach(emit),
        )
        yield* emit({ _tag: 'Failed', id, message: 'The translation stream ended before completion.' })
      }).pipe(
        Effect.catchTag('ActionRequired', (error) => emit({ _tag: 'Failed', id, message: error.message })),
        Effect.catchDefect(() => emit({ _tag: 'Failed', id, message: 'The translation service failed unexpectedly.' })),
        Effect.ensuring(
          ports
            .cancel(id)
            .pipe(Effect.catchTag('ActionRequired', (error) => notify({ _tag: 'Failed', id, message: error.message }))),
        ),
      )

    const interpret = (directive: Directive): Effect.Effect<void> =>
      Effect.gen(function* () {
        switch (directive._tag) {
          case 'Start':
          case 'StartCaptured': {
            yield* stop
            const capture = directive._tag === 'StartCaptured' ? Effect.succeed(directive.text) : ports.capture
            const fiber = yield* Effect.forkIn(runRequest(directive.id, directive.targetLanguage, capture), scope, {
              startImmediately: true,
              uninterruptible: false,
            })
            yield* Ref.set(active, Option.some(fiber))
            return
          }
          case 'Stop':
            return yield* stop
          case 'Copy':
            yield* ports.copy(directive.text)
            return yield* send({ _tag: 'Copied' })
          case 'Reveal':
            return yield* ports.reveal
          case 'Hide':
            return yield* ports.hide
          case 'Quit':
            return yield* ports.quit
        }
      }).pipe(
        Effect.catchTag('ActionRequired', (error) =>
          notify({
            _tag: directive._tag === 'Reveal' ? 'RevealFailed' : 'ActionFailed',
            message: error.message,
          }),
        ),
      )

    const poll = Effect.gen(function* () {
      if (yield* Ref.getAndSet(cancellation, false)) return Option.some<ControllerMessage>({ _tag: 'Cancel' })
      const priority = yield* Queue.poll(urgent)
      if (Option.isSome(priority)) return priority
      const control = yield* Queue.poll(controls)
      return Option.isSome(control) ? control : yield* Queue.poll(events)
    })

    const actor = Effect.gen(function* () {
      while (true) {
        const message = yield* poll
        if (Option.isNone(message)) {
          yield* Queue.take(wake)
          continue
        }
        const previous = yield* Ref.get(state)
        const next = transition(previous, message.value)
        if (next.state !== previous) {
          yield* Ref.set(state, next.state)
          // Only complete snapshots coalesce. Provider deltas remain lossless.
          yield* PubSub.publish(updates, next.state)
        }
        yield* Effect.forEach(next.directives, interpret, { discard: true })
      }
    })

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* stop
        yield* Queue.shutdown(controls)
        yield* Queue.shutdown(events)
        yield* Queue.shutdown(urgent)
        yield* Queue.shutdown(wake)
        yield* PubSub.shutdown(updates)
      }),
    )
    yield* Effect.forkIn(actor, scope, { startImmediately: true })

    return {
      settings,
      snapshot: Ref.get(state),
      snapshots: Stream.fromPubSub(updates),
      submit: (input: { readonly text: string; readonly targetLanguage: string }) =>
        Effect.gen(function* () {
          const targetLanguage = String.trim(input.targetLanguage)
          if (String.isEmpty(String.trim(input.text)) || String.isEmpty(targetLanguage)) {
            return yield* send({
              _tag: 'ActionFailed',
              message: 'Enter source text and a target language before translating.',
            })
          }
          const number = yield* Ref.updateAndGet(sequence, (value) => value + 1n)
          const id = Schema.decodeUnknownSync(RequestId)(`request-${number}`)
          yield* send({ _tag: 'RequestCaptured', id, text: input.text, targetLanguage })
        }),
      requestCaptured: (input: { readonly id: RequestId; readonly targetLanguage: string; readonly text: string }) =>
        send({ _tag: 'RequestCaptured', id: input.id, targetLanguage: input.targetLanguage, text: input.text }),
      captureFailed: (message: string) => send({ _tag: 'ActionFailed', message }),
      request: (targetLanguage: string) =>
        Effect.gen(function* () {
          const number = yield* Ref.updateAndGet(sequence, (value) => value + 1n)
          const id = Schema.decodeUnknownSync(RequestId)(`request-${number}`)
          yield* send({ _tag: 'Request', id, targetLanguage })
        }),
      cancel: Effect.gen(function* () {
        yield* Ref.set(cancellation, true)
        yield* Queue.clear(controls)
        yield* Effect.sync(() => {
          Queue.offerUnsafe(wake, undefined)
        })
      }),
      copy: (pane: Pane) => send({ _tag: 'Copy', pane }),
      setMode: (mode: DisplayMode) => send({ _tag: 'SetMode', mode }),
      hide: send({ _tag: 'Hide' }),
      quit: send({ _tag: 'Quit' }),
    } satisfies PopupController
  })

export const controllerFromNative = Effect.gen(function* () {
  return yield* createController(yield* Native)
})
