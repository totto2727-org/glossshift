import { loadConfig } from '@glossshift/runtime/config'
import type { TranslationService } from '@glossshift/runtime/translation'
import { Array, Effect, FileSystem, Option, Path } from 'effect'
import { Argument, Command, Flag } from 'effect/cli'

import { highlightMarkdown, runBatch } from '../translateBatch.ts'
import { cliError } from '../translationError.ts'
import { normalizeLanguage } from '../translationPlan.ts'
import type { BatchOptions } from '../translationPlan.ts'

const initializeTranslation = Effect.gen(function* () {
  const module = yield* Effect.tryPromise({
    try: () => import('@glossshift/runtime/translation'),
    catch: () => cliError('The local translation runtime could not be loaded.'),
  })
  const config = yield* loadConfig
  return yield* module.makeTranslation(config)
})

/** The command depends only on Effect services. Node services are selected by main.ts. */
export const makeTranslateCommand = <E, R>(translation: Effect.Effect<TranslationService, E, R>) =>
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

export const translateCommand = makeTranslateCommand(initializeTranslation)
