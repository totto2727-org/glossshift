import type { TranslationService } from '@glossshift/runtime/translation'
import { String, Effect, Option, Stdio, Stream } from 'effect'
import type { FileSystem, Path, PlatformError } from 'effect'

import { cliError } from './translation-error.ts'
import type { CliError } from './translation-error.ts'
import { prepareBatch, readSource, writeTranslation } from './translation-files.ts'
import type { BatchOptions, ColorChoice } from './translation-plan.ts'

export const colorEnabled = (color: ColorChoice, stdoutIsTerminal: boolean): boolean =>
  color === 'always' || (color === 'auto' && stdoutIsTerminal)

/**
 * Style the complete raw source without parsing or changing Markdown content.
 *
 * @param {string} source Raw Markdown displayed in the terminal.
 * @returns {Effect.Effect} The original text wrapped in terminal styling.
 */
export const highlightMarkdown = (source: string): Effect.Effect<string, never, never> =>
  Effect.succeed(String.isEmpty(source) ? '' : `\u001B[36m${source}\u001B[0m`)

export const MAX_TRANSLATION_BYTES = 8_388_608
const initialTranslationBytes = 0

/**
 * Bound buffering independently of a provider's token accounting.
 *
 * @param {Stream.Stream} stream Translation chunks from the model.
 * @param {number} maximumBytes Maximum UTF-8 bytes across all chunks.
 * @returns {Stream.Stream} Chunks that fit the byte budget, followed by an error if it is exceeded.
 */
export const boundedTranslation = <E, R>(
  stream: Stream.Stream<string, E, R>,
  maximumBytes = MAX_TRANSLATION_BYTES,
): Stream.Stream<string, CliError | E, R> =>
  stream.pipe(
    Stream.mapAccumEffect(
      () => initialTranslationBytes,
      (size, delta: string): Effect.Effect<Readonly<[number, Readonly<string[]>]>, CliError> => {
        const next = size + new TextEncoder().encode(delta).byteLength
        return next > maximumBytes
          ? Effect.fail(cliError('translation exceeded the maximum output size'))
          : Effect.succeed([next, [delta]])
      },
    ),
  )

type BatchServices = Stdio.Stdio | FileSystem.FileSystem | Path.Path

/**
 * The engine constructor is lazy so invalid output paths never download or load a model.
 *
 * @param {BatchOptions} options Input order and destination policy.
 * @param {Effect.Effect} initializeTranslation Lazy translation service allocation.
 * @param {Function} renderMarkdown Styling to apply after buffering each terminal result.
 * @returns {Effect.Effect} The ordered batch operation.
 */
export const runBatch = <E, R>(
  options: BatchOptions,
  initializeTranslation: Effect.Effect<TranslationService, E, R>,
  renderMarkdown: (source: string) => Effect.Effect<string, CliError>,
): Effect.Effect<void, PlatformError.PlatformError | CliError | E, BatchServices | R> =>
  Effect.gen(function* () {
    const plan = yield* prepareBatch(options)
    const stdio = yield* Stdio.Stdio
    const translation = yield* initializeTranslation
    const colored = options.output === 'stdout' && colorEnabled(options.color, yield* stdio.stdoutIsTerminal)
    yield* Effect.forEach(
      plan,
      (entry) =>
        Effect.gen(function* () {
          const text = yield* readSource(entry.input)
          const stream = boundedTranslation(translation.stream({ targetLanguage: options.language, text })).pipe(
            Stream.mapError((error) => cliError(`failed to translate ${entry.input}: ${error.message}`)),
          )
          if (options.output === 'stdout' && !colored) {
            // The sink owns backpressure. No separator, newline, or Markdown transformation is added.
            yield* Stream.run(stream, stdio.stdout({ endOnDone: false }))
            return
          }
          const translated = yield* Stream.mkString(stream)
          if (options.output === 'stdout') {
            yield* renderMarkdown(translated).pipe(
              Effect.flatMap((highlighted) =>
                Stream.run(Stream.succeed(highlighted), stdio.stdout({ endOnDone: false })),
              ),
            )
          } else if (Option.isSome(entry.output)) {
            const destination = entry.output.value
            yield* writeTranslation({
              destination,
              force: options.force,
              inputs: options.files,
              translated,
            }).pipe(
              Effect.andThen(() =>
                Stream.run(Stream.succeed(`Written to ${destination}\n`), stdio.stderr({ endOnDone: false })),
              ),
            )
          }
        }),
      { discard: true },
    )
  })
