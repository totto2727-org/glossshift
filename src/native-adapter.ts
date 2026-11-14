import { Effect, Schema, Stream } from 'effect'
import type { BridgeModule } from 'glossshift/native'
import { Clipboard } from 'nsh'
import { Application as NativeApplication } from 'nsh/desktop'

import type { NativeCommand, NativeConnection } from './application'
import { RequestId } from './domain'
import { connectLocal } from './local-client'
import type { LocalLauncher } from './local-client'
import { PublicSettings } from './ports'
import type { Fault, NativePorts } from './ports'

const ControlEvent = Schema.Struct({
  kind: Schema.Literals(['capture', 'failed', 'reopened']),
  requestId: Schema.String,
  seq: Schema.Int,
  text: Schema.String,
  targetLanguage: Schema.String,
})
const fault = (message: string): Fault => ({ _tag: 'ActionRequired', message })
const call = <A>(operation: () => Promise<A>, message: string) =>
  Effect.tryPromise({ try: operation, catch: () => fault(message) })
const decode = <A>(schema: Schema.Decoder<A>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => fault('The native service returned invalid data.')),
  )

/** Native control and local translation have independent application-scoped transports. */
export const connectNative = (
  bridge: BridgeModule,
  mode: 'desktop' | 'terminal' = 'desktop',
  launcher?: LocalLauncher,
) =>
  Effect.gen(function* () {
    const bootstrap = yield* call(
      () => (mode === 'terminal' ? bridge.initializeTerminal() : bridge.initialize()),
      'GlossShift could not initialize its native services.',
    )
    if (bootstrap.schemaVersion !== 2) return yield* Effect.fail(fault('Unsupported native service protocol.'))
    const local = yield* connectLocal(bootstrap.runtime, launcher)
    const settings = yield* decode(PublicSettings, {
      sourceLanguage: local.settings.sourceLanguage,
      initialStatus: bootstrap.status,
      window: bootstrap.window,
    })
    const session = yield* Effect.acquireRelease(
      call(() => bridge.openTransport(), 'The native control transport could not open.'),
      (id) =>
        call(() => bridge.closeTransport(id), 'The native control transport could not close.').pipe(Effect.ignore),
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
      translate: local.translate,
      cancel: local.cancel,
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
          ? Effect.sync(() => NativeApplication.quit())
          : call(() => bridge.quit(), 'GlossShift could not quit.'),
      shortcuts: Stream.empty,
    }
    const controls =
      mode === 'terminal'
        ? Stream.never
        : Stream.fromEffectRepeat(
            call(() => bridge.nextControl(session), 'The native control transport closed.').pipe(
              Effect.flatMap((event) => decode(ControlEvent, event)),
            ),
          )
    const commands = controls.pipe(
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
        }
      }),
      Stream.merge(local.failures),
    )
    return { ports, commands } satisfies NativeConnection
  })
