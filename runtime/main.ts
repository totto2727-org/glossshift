import { Array, Effect, Option, Path, Stdio, Stream } from 'effect'

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
    const parsed = yield* parseBatchArgs(args)
    const path = yield* Path.Path
    // The NSH filesystem has no cwd API. Resolve from the wrapper's injected original directory.
    const options = { ...parsed, files: Array.map(parsed.files, (file) => path.resolve(file)) }
    return yield* runBatch(options, initializeTranslation, highlightMarkdown)
  })

export const runProgram = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const args = yield* stdio.args
  if (Option.contains(Array.head(args), '--autostart')) {
    const { runAutostart } = yield* Effect.tryPromise({
      try: () => import('./autostart.ts'),
      catch: () => cliError('The autostart runtime could not be loaded.'),
    })
    return yield* runAutostart(Array.drop(args, 1))
  }
  return yield* runCli(args)
})
