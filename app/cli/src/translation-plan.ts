import type { Array } from 'effect'
import { Effect, Option, String } from 'effect'

import type { CliError } from './translation-error.ts'
import { cliError } from './translation-error.ts'

export type ColorChoice = 'auto' | 'always' | 'never'
export type BatchOptions = Readonly<{
  files: Array.NonEmptyReadonlyArray<string>
  language: string
}> &
  (Readonly<{ output: 'files'; force: boolean }> | Readonly<{ output: 'stdout'; color: ColorChoice }>)

export const normalizeLanguage = (language: string): Effect.Effect<Lowercase<string>, CliError> => {
  const trimmed = String.replaceAll(/^\p{White_Space}+|\p{White_Space}+$/gu, '')(language)
  const normalized = String.toLowerCase(trimmed)
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(trimmed)
    ? Effect.succeed(normalized)
    : Effect.fail(cliError('target language must be a non-empty language code'))
}

const beginningOfPath = 0
const slashLength = 1

export const targetPath = (input: string, language: string): Effect.Effect<string, CliError> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeLanguage(language)
    const slash = input.lastIndexOf('/')
    const nameStart = slash + slashLength
    const name = String.slice(nameStart)(input)
    const extension = String.endsWith('.mbt.md')(name) ? '.mbt.md' : '.md'
    if (!String.endsWith(extension)(name)) {
      return yield* Effect.fail(cliError(`input file '${input}' is not Markdown`))
    }
    const stem = String.replace(/\.(?:ja|en)$/u, '')(String.slice(beginningOfPath, -extension.length)(name))
    return `${String.slice(beginningOfPath, nameStart)(input)}${stem}.${normalized}${extension}`
  })

export interface PlannedFile {
  input: string
  output: Option.Option<string>
}

export const planBatch = (options: BatchOptions): Effect.Effect<Array.NonEmptyArray<PlannedFile>, CliError> =>
  Effect.forEach(options.files, (input) =>
    options.output === 'stdout'
      ? Effect.succeed({ input, output: Option.none<string>() })
      : Effect.map(targetPath(input, options.language), (output) => ({ input, output: Option.some(output) })),
  )
