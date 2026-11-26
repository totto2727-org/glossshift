import {
  Predicate,
  Array,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'
import type { FileSystem, Path, Stdio } from 'effect'
import { AiError, LanguageModel } from 'effect/ai'
import type { Response } from 'effect/ai'
import type { ChildProcessSpawner } from 'effect/process'

import { loadConfig, TranslationError, validateConfig } from './config.ts'
import type { LocalConfig } from './config.ts'
import { generate } from './generation.ts'
import { loadModel } from './model.ts'
import { makePrompt } from './prompt.ts'
import type { TranslationRequest } from './prompt.ts'
import type { LocalServer } from './server-api.ts'

export { TranslationError } from './config.ts'
export { TranslationRequest, normalizeLanguage } from './prompt.ts'

export type TranslationService = Readonly<{
  settings: Readonly<{
    sourceLanguage: string
    model: string
  }>
  stream: (request: TranslationRequest) => Stream.Stream<string, TranslationError>
}>

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
const decodePublicFailure = Schema.decodeUnknownOption(PublicFailure)

const toAiError = (error: TranslationError): AiError.AiError =>
  new AiError.AiError({
    method: 'streamText',
    module: 'GlossShift/LocalTranslation',
    reason: new AiError.UnknownError({ metadata: { glossshift: { code: error.code, message: error.message } } }),
  })

const fromAiError = (error: AiError.AiError): TranslationError =>
  Option.match(
    decodePublicFailure(
      Predicate.isTagged('UnknownError')(error.reason) ? error.reason.metadata['glossshift'] : undefined,
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

type ModelEnvironment = Effect.Services<ReturnType<typeof loadModel>>

interface ModelAllocation {
  model: Ref.Ref<Option.Option<LocalServer>>
  scope: Scope.Scope
}

const rememberModel = (
  cache: ModelAllocation,
  scope: Scope.Closeable,
  loaded: Exit.Exit<LocalServer, TranslationError>,
): Effect.Effect<LocalServer, TranslationError> =>
  Effect.gen(function* () {
    if (Exit.isFailure(loaded)) {
      yield* Scope.close(scope, loaded)
      return yield* Effect.failCause(loaded.cause)
    }
    yield* Scope.addFinalizer(cache.scope, Scope.close(scope, Exit.void))
    yield* Ref.set(cache.model, Option.some(loaded.value))
    return loaded.value
  })

const lazyModel = (
  config: LocalConfig,
): Effect.Effect<Effect.Effect<LocalServer, TranslationError>, never, ModelEnvironment> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const environment = yield* Effect.context<ModelEnvironment>()
    const model = yield* Ref.make(Option.none<LocalServer>())
    // A failed or interrupted first load leaves the cache empty and releases its partial resources.
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const cached = yield* Ref.get(model)
        if (Option.isSome(cached)) {
          return cached.value
        }
        const allocation = yield* Scope.make()
        const start = loadModel(config).pipe(
          Effect.provideService(Scope.Scope, allocation),
          Effect.provideContext(environment),
        )
        const loaded = yield* restore(start).pipe(Effect.exit)
        return yield* rememberModel({ model, scope }, allocation, loaded)
      }),
    )
  })

const unsupportedPrompt = (): AiError.AiError =>
  toAiError(
    new TranslationError({
      code: 'InvalidRequest',
      message: 'The local translation model supports text translation only.',
    }),
  )

const streamProvider =
  (config: LocalConfig, getModel: Effect.Effect<LocalServer, TranslationError>) =>
  (options: LanguageModel.ProviderOptions): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> => {
    if (Array.isReadonlyArrayNonEmpty(options.tools) || options.responseFormat.type !== 'text') {
      return Stream.fail(unsupportedPrompt())
    }
    const start = Stream.succeed<Response.StreamPartEncoded>({ id: 'translation', type: 'text-start' })
    const end = Stream.succeed<Response.StreamPartEncoded>({ id: 'translation', type: 'text-end' })
    const generation = Effect.map(getModel, (loaded) => generate(loaded, config, options.prompt))
    const text = Stream.unwrap(generation).pipe(
      Stream.map((delta): Response.StreamPartEncoded => ({ delta, id: 'translation', type: 'text-delta' })),
      Stream.mapError(toAiError),
    )
    return start.pipe(Stream.concat(text), Stream.concat(end))
  }

const encodedParts = (parts: Readonly<Response.StreamPartEncoded[]>): Response.PartEncoded[] => {
  const deltas = Array.filterMap(parts, (part) =>
    part.type === 'text-delta' ? Result.succeed(part.delta) : Result.failVoid,
  )
  return [{ text: Array.join(deltas, ''), type: 'text' }]
}

const inferencePermits = 1

interface TranslationProvider {
  ai: Effect.Success<ReturnType<typeof LanguageModel.make>>
  config: LocalConfig
  lock: Semaphore.Semaphore
}

const streamTranslation = (
  provider: TranslationProvider,
  request: TranslationRequest,
): Stream.Stream<string, TranslationError> => {
  const { ai, config, lock } = provider
  const prepare = Effect.gen(function* () {
    const prompt = yield* makePrompt(
      { ...request, sourceLanguage: request.sourceLanguage ?? config.sourceLanguage },
      config,
    )
    yield* lock.takeScoped(inferencePermits)
    // Effect AI normalizes the prompt and decodes every response.
    return ai.streamText({ prompt }).pipe(
      Stream.filterMap((part) => (part.type === 'text-delta' ? Result.succeed(part.delta) : Result.failVoid)),
      Stream.mapError(fromAiError),
    )
  })
  return Stream.unwrap(prepare)
}

/**
 * One server per application scope and at most one active inference request.
 *
 * @param {LocalConfig} input Configuration for the model and its local server.
 * @returns {Effect.Effect} Translation service that starts the server on the first request.
 */
export const makeTranslation = (
  input: LocalConfig,
): Effect.Effect<
  TranslationService,
  TranslationError,
  Path.Path | FileSystem.FileSystem | Stdio.Stdio | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const config = yield* validateConfig(input)
    const getModel = yield* lazyModel(config)
    const lock = yield* Semaphore.make(inferencePermits)
    const streamText = streamProvider(config, getModel)
    const ai = yield* LanguageModel.make({
      generateText: (options) => streamText(options).pipe(Stream.runCollect, Effect.map(encodedParts)),
      streamText,
    })
    const provider = { ai, config, lock }
    return Translation.of({
      settings: { model: config.model.uri, sourceLanguage: config.sourceLanguage },
      stream: (request) => streamTranslation(provider, request),
    })
  })

export const TranslationLive = Layer.effect(Translation, Effect.flatMap(loadConfig, makeTranslation))
