import { Array, Effect, Option, Stdio, Stream, String } from 'effect'

import { prepareBatch, readSource, writeTranslation } from './cli-files.ts'
import type { TranslationService } from './translation.ts'

export interface CliError {
  readonly _tag: 'CliError'
  readonly message: string
}

export const cliError = (message: string): CliError => ({ _tag: 'CliError', message })
export type ColorChoice = 'auto' | 'always' | 'never'
export type BatchOptions = {
  readonly files: Array.NonEmptyReadonlyArray<string>
  readonly language: string
} & ({ readonly output: 'files'; readonly force: boolean } | { readonly output: 'stdout'; readonly color: ColorChoice })

export const normalizeLanguage = (language: string) => {
  // Lowercase only ASCII, as the retained Rust CLI does.
  const trimmed = String.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')(language)
  const normalized = String.toLowerCase(trimmed)
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(trimmed)
    ? Effect.succeed(normalized)
    : Effect.fail(cliError('target language must be a non-empty language code'))
}

/** Parse batch arguments only. The launcher owns no-argument and --tui dispatch. */
export const parseBatchArgs = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let files: ReadonlyArray<string> = []
    let language: string | undefined
    let force = false
    let stdout = false
    let color: ColorChoice = 'auto'
    let colorSpecified = false
    let positional = false
    for (let index = 0; index < args.length; index += 1) {
      const argument = yield* Array.get(args, index).pipe(
        Option.match({ onNone: () => Effect.fail(cliError('missing argument')), onSome: Effect.succeed }),
      )
      if (positional || !String.startsWith('-')(argument) || argument === '-') {
        files = Array.append(files, argument)
      } else if (argument === '--') {
        positional = true
      } else if (argument === '--force' || argument === '-f') {
        if (force) return yield* Effect.fail(cliError('--force cannot be used multiple times'))
        force = true
      } else if (argument === '--stdout') {
        if (stdout) return yield* Effect.fail(cliError('--stdout cannot be used multiple times'))
        stdout = true
      } else if (
        argument === '--lang' ||
        argument === '-l' ||
        argument === '--color' ||
        String.startsWith('--lang=')(argument) ||
        String.startsWith('--color=')(argument) ||
        (String.startsWith('-l')(argument) && argument.length > 2)
      ) {
        const isLanguage =
          argument === '-l' || String.startsWith('--lang')(argument) || String.startsWith('-l')(argument)
        const equals = argument.indexOf('=')
        let value: string
        if (equals >= 0) value = String.slice(equals + 1)(argument)
        else if (String.startsWith('-l')(argument) && argument.length > 2) value = String.slice(2)(argument)
        else {
          index += 1
          value = yield* Array.get(args, index).pipe(
            Option.match({
              onNone: () => Effect.fail(cliError(`missing value for ${argument}`)),
              onSome: Effect.succeed,
            }),
          )
          if (String.startsWith('-')(value)) return yield* Effect.fail(cliError(`missing value for ${argument}`))
        }
        if (isLanguage) {
          if (language !== undefined) return yield* Effect.fail(cliError('--lang cannot be used multiple times'))
          language = value
        } else {
          if (colorSpecified) return yield* Effect.fail(cliError('--color cannot be used multiple times'))
          if (value !== 'auto' && value !== 'always' && value !== 'never') {
            return yield* Effect.fail(cliError('--color must be auto, always, or never'))
          }
          color = value
          colorSpecified = true
        }
      } else return yield* Effect.fail(cliError(`unexpected argument '${argument}'`))
    }
    if (!Array.isReadonlyArrayNonEmpty(files))
      return yield* Effect.fail(cliError('at least one input file is required'))
    if (language === undefined) return yield* Effect.fail(cliError('--lang is required'))
    if (force && stdout) return yield* Effect.fail(cliError('--force cannot be used with --stdout'))
    if (colorSpecified && !stdout) return yield* Effect.fail(cliError('--color requires --stdout'))
    const normalized = yield* normalizeLanguage(language)
    const options: BatchOptions = stdout
      ? { files, language: normalized, output: 'stdout', color }
      : { files, language: normalized, output: 'files', force }
    return options
  })

export const colorEnabled = (color: ColorChoice, stdoutIsTerminal: boolean): boolean =>
  color === 'always' || (color === 'auto' && stdoutIsTerminal)

/** Style the complete raw source without parsing or changing Markdown content. */
export const highlightMarkdown = (source: string) => Effect.succeed(source === '' ? '' : `\u001b[36m${source}\u001b[0m`)

/** No Markdown parsing, trimming, fence removal, or newline insertion is performed. */
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

export const MAX_TRANSLATION_BYTES = 8 * 1024 * 1024

/** Bound buffering independently of a provider's token accounting. */
export const boundedTranslation = <E, R>(stream: Stream.Stream<string, E, R>, maximumBytes = MAX_TRANSLATION_BYTES) =>
  stream.pipe(
    Stream.mapAccumEffect(
      () => 0,
      (size, delta: string): Effect.Effect<readonly [number, ReadonlyArray<string>], CliError> => {
        const next = size + new TextEncoder().encode(delta).byteLength
        return next > maximumBytes
          ? Effect.fail(cliError('translation exceeded the maximum output size'))
          : Effect.succeed([next, [delta]])
      },
    ),
  )

/** The engine constructor is lazy so invalid output paths never download or load a model. */
export const runBatch = <E, R>(
  options: BatchOptions,
  initializeTranslation: Effect.Effect<TranslationService, E, R>,
  highlightMarkdown: (source: string) => Effect.Effect<string, CliError>,
) =>
  Effect.gen(function* () {
    const plan = yield* prepareBatch(options)
    const stdio = yield* Stdio.Stdio
    const translation = yield* initializeTranslation
    const colored = options.output === 'stdout' && colorEnabled(options.color, yield* stdio.stdoutIsTerminal)
    for (const entry of plan) {
      const text = yield* readSource(entry.input)
      const stream = boundedTranslation(translation.stream({ text, targetLanguage: options.language })).pipe(
        Stream.mapError((error) => cliError(`failed to translate ${entry.input}: ${error.message}`)),
      )
      if (options.output === 'stdout' && !colored) {
        // The sink owns backpressure. No separator, newline, or Markdown transformation is added.
        yield* Stream.run(stream, stdio.stdout({ endOnDone: false }))
        continue
      }
      const translated = yield* Stream.mkString(stream)
      if (options.output === 'stdout') {
        const highlighted = yield* highlightMarkdown(translated)
        yield* Stream.run(Stream.succeed(highlighted), stdio.stdout({ endOnDone: false }))
      } else if (Option.isSome(entry.output)) {
        yield* writeTranslation(entry.output.value, translated, options.force, options.files)
        yield* Stream.run(Stream.succeed(`Written to ${entry.output.value}\n`), stdio.stderr({ endOnDone: false }))
      }
    }
  })
