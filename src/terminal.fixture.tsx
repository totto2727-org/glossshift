import { Effect, Stream } from 'effect'
import { Clipboard, mount } from 'nsh'

import type { Fault, NativePorts } from './ports'
import { TerminalApplication } from './terminal'

const ports: NativePorts = {
  settings: Effect.succeed({
    sourceLanguage: 'auto',
    initialStatus: 'Synthetic terminal ready',
    window: { width: 640, height: 384, minWidth: 320, minHeight: 180 },
  }),
  capture: Effect.die('Terminal input must not capture the desktop'),
  translate: (request) =>
    request.targetLanguage === 'wait'
      ? Stream.make({ _tag: 'Started', id: request.id, sourceText: request.text }).pipe(Stream.concat(Stream.never))
      : Stream.make(
          { _tag: 'Started', id: request.id, sourceText: request.text },
          { _tag: 'Delta', id: request.id, text: `# Translated ${request.targetLanguage}\n\n${request.text}` },
          { _tag: 'Finished', id: request.id },
        ),
  cancel: () => Effect.void,
  copy: (text) =>
    Effect.tryPromise({
      try: () => Clipboard.writeText(text),
      catch: (): Fault => ({ _tag: 'ActionRequired', message: 'Synthetic clipboard failed' }),
    }),
  hide: Effect.void,
  reveal: Effect.void,
  quit: Effect.void,
  shortcuts: Stream.empty,
}
mount(() => <TerminalApplication connect={Effect.succeed({ ports, commands: Stream.never })} />)
