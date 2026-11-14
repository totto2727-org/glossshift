import process from 'process'

import { Effect, Stream } from 'effect'

import type { NativeConnection } from './application'
import { desktopControls } from './desktop-controls'
import { connectDesktopShortcuts } from './desktop-shortcuts'
import { installDesktopWindow } from './desktop-window'
import { connectLocal } from './local-client'
import type { LocalLauncher } from './local-client'
import type { Fault, NativePorts } from './ports'
import { readRuntimeSettings } from './runtime-settings'
import type { RuntimeSettings } from './runtime-settings'
import { readSelectionClient } from './selection-client'
import type { createSelectionClient } from './selection-client'
import { loadTerminalSettings } from './terminal-adapter'

export interface DesktopAdapterOptions {
  readonly runtime: RuntimeSettings
  readonly selection: ReturnType<typeof createSelectionClient>
  readonly background: boolean
  readonly launcher?: LocalLauncher
  readonly loadSettings?: typeof loadTerminalSettings
  readonly installControls?: typeof desktopControls.install
  readonly installWindow?: typeof installDesktopWindow
  readonly connectShortcuts?: typeof connectDesktopShortcuts
}

/** Official NSH owns desktop controls; Accessibility stays in a separate Swift process. */
export const connectDesktop = (options: DesktopAdapterOptions) =>
  Effect.gen(function* () {
    const configuration = yield* (options.loadSettings ?? loadTerminalSettings)(options.runtime)
    const desktop = yield* options.installControls ?? desktopControls.install
    const granted = yield* options.selection.permission
    const local = yield* connectLocal(options.runtime, options.launcher)
    yield* (options.installWindow ?? installDesktopWindow)(configuration, options.background)
    const commands = yield* (options.connectShortcuts ?? connectDesktopShortcuts)(
      configuration,
      options.selection.capture,
    )
    const ports: NativePorts = {
      settings: Effect.succeed({
        sourceLanguage: local.settings.sourceLanguage,
        initialStatus: !granted
          ? 'Enable Accessibility access for GlossShift in System Settings.'
          : configuration.created_files
            ? 'Created application configuration'
            : 'Ready',
        window: {
          width: configuration.window.width,
          height: configuration.window.height,
          minWidth: configuration.window.min_width,
          minHeight: configuration.window.min_height,
        },
      }),
      capture: options.selection.capture,
      translate: local.translate,
      cancel: local.cancel,
      copy: desktop.copy,
      reveal: desktop.reveal,
      hide: desktop.hide,
      quit: desktop.quit,
      shortcuts: Stream.empty,
    }
    return { ports, commands: Stream.merge(commands, local.failures) } satisfies NativeConnection
  })

export const connectDesktopRuntime = Effect.gen(function* () {
  const runtime = yield* readRuntimeSettings()
  const selection = yield* readSelectionClient()
  const background = process.env['GLOSSSHIFT_BACKGROUND']
  if (background !== undefined && background !== '0' && background !== '1') {
    return yield* Effect.fail<Fault>({ _tag: 'ActionRequired', message: 'The desktop startup mode is invalid.' })
  }
  return yield* connectDesktop({ runtime, selection, background: background === '1' })
}).pipe(Effect.tapError(() => desktopControls.controls.reveal.pipe(Effect.ignore)))
