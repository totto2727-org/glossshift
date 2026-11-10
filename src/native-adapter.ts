import { Effect, Option, Queue, Ref, Schema, Stream } from 'effect'
import type { BridgeModule } from 'glossshift/native'
import { Clipboard } from 'nsh'
import { Application as NativeApplication } from 'nsh/desktop'

import type { NativeCommand, NativeConnection } from './application'
import { RequestId } from './domain'
import type { TranslationEvent } from './domain'
import { PublicSettings } from './ports'
import type { Fault, NativePorts, TranslationRequest } from './ports'

const WireEvent = Schema.Struct({
  kind: Schema.Literals(['capture', 'started', 'delta', 'finished', 'failed', 'cancelled', 'reopened']),
  requestId: Schema.String,
  seq: Schema.Int,
  text: Schema.String,
  targetLanguage: Schema.String,
})
type WireEvent = typeof WireEvent.Type

const fault = (message: string): Fault => ({ _tag: 'ActionRequired', message })
const call = <A>(operation: () => Promise<A>, message: string) =>
  Effect.tryPromise({ try: operation, catch: () => fault(message) })
const decode = <A>(schema: Schema.Decoder<A>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => fault('The native service returned invalid data.')),
  )

/** One receiver per native transport lives for the application scope, never per request. */
export const connectNative = (bridge: BridgeModule, mode: 'desktop' | 'terminal' = 'desktop') =>
  Effect.gen(function* () {
    const bootstrap = yield* call(
      () => (mode === 'terminal' ? bridge.initializeTerminal() : bridge.initialize()),
      'GlossShift could not initialize its native services.',
    )
    if (bootstrap.schemaVersion !== 1) return yield* Effect.fail(fault('Unsupported native service protocol.'))
    const settings = yield* decode(PublicSettings, {
      sourceLanguage: bootstrap.sourceLanguage,
      initialStatus: bootstrap.status,
      window: bootstrap.window,
    })
    const session = yield* Effect.acquireRelease(
      call(() => bridge.openTransport(), 'The native event transport could not open.'),
      (id) => call(() => bridge.closeTransport(id), 'The native event transport could not close.').pipe(Effect.orDie),
    )
    const wireId = (id: RequestId) => `${session}:${id}`
    const events = yield* Queue.bounded<WireEvent>(256)
    const failures = yield* Queue.bounded<Fault>(1)
    const active = yield* Ref.make(Option.none<RequestId>())
    const receive = (operation: () => Promise<unknown>) =>
      call(operation, 'The native event transport closed.').pipe(Effect.flatMap((value) => decode(WireEvent, value)))

    // A single pending nextEvent survives request replacement. Interrupting a
    // promise consumer cannot cancel the native receiver waiting behind it.
    yield* Stream.fromEffectRepeat(receive(() => bridge.nextEvent(session))).pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.catchTag('ActionRequired', (error) => Queue.offer(failures, error)),
      Effect.forkScoped,
    )
    yield* Effect.addFinalizer(() => Queue.shutdown(events).pipe(Effect.andThen(Queue.shutdown(failures))))

    const cancel = (id: RequestId) =>
      Effect.gen(function* () {
        const retired = yield* Ref.modify(active, (current) => {
          const matches = Option.isNone(current) || current.value === id
          return [matches, matches ? Option.none() : current]
        })
        if (retired) yield* Queue.clear(events)
        yield* call(() => bridge.cancel(wireId(id)), 'The native translation could not be cancelled.')
      })
    const translate = (request: TranslationRequest) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sequence = yield* Ref.make(0)
          yield* Ref.set(active, Option.some(request.id))
          yield* call(
            () => bridge.translate(wireId(request.id), request.text, request.targetLanguage),
            'The native translation could not start. Check the shared provider configuration.',
          )
          return Stream.fromQueue(events).pipe(
            Stream.filter((event) => event.requestId === wireId(request.id)),
            Stream.filterEffect((event) =>
              Effect.gen(function* () {
                const previous = yield* Ref.get(sequence)
                if (event.seq <= previous) return false
                if (event.seq !== previous + 1)
                  return yield* Effect.fail(fault('The native translation event sequence was interrupted.'))
                yield* Ref.set(sequence, event.seq)
                return true
              }),
            ),
            Stream.mapEffect((event): Effect.Effect<TranslationEvent, Fault> => {
              switch (event.kind) {
                case 'started':
                  return Effect.succeed({ _tag: 'Started', id: request.id, sourceText: event.text })
                case 'delta':
                  return Effect.succeed({ _tag: 'Delta', id: request.id, text: event.text })
                case 'finished':
                  return Effect.succeed({ _tag: 'Finished', id: request.id })
                case 'failed':
                  return Effect.succeed({ _tag: 'Failed', id: request.id, message: event.text })
                case 'cancelled':
                  return Effect.succeed({ _tag: 'Failed', id: request.id, message: 'Translation cancelled' })
                default:
                  return Effect.fail(fault('Unexpected native provider event.'))
              }
            }),
          )
        }),
      )
    const ports: NativePorts = {
      settings: Effect.succeed(settings),
      capture:
        mode === 'terminal'
          ? Effect.fail(fault('Enter source text in the terminal input.'))
          : call(
              () => bridge.selection(),
              'Selection capture failed. Check Accessibility permission and select text again.',
            ),
      translate,
      cancel,
      copy: (text) =>
        call(
          () => (mode === 'terminal' ? Clipboard.writeText(text) : bridge.copy(text)),
          'The text could not be copied.',
        ),
      reveal:
        mode === 'terminal'
          ? Effect.void
          : call(() => bridge.reveal(), 'The translation window could not be revealed.'),
      hide:
        mode === 'terminal' ? Effect.void : call(() => bridge.hide(), 'The translation window could not be hidden.'),
      quit:
        mode === 'terminal'
          ? Effect.gen(function* () {
              const current = yield* Ref.get(active)
              if (Option.isSome(current)) yield* cancel(current.value)
              yield* Effect.sync(() => NativeApplication.quit())
            })
          : call(() => bridge.quit(), 'GlossShift could not quit.'),
      shortcuts: Stream.empty,
    }
    const controlEvents =
      mode === 'terminal' ? Stream.never : Stream.fromEffectRepeat(receive(() => bridge.nextControl(session)))
    const commands = controlEvents.pipe(
      Stream.mapEffect((event): Effect.Effect<NativeCommand, Fault> => {
        switch (event.kind) {
          case 'capture':
            return decode(RequestId, event.requestId).pipe(
              Effect.map((id) => ({ _tag: 'Captured', id, text: event.text, targetLanguage: event.targetLanguage })),
            )
          case 'failed':
            return Effect.succeed({ _tag: 'CaptureFailed', message: event.text })
          case 'reopened':
            return Effect.succeed({ _tag: 'Reopened' })
          default:
            return Effect.fail(fault('Unexpected native control event.'))
        }
      }),
      Stream.merge(Stream.fromQueue(failures).pipe(Stream.mapEffect(Effect.fail))),
    )
    return { ports, commands } satisfies NativeConnection
  })
