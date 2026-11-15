import { Array, Context, Effect, Exit, Layer, Option, Result, Schema, Scope, Semaphore, Stream } from 'effect'
import { AiError, LanguageModel } from 'effect/ai'
import type { Response } from 'effect/ai'

import { loadConfig, TranslationError, validateConfig } from './config.ts'
import type { LocalConfig } from './config.ts'
import { generate } from './generation.ts'
import { loadModel } from './model.ts'
import { makePrompt } from './prompt.ts'
import type { TranslationRequest } from './prompt.ts'
import type { LocalServer } from './server-api.ts'

export { TranslationError } from './config.ts'
export { TranslationRequest, normalizeLanguage } from './prompt.ts'

export interface TranslationService {
  readonly settings: {
    readonly sourceLanguage: string
    readonly model: string
  }
  readonly stream: (request: TranslationRequest) => Stream.Stream<string, TranslationError>
}

export const Translation = Context.Service<TranslationService>('GlossShift/LocalTranslation')

const PublicFailure = Schema.Struct({
  code: Schema.Literals([
    'InvalidRequest',
    'InvalidConfig',
    'UnsupportedLanguage',
    'ModelUnavailable',
    'IntegrityMismatch',
    'ContextTooLong',
    'OutputTooLong',
    'InferenceFailed',
  ]),
  message: Schema.String,
})

const toAiError = (error: TranslationError) =>
  new AiError.AiError({
    module: 'GlossShift/LocalTranslation',
    method: 'streamText',
    reason: new AiError.UnknownError({ metadata: { glossshift: { code: error.code, message: error.message } } }),
  })

const fromAiError = (error: AiError.AiError): TranslationError =>
  Option.match(
    Schema.decodeUnknownOption(PublicFailure)(
      error.reason._tag === 'UnknownError' ? error.reason.metadata['glossshift'] : undefined,
    ),
    {
      onNone: () =>
        new TranslationError({
          code: 'InferenceFailed',
          message: 'The local model returned an invalid translation response.',
        }),
      onSome: (failure) => new TranslationError(failure),
    },
  )

/** One server per application scope and at most one active inference request. */
export const makeTranslation = (input: LocalConfig) =>
  Effect.gen(function* () {
    const config = yield* validateConfig(input)
    const applicationScope = yield* Effect.scope
    const environment = yield* Effect.context<Effect.Services<ReturnType<typeof loadModel>>>()
    let model = Option.none<LocalServer>()
    // A failed or interrupted first load must not poison the cache or retain partial native resources.
    // The request semaphore below also serializes initialization.
    const getModel = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (Option.isSome(model)) return model.value
        const allocationScope = yield* Scope.make()
        const result = yield* restore(
          loadModel(config).pipe(
            Effect.provideService(Scope.Scope, allocationScope),
            Effect.provideContext(environment),
          ),
        ).pipe(Effect.exit)
        if (Exit.isFailure(result)) {
          yield* Scope.close(allocationScope, result)
          return yield* Effect.failCause(result.cause)
        }
        yield* Scope.addFinalizer(applicationScope, Scope.close(allocationScope, Exit.void))
        model = Option.some(result.value)
        return result.value
      }),
    )
    const lock = yield* Semaphore.make(1)
    const providerStream = (
      options: LanguageModel.ProviderOptions,
    ): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> => {
      if (options.tools.length > 0 || options.responseFormat.type !== 'text') {
        return Stream.fail(
          toAiError(
            new TranslationError({
              code: 'InvalidRequest',
              message: 'The local translation model supports text translation only.',
            }),
          ),
        )
      }
      return Stream.succeed<Response.StreamPartEncoded>({ type: 'text-start', id: 'translation' }).pipe(
        Stream.concat(
          Stream.unwrap(Effect.map(getModel, (loaded) => generate(loaded, config, options.prompt))).pipe(
            Stream.map((delta): Response.StreamPartEncoded => ({ type: 'text-delta', id: 'translation', delta })),
            Stream.mapError(toAiError),
          ),
        ),
        Stream.concat(Stream.succeed<Response.StreamPartEncoded>({ type: 'text-end', id: 'translation' })),
      )
    }
    const ai = yield* LanguageModel.make({
      streamText: providerStream,
      generateText: (options) =>
        providerStream(options).pipe(
          Stream.runCollect,
          Effect.map((parts): Array<Response.PartEncoded> => [
            {
              type: 'text',
              text: Array.join(
                Array.filterMap(parts, (part) =>
                  part.type === 'text-delta' ? Result.succeed(part.delta) : Result.failVoid,
                ),
                '',
              ),
            },
          ]),
        ),
    })
    return Translation.of({
      settings: { sourceLanguage: config.sourceLanguage, model: config.model.uri },
      stream: (request) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const prompt = yield* makePrompt(
              { ...request, sourceLanguage: request.sourceLanguage ?? config.sourceLanguage },
              config,
            )
            yield* lock.takeScoped(1)
            // Every translation passes through Effect AI's real prompt normalization and response decoder.
            return ai.streamText({ prompt }).pipe(
              Stream.filterMap((part) => (part.type === 'text-delta' ? Result.succeed(part.delta) : Result.failVoid)),
              Stream.mapError(fromAiError),
            )
          }),
        ),
    })
  })

export const TranslationLive = Layer.effect(Translation, Effect.flatMap(loadConfig, makeTranslation))
