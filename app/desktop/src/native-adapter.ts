import type { TranslationService } from '@glossshift/runtime/translation'
import { Effect, Stream } from 'effect'
import type { Scope } from 'effect'

import type { NativeConnection } from './application.tsx'
import { desktopControls } from './desktop-controls.ts'
import type { DesktopConfiguration } from './desktop-settings.ts'
import { connectDesktopShortcuts } from './desktop-shortcuts.ts'
import { installDesktopWindow } from './desktop-window.ts'
import type { Fault, NativePorts } from './ports.ts'
import type { createSelectionClient } from './selection-client.ts'
import { createTranslationClient } from './translation-client.ts'

export type DesktopAdapterOptions = Readonly<{
  configuration: DesktopConfiguration
  translation: TranslationService
  selection: ReturnType<typeof createSelectionClient>
  background: boolean
  installControls?: typeof desktopControls.install
  installWindow?: typeof installDesktopWindow
  connectShortcuts?: typeof connectDesktopShortcuts
}>

const initialStatus = (granted: boolean, created: boolean): string => {
  if (granted) {
    return created ? 'Created application configuration' : 'Ready'
  }
  return 'Enable Accessibility access for GlossShift in System Settings.'
}

/**
 * Official NSH owns desktop controls; Accessibility stays in a separate Swift process.
 *
 * @param {DesktopAdapterOptions} options Configuration and injected selection, translation, and control services.
 * @returns {Effect.Effect} The initialized desktop connection for the popup scope.
 */
export const connectDesktop = (options: DesktopAdapterOptions): Effect.Effect<NativeConnection, Fault, Scope.Scope> =>
  Effect.gen(function* () {
    const { configuration } = options
    const desktop = yield* options.installControls ?? desktopControls.install
    const granted = yield* options.selection.permission
    const local = createTranslationClient(options.translation)
    yield* (options.installWindow ?? installDesktopWindow)(configuration, options.background)
    const commands = yield* (options.connectShortcuts ?? connectDesktopShortcuts)(
      configuration,
      options.selection.capture,
    )
    const ports: NativePorts = {
      cancel: local.cancel,
      capture: options.selection.capture,
      copy: desktop.copy,
      hide: desktop.hide,
      quit: desktop.quit,
      reveal: desktop.reveal,
      settings: Effect.succeed({
        initialStatus: initialStatus(granted, configuration.created_files),
        sourceLanguage: local.settings.sourceLanguage,
        window: {
          height: configuration.window.height,
          minHeight: configuration.window.min_height,
          minWidth: configuration.window.min_width,
          width: configuration.window.width,
        },
      }),
      shortcuts: Stream.empty,
      translate: local.translate,
    }
    return { commands, ports } satisfies NativeConnection
  })
