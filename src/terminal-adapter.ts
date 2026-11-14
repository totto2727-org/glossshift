import { spawn } from 'process'

import { Effect, Schema, Stream } from 'effect'
import { Clipboard } from 'nsh'
import { Application } from 'nsh/desktop'

import type { NativeConnection } from './application'
import { DesktopConfigurationJson } from './desktop-settings'
import type { DesktopConfiguration } from './desktop-settings'
import { connectLocal } from './local-client'
import type { LocalLauncher } from './local-client'
import type { Fault, NativePorts } from './ports'
import { readRuntimeSettings } from './runtime-settings'
import type { RuntimeSettings } from './runtime-settings'

const fault = (message: string): Fault => ({ _tag: 'ActionRequired', message })
const invalid = () => fault('The application settings could not be loaded. Check config.toml.')

/** A separate scoped, bounded bootstrap keeps OS settings out of the inference protocol. */
export const loadTerminalSettings = (runtime: RuntimeSettings) =>
  Effect.gen(function* () {
    const child = yield* Effect.acquireRelease(
      Effect.try({
        try: () => spawn(runtime.command, [runtime.entry, '--desktop-config'], { timeoutMs: 10_000, lines: true }),
        catch: invalid,
      }),
      (process) => Effect.try(() => process.kill()).pipe(Effect.ignore),
    )
    const json = yield* Effect.callback<string, Fault>((resume) => {
      let output = ''
      let lines = 0
      child.on('stdout', (line) => {
        lines += 1
        if (lines !== 1 || new TextEncoder().encode(line).byteLength > 65_536) {
          resume(Effect.fail(invalid()))
          child.kill()
        } else output = line
      })
      child.on('exit', ({ code }) =>
        resume(code === 0 && lines === 1 ? Effect.succeed(output) : Effect.fail(invalid())),
      )
    })
    return yield* Schema.decodeUnknownEffect(DesktopConfigurationJson)(json).pipe(Effect.mapError(invalid))
  }).pipe(Effect.scoped)

type ConfigurationLoader = (runtime: RuntimeSettings) => ReturnType<typeof loadTerminalSettings>

/** Terminal composition does not import or initialize the custom Rust module. */
export const connectTerminal = (
  runtime: RuntimeSettings,
  launcher?: LocalLauncher,
  loadSettings: ConfigurationLoader = loadTerminalSettings,
) =>
  Effect.gen(function* () {
    const config: DesktopConfiguration = yield* loadSettings(runtime)
    const local = yield* connectLocal(runtime, launcher)
    const ports: NativePorts = {
      settings: Effect.succeed({
        sourceLanguage: local.settings.sourceLanguage,
        initialStatus: config.created_files ? 'Created application configuration' : 'Ready',
        window: {
          width: config.window.width,
          height: config.window.height,
          minWidth: config.window.min_width,
          minHeight: config.window.min_height,
        },
      }),
      capture: Effect.fail(fault('Enter source text in the terminal input.')),
      translate: local.translate,
      cancel: local.cancel,
      copy: (text) =>
        Effect.tryPromise({
          try: () => Clipboard.writeText(text),
          catch: () => fault('The text could not be copied.'),
        }),
      reveal: Effect.void,
      hide: Effect.void,
      quit: Effect.sync(() => Application.quit()),
      shortcuts: Stream.empty,
    }
    return { ports, commands: local.failures } satisfies NativeConnection
  })

export const connectTerminalRuntime = readRuntimeSettings().pipe(Effect.flatMap((runtime) => connectTerminal(runtime)))
