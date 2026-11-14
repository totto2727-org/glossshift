import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Array, ConfigProvider, Effect, Option, Schema, Stdio, Stream } from 'effect'

import { DesktopConfigurationJson } from '../src/desktop-settings.ts'
import { cliError, highlightMarkdown, parseBatchArgs, runBatch } from './cli.ts'
import { loadConfig } from './config.ts'

const help = `Translate Markdown files with GlossShift's local model

Usage: gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]

Arguments:
  <FILES>...              Markdown files to translate in input order

Options:
  -l, --lang <LANGUAGE>   Target language code, such as ja or en
  -f, --force             Overwrite an existing translated file
      --stdout            Write raw translation to standard output
      --color <MODE>      ANSI highlighting: auto, always, never [default: auto]
  -h, --help              Print help
  -V, --version           Print version

Run gshift without arguments or with --tui to start the terminal UI.
`

const initializeTranslation = Effect.gen(function* () {
  const module = yield* Effect.tryPromise({
    try: () => import('./translation.ts'),
    catch: () => cliError('The local translation runtime could not be loaded.'),
  })
  // Configuration and model lifetime belong to the outer application scope.
  const config = yield* loadConfig
  return yield* module.makeTranslation(config)
})

export const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const flags = Array.takeWhile(args, (argument) => argument !== '--')
    if (Array.contains(flags, '--help') || Array.contains(flags, '-h')) {
      return yield* Stream.run(Stream.succeed(help), stdio.stdout({ endOnDone: false }))
    }
    if (Array.contains(flags, '--version') || Array.contains(flags, '-V')) {
      return yield* Stream.run(Stream.succeed('gshift 0.2.0\n'), stdio.stdout({ endOnDone: false }))
    }
    const options = yield* parseBatchArgs(args)
    return yield* runBatch(options, initializeTranslation, highlightMarkdown)
  })

const program = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const args = yield* stdio.args
  if (Option.contains(Array.head(args), '--autostart')) {
    const { runAutostart } = yield* Effect.tryPromise({
      try: () => import('./autostart.ts'),
      catch: () => cliError('The autostart runtime could not be loaded.'),
    })
    return yield* runAutostart(Array.drop(args, 1)).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
    )
  }
  if (Option.contains(Array.head(args), '--desktop-config')) {
    if (args.length !== 1) return yield* Effect.fail(cliError('Invalid settings bootstrap arguments.'))
    const { loadDesktopConfig } = yield* Effect.tryPromise({
      try: () => import('./desktop-config.ts'),
      catch: () => cliError('The application settings runtime could not be loaded.'),
    })
    const config = yield* loadDesktopConfig
    const json = yield* Schema.encodeEffect(DesktopConfigurationJson)(config)
    return yield* Stream.run(Stream.succeed(`${json}\n`), stdio.stdout({ endOnDone: false }))
  }
  if (Option.contains(Array.head(args), '--sidecar')) {
    const module = yield* Effect.tryPromise({
      try: () => import('./sidecar.ts'),
      catch: () => cliError('The local translation process could not be started.'),
    })
    return yield* module.runSidecar
  }
  return yield* runCli(args)
})

NodeRuntime.runMain(
  Effect.scoped(program).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const stdio = yield* Stdio.Stdio
        yield* Stream.run(Stream.succeed(`gshift failed: ${error.message}\n`), stdio.stderr({ endOnDone: false }))
        return yield* Effect.fail(error)
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
  { disableErrorReporting: true },
)
