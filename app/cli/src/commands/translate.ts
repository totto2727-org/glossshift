import { loadConfig } from '@glossshift/runtime/config'
import type { TranslationService } from '@glossshift/runtime/translation'
import { Array, Effect, FileSystem, Option, Path } from 'effect'
import type { PlatformError, Stdio } from 'effect'
import { Argument, Command, Flag } from 'effect/cli'
import type { GlobalFlag } from 'effect/cli'

import { highlightMarkdown, runBatch } from '#cli/translate-batch.ts'
import { cliError } from '#cli/translation-error.ts'
import type { CliError } from '#cli/translation-error.ts'
import { normalizeLanguage } from '#cli/translation-plan.ts'
import type { BatchOptions } from '#cli/translation-plan.ts'

const initializeTranslation = Effect.gen(function* () {
  const module = yield* Effect.tryPromise({
    catch: () => cliError('The local translation runtime could not be loaded.'),
    try: () => import('@glossshift/runtime/translation'),
  })
  const config = yield* loadConfig
  return yield* module.makeTranslation(config)
})

const flags = {
  color: Flag.Literals('color', ['auto', 'always', 'never']).pipe(Flag.optional),
  files: Argument.String('files').pipe(Argument.variadic({ min: 1 })),
  force: Flag.Boolean('force').pipe(
    Flag.withDefault(false),
    Flag.withAlias('f'),
    Flag.withDescription('Replace existing translated files'),
  ),
  language: Flag.String('lang').pipe(
    Flag.withAlias('l'),
    Flag.withDescription('Target language code, such as ja or en'),
  ),
  stdout: Flag.Boolean('stdout').pipe(
    Flag.withDefault(false),
    Flag.withDescription('Write translations to standard output'),
  ),
}

type TranslateFlags = Command.Command.Config.Infer<typeof flags>

const parseFlags = ({
  files,
  language,
  force,
  stdout,
  color,
}: TranslateFlags): Effect.Effect<BatchOptions, CliError, Path.Path> =>
  Effect.gen(function* () {
    if (!Array.isReadonlyArrayNonEmpty(files)) {
      return yield* Effect.fail(cliError('at least one input file is required'))
    }
    if (force && stdout) {
      return yield* Effect.fail(cliError('--force cannot be used with --stdout'))
    }
    if (Option.isSome(color) && !stdout) {
      return yield* Effect.fail(cliError('--color requires --stdout'))
    }
    const normalized = yield* normalizeLanguage(language)
    const path = yield* Path.Path
    const resolved = Array.map(files, (file) => path.resolve(file))
    return stdout
      ? { color: Option.getOrElse(color, () => 'auto'), files: resolved, language: normalized, output: 'stdout' }
      : { files: resolved, force, language: normalized, output: 'files' }
  })

const ensureReadable = (file: string): Effect.Effect<void, CliError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(file).pipe(Effect.mapError(() => cliError(`input file '${file}' could not be read`)))
    if (info.type !== 'File') {
      return yield* Effect.fail(cliError(`input file '${file}' is not a regular file`))
    }
  })

/**
 * The command depends only on Effect services. Node services are selected by main.ts.
 *
 * @param {Effect.Effect} translation Lazy initialization of the translation service.
 * @returns {Command.Command} The CLI command with its file and output flags.
 */
export const makeTranslateCommand = <E, R>(
  translation: Effect.Effect<TranslationService, E, R>,
): Command.Command<
  'gshift',
  TranslateFlags,
  Effect.Success<Command.Command<'gshift', TranslateFlags>>,
  PlatformError.PlatformError | CliError | E,
  Stdio.Stdio | FileSystem.FileSystem | Path.Path | Exclude<R, GlobalFlag.Setting.Identifier<'log-level'>>
> =>
  Command.make('gshift', flags, (input) =>
    Effect.gen(function* () {
      const options = yield* parseFlags(input)
      const checkInputs = Effect.forEach(options.files, ensureReadable, { discard: true })
      const initialize = Effect.andThen(checkInputs, translation)
      return yield* runBatch(options, initialize, highlightMarkdown)
    }),
  ).pipe(Command.withDescription('Translate Markdown files with GlossShift’s local model'))

export const translateCommand = makeTranslateCommand(initializeTranslation)
