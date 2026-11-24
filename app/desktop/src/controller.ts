import { Predicate, Effect, Fiber, Match, Option, PubSub, Ref, Stream, String } from 'effect'
import type { Scope } from 'effect'

import { makeMailboxes } from './controller-mailbox.ts'
import type { ControllerMailboxes } from './controller-mailbox.ts'
import { ControllerMessages, initialState, RequestIdSchema, transition, TranslationEvents } from './domain.ts'
import type { ControllerMessage, Directive, DisplayMode, Pane, PopupState, RequestId } from './domain.ts'
import { Native } from './ports.ts'
import type { Fault, NativePorts, PublicSettings } from './ports.ts'

export type PopupController = Readonly<{
  settings: PublicSettings
  snapshot: Effect.Effect<PopupState>
  snapshots: Stream.Stream<PopupState>
  request: (targetLanguage: string) => Effect.Effect<void>
  submit: (input: Readonly<{ text: string; targetLanguage: string }>) => Effect.Effect<void>
  requestCaptured: (
    input: Readonly<{
      id: RequestId
      targetLanguage: string
      text: string
    }>,
  ) => Effect.Effect<void>
  captureFailed: (message: string) => Effect.Effect<void>
  cancel: Effect.Effect<void>
  copy: (pane: Pane) => Effect.Effect<void>
  setMode: (mode: DisplayMode) => Effect.Effect<void>
  hide: Effect.Effect<void>
  quit: Effect.Effect<void>
}>

type Send = ControllerMailboxes['send']

interface RequestCommands {
  start: (request: RequestTarget, capture: Effect.Effect<string, Fault>) => Effect.Effect<void>
  stop: Effect.Effect<void>
}

type RequestTarget = Readonly<{ id: RequestId; targetLanguage: string }>

const executeRequest =
  (ports: NativePorts, settings: PublicSettings, { emit, notify }: ControllerMailboxes) =>
  (target: RequestTarget, capture: Effect.Effect<string, Fault>): Effect.Effect<void> => {
    const { id, targetLanguage } = target
    const streamFailure = (message: string): ControllerMessage => TranslationEvents.Failed({ id, message })
    const report = (fault: Fault): Effect.Effect<void> => emit(streamFailure(fault.message))
    const reportCancellation = (fault: Fault): Effect.Effect<void> => notify(streamFailure(fault.message))
    const release = ports.cancel(id).pipe(Effect.catchTag('ActionRequired', reportCancellation))
    return Effect.gen(function* () {
      const text = yield* capture
      yield* emit(ControllerMessages.Captured({ id, sourceText: text }))
      yield* ports.translate({ id, sourceLanguage: settings.sourceLanguage, targetLanguage, text }).pipe(
        Stream.takeUntil(
          (event) => event.id === id && (Predicate.isTagged('Finished')(event) || Predicate.isTagged('Failed')(event)),
        ),
        Stream.runForEach(emit),
      )
      yield* emit(streamFailure('The translation stream ended before completion.'))
    }).pipe(
      Effect.catchTag('ActionRequired', report),
      Effect.catchDefect(() => emit(streamFailure('The translation service failed unexpectedly.'))),
      Effect.ensuring(release),
    )
  }

const manageRequests = (
  ports: NativePorts,
  settings: PublicSettings,
  mailboxes: ControllerMailboxes,
): Effect.Effect<RequestCommands, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const active = yield* Ref.make(Option.none<Fiber.Fiber<void, never>>())
    const runRequest = executeRequest(ports, settings, mailboxes)
    const stop = Effect.gen(function* () {
      const previous = yield* Ref.getAndSet(active, Option.none())
      if (Option.isSome(previous)) {
        yield* Fiber.interrupt(previous.value)
      }
      yield* mailboxes.clearEvents
    })
    const start: RequestCommands['start'] = (target, capture) =>
      Effect.gen(function* () {
        yield* stop
        const program = runRequest(target, capture)
        const fiber = yield* Effect.forkIn(program, scope, { startImmediately: true, uninterruptible: false })
        yield* Ref.set(active, Option.some(fiber))
      })
    return { start, stop }
  })

const applyDirective =
  (ports: NativePorts, requests: RequestCommands, { notify, send }: ControllerMailboxes) =>
  (directive: Directive): Effect.Effect<void> => {
    const report = (fault: Fault): Effect.Effect<void> => {
      const message = Predicate.isTagged('Reveal')(directive)
        ? ControllerMessages.RevealFailed({ message: fault.message })
        : ControllerMessages.ActionFailed({ message: fault.message })
      return notify(message)
    }
    return Match.value(directive).pipe(
      Match.tagsExhaustive({
        Copy: ({ text }) => ports.copy(text).pipe(Effect.andThen(() => send(ControllerMessages.Copied()))),
        Hide: () => ports.hide,
        Quit: () => ports.quit,
        Reveal: () => ports.reveal,
        Start: (request) => requests.start(request, ports.capture),
        StartCaptured: (request) => requests.start(request, Effect.succeed(request.text)),
        Stop: () => requests.stop,
      }),
      Effect.catchTag('ActionRequired', report),
    )
  }

const snapshotCapacity = 1

const initializeState = (
  settings: PublicSettings,
  guidance?: string,
): Effect.Effect<{ state: Ref.Ref<PopupState>; updates: PubSub.PubSub<PopupState> }> =>
  Effect.gen(function* () {
    const initial = initialState(settings.initialStatus, guidance)
    const state = yield* Ref.make(initial)
    const updates = yield* PubSub.sliding<PopupState>({ capacity: snapshotCapacity, replay: snapshotCapacity })
    yield* PubSub.publish(updates, initial)
    return { state, updates }
  })

type SnapshotState = Effect.Success<ReturnType<typeof initializeState>>

const runActor = (
  { state, updates }: SnapshotState,
  { poll, awaitMessage }: ControllerMailboxes,
  interpret: (directive: Directive) => Effect.Effect<void>,
): Effect.Effect<never> => {
  const applyMessage = (message: ControllerMessage): Effect.Effect<void> =>
    Effect.gen(function* () {
      const previous = yield* Ref.get(state)
      const next = transition(previous, message)
      if (next.state !== previous) {
        yield* Ref.set(state, next.state)
        // Only snapshots coalesce. Provider deltas stay lossless.
        yield* PubSub.publish(updates, next.state)
      }
      yield* Effect.forEach(next.directives, interpret, { discard: true })
    })
  return Effect.gen(function* () {
    while (true) {
      const message = yield* poll
      yield* Option.isNone(message) ? awaitMessage : applyMessage(message.value)
    }
  })
}

const makeRequestId = Effect.gen(function* () {
  const sequence = yield* Ref.make(BigInt('0'))
  const increment = BigInt('1')
  return Ref.updateAndGet(sequence, (value) => value + increment).pipe(
    Effect.map((value) => RequestIdSchema.make(`request-${value}`)),
  )
})

const submitRequest =
  (nextId: Effect.Effect<RequestId>, send: Send): PopupController['submit'] =>
  ({ text, targetLanguage }) =>
    Effect.gen(function* () {
      const target = String.trim(targetLanguage)
      if (String.isEmpty(String.trim(text)) || String.isEmpty(target)) {
        return yield* send(
          ControllerMessages.ActionFailed({
            message: 'Enter source text and a target language before translating.',
          }),
        )
      }
      const id = yield* nextId
      yield* send(ControllerMessages.RequestCaptured({ id, targetLanguage: target, text }))
    })

const controllerPorts = (
  { state, updates }: SnapshotState,
  { cancel, send }: ControllerMailboxes,
  settings: PublicSettings,
): Effect.Effect<PopupController> =>
  Effect.gen(function* () {
    const nextId = yield* makeRequestId
    return {
      cancel,
      captureFailed: (message: string) => send(ControllerMessages.ActionFailed({ message })),
      copy: (pane: Pane) => send(ControllerMessages.Copy({ pane })),
      hide: send(ControllerMessages.Hide()),
      quit: send(ControllerMessages.Quit()),
      request: (targetLanguage: string) =>
        Effect.gen(function* () {
          const id = yield* nextId
          yield* send(ControllerMessages.Request({ id, targetLanguage }))
        }),
      requestCaptured: ({ id, targetLanguage, text }) =>
        send(ControllerMessages.RequestCaptured({ id, targetLanguage, text })),
      setMode: (mode: DisplayMode) => send(ControllerMessages.SetMode({ mode })),
      settings,
      snapshot: Ref.get(state),
      snapshots: Stream.fromPubSub(updates),
      submit: submitRequest(nextId, send),
    } satisfies PopupController
  })

/**
 * One actor owns state. Control ingress never waits for the lossless event queue.
 *
 * @param {NativePorts} ports Native operations and translation transport.
 * @param {string} guidance Optional message shown in the initial state.
 * @returns {Effect.Effect} The controller and its scoped actor.
 */
export const createController = (
  ports: NativePorts,
  guidance?: string,
): Effect.Effect<PopupController, Fault, Scope.Scope> =>
  Effect.gen(function* () {
    const settings = yield* ports.settings
    const snapshots = yield* initializeState(settings, guidance)
    const mailboxes = yield* makeMailboxes
    const requests = yield* manageRequests(ports, settings, mailboxes)
    const actor = runActor(snapshots, mailboxes, applyDirective(ports, requests, mailboxes))
    const shutdown = requests.stop.pipe(
      Effect.andThen(mailboxes.shutdown),
      Effect.andThen(PubSub.shutdown(snapshots.updates)),
    )
    yield* Effect.addFinalizer(() => shutdown)
    yield* Effect.forkScoped(actor, { startImmediately: true })
    return yield* controllerPorts(snapshots, mailboxes, settings)
  })

export const controllerFromNative = Effect.gen(function* () {
  return yield* createController(yield* Native)
})
