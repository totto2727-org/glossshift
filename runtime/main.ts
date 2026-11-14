import { Array, Effect, FileSystem, Option, Path, Stdio, Stream } from 'effect'
import { Argument, CliConfig, CliOutput, Command, Flag, GlobalFlag } from 'effect/cli'

import { cliError, highlightMarkdown, normalizeLanguage, runBatch } from './cli.ts'
import type { BatchOptions } from './cli.ts'
import { loadConfig } from './config.ts'
import type { TranslationService } from './translation.ts'

const initializeTranslation = Effect.gen(function* () {
  const module = yield* Effect.tryPromise({
    try: () => import('./translation.ts'),
    catch: () => cliError('The local translation runtime could not be loaded.'),
  })
  const config = yield* loadConfig
  return yield* module.makeTranslation(config)
})

/** The command depends only on Effect services. Node services are selected by cli/main.ts. */
export const makeCommand = <E, R>(translation: Effect.Effect<TranslationService, E, R>) =>
  Command.make(
    'gshift',
    {
      files: Argument.String('files').pipe(Argument.variadic({ min: 1 })),
      language: Flag.String('lang').pipe(
        Flag.withAlias('l'),
        Flag.withDescription('Target language code, such as ja or en'),
      ),
      force: Flag.Boolean('force').pipe(
        Flag.withDefault(false),
        Flag.withAlias('f'),
        Flag.withDescription('Replace existing translated files'),
      ),
      stdout: Flag.Boolean('stdout').pipe(
        Flag.withDefault(false),
        Flag.withDescription('Write translations to standard output'),
      ),
      color: Flag.Literals('color', ['auto', 'always', 'never']).pipe(Flag.optional),
    },
    ({ files, language, force, stdout, color }) =>
      Effect.gen(function* () {
        if (!Array.isReadonlyArrayNonEmpty(files))
          return yield* Effect.fail(cliError('at least one input file is required'))
        if (force && stdout) return yield* Effect.fail(cliError('--force cannot be used with --stdout'))
        if (Option.isSome(color) && !stdout) return yield* Effect.fail(cliError('--color requires --stdout'))
        const normalized = yield* normalizeLanguage(language)
        const path = yield* Path.Path
        const resolved = Array.map(files, (file) => path.resolve(file))
        const options: BatchOptions = stdout
          ? { files: resolved, language: normalized, output: 'stdout', color: Option.getOrElse(color, () => 'auto') }
          : { files: resolved, language: normalized, output: 'files', force }
        const initialize = Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          for (const file of resolved) {
            const info = yield* fs
              .stat(file)
              .pipe(Effect.mapError(() => cliError(`input file '${file}' could not be read`)))
            if (info.type !== 'File') return yield* Effect.fail(cliError(`input file '${file}' is not a regular file`))
          }
          return yield* translation
        })
        return yield* runBatch(options, initialize, highlightMarkdown)
      }),
  ).pipe(Command.withDescription('Translate Markdown files with GlossShift’s local model'))

export const command = makeCommand(initializeTranslation)

export const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const formatter = CliOutput.defaultFormatter({ colors: false })
    const present: CliOutput.Presenter['present'] = (event) => {
      const invalid = event._tag === 'InvalidInvocation'
      const text =
        event._tag === 'Version'
          ? formatter.formatVersion(event.name, event.version)
          : formatter.formatHelpDoc(event.helpDoc) + (invalid ? `\n${formatter.formatErrors(event.errors)}` : '')
      return Stream.run(
        Stream.succeed(`${text}\n`),
        (invalid ? stdio.stderr : stdio.stdout)({ endOnDone: false }),
      ).pipe(Effect.orDie)
    }
    return yield* Command.runWith(command, { version: '0.2.0' })(args.length === 0 ? ['--help'] : args).pipe(
      Effect.provideService(CliOutput.Presenter, { present }),
      Effect.provideService(CliConfig.CliConfig, {
        builtIns: [GlobalFlag.Help, { ...GlobalFlag.Version, flag: GlobalFlag.Version.flag.pipe(Flag.withAlias('V')) }],
      }),
    )
  })

/** Keep the desktop launcher's private autostart invocation compatible without loading desktop services. */
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
