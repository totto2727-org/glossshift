import type { TranslationService } from '@glossshift/runtime/translation'
import { Effect, Option, Stdio, Stream } from 'effect'

import { cliError } from './translationError.ts'
import type { CliError } from './translationError.ts'
import { prepareBatch, readSource, writeTranslation } from './translationFiles.ts'
import type { BatchOptions, ColorChoice } from './translationPlan.ts'

export const colorEnabled = (color: ColorChoice, stdoutIsTerminal: boolean): boolean =>
  color === 'always' || (color === 'auto' && stdoutIsTerminal)

/** Style the complete raw source without parsing or changing Markdown content. */
export const highlightMarkdown = (source: string) => Effect.succeed(source === '' ? '' : `\u001b[36m${source}\u001b[0m`)

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
