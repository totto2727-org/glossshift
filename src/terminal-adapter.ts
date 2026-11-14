import { Effect, Stream } from 'effect'
import { Clipboard } from 'nsh'
import { Application } from 'nsh/desktop'

import type { TranslationService } from '../runtime/translation'
import type { NativeConnection } from './application'
import { loadApplicationServices } from './application-services'
import type { DesktopConfiguration } from './desktop-settings'
import type { Fault, NativePorts } from './ports'
import { createTranslationClient } from './translation-client'

/** Terminal composition uses the same in-process Effect service as the desktop. */
export const connectTerminal = (configuration: DesktopConfiguration, translation: TranslationService) =>
  Effect.sync(() => {
    const local = createTranslationClient(translation)
    const ports: NativePorts = {
      settings: Effect.succeed({
        sourceLanguage: local.settings.sourceLanguage,
        initialStatus: configuration.created_files ? 'Created application configuration' : 'Ready',
        window: {
          width: configuration.window.width,
          height: configuration.window.height,
          minWidth: configuration.window.min_width,
          minHeight: configuration.window.min_height,
        },
      }),
      capture: Effect.fail<Fault>({ _tag: 'ActionRequired', message: 'Enter source text in the terminal input.' }),
      translate: local.translate,
      cancel: local.cancel,
      copy: (text) =>
        Effect.tryPromise({
          try: () => Clipboard.writeText(text),
          catch: (): Fault => ({ _tag: 'ActionRequired', message: 'The text could not be copied.' }),
        }),
      reveal: Effect.void,
      hide: Effect.void,
      quit: Effect.sync(() => Application.quit()),
      shortcuts: Stream.empty,
    }
    return { ports, commands: Stream.empty } satisfies NativeConnection
  })

export const connectTerminalRuntime = loadApplicationServices.pipe(
  Effect.flatMap(({ configuration, translation }) => connectTerminal(configuration, translation)),
)
