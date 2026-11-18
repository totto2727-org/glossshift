import { Array, Effect, Option, String } from 'effect'

import { cliError } from './translationError.ts'

export type ColorChoice = 'auto' | 'always' | 'never'
export type BatchOptions = {
  readonly files: Array.NonEmptyReadonlyArray<string>
  readonly language: string
} & ({ readonly output: 'files'; readonly force: boolean } | { readonly output: 'stdout'; readonly color: ColorChoice })

export const normalizeLanguage = (language: string) => {
  const trimmed = String.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')(language)
  const normalized = String.toLowerCase(trimmed)
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(trimmed)
    ? Effect.succeed(normalized)
    : Effect.fail(cliError('target language must be a non-empty language code'))
}

export const targetPath = (input: string, language: string) =>
  Effect.gen(function* () {
    const normalized = yield* normalizeLanguage(language)
    const slash = input.lastIndexOf('/')
    const name = String.slice(slash + 1)(input)
    const extension = String.endsWith('.mbt.md')(name) ? '.mbt.md' : '.md'
    if (!String.endsWith(extension)(name)) {
      return yield* Effect.fail(cliError(`input file '${input}' is not Markdown`))
    }
    const stem = String.replace(/\.(?:ja|en)$/, '')(String.slice(0, -extension.length)(name))
    return `${String.slice(0, slash + 1)(input)}${stem}.${normalized}${extension}`
  })

export const planBatch = (options: BatchOptions) =>
  Effect.forEach(options.files, (input) =>
    options.output === 'stdout'
      ? Effect.succeed({ input, output: Option.none<string>() })
      : Effect.map(targetPath(input, options.language), (output) => ({ input, output: Option.some(output) })),
  )
