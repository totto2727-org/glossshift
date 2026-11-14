import { Array, Config, Data, Effect, FileSystem, Option, Path, Record, Schema, String } from 'effect'

import { defaultModelId, modelPresets } from './models.ts'

export type TranslationErrorCode =
  | 'InvalidRequest'
  | 'InvalidConfig'
  | 'UnsupportedLanguage'
  | 'ModelUnavailable'
  | 'IntegrityMismatch'
  | 'ContextTooLong'
  | 'OutputTooLong'
  | 'InferenceFailed'

export class TranslationError extends Data.TaggedError('TranslationError')<{
  readonly code: TranslationErrorCode
  readonly message: string
}> {}

export const ModelSource = Schema.Struct({
  uri: Schema.String,
  sha256: Schema.String,
  prompt: Schema.Literals(['plamo', 'chat']),
  supportedLanguages: Schema.optional(Schema.Array(Schema.String)),
})
export type ModelSource = typeof ModelSource.Type

export interface LocalConfig {
  readonly sourceLanguage: string
  readonly model: ModelSource
  readonly cacheDirectory: string
  readonly contextSize: number
  readonly maxTokens: number
}

// Official PFN GGUF repository, immutable revision and Git LFS SHA-256.
export const modelNotice =
  'Built with PLaMo. The default model is downloaded from PFN and uses the PLaMo Community License. Commercial use requires prior registration and eligibility. Review https://plamo.preferredai.jp/info/plamo-community-license-en before use.'

export const defaultModel: ModelSource = modelPresets[defaultModelId].model

const ModelId = Schema.Literals(Record.keys(modelPresets))

const ConfigFile = Schema.Struct({
  sourceLanguage: Schema.optional(Schema.String),
  model: Schema.optional(Schema.Union([ModelId, ModelSource])),
  cacheDirectory: Schema.optional(Schema.String),
  contextSize: Schema.optional(Schema.Int),
  maxTokens: Schema.optional(Schema.Int),
})

const invalidConfig = () =>
  new TranslationError({ code: 'InvalidConfig', message: 'The local translation configuration is invalid.' })

export const validateConfig = (config: LocalConfig) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const uri = yield* Effect.try({ try: () => new URL(config.model.uri), catch: invalidConfig })
    const preset = Array.findFirst(
      Record.values(modelPresets),
      (value) => value.model.sha256 === String.toLowerCase(config.model.sha256),
    )
    if (
      (uri.protocol !== 'https:' && uri.protocol !== 'file:') ||
      uri.username !== '' ||
      uri.password !== '' ||
      !/^[a-fA-F0-9]{64}$/.test(config.model.sha256) ||
      !path.isAbsolute(config.cacheDirectory) ||
      config.contextSize < 256 ||
      (Option.isSome(preset) && config.contextSize > preset.value.contextLimit) ||
      config.maxTokens < 1 ||
      config.maxTokens > config.contextSize ||
      !Number.isSafeInteger(config.contextSize) ||
      !Number.isSafeInteger(config.maxTokens)
    ) {
      return yield* Effect.fail(invalidConfig())
    }
    if (
      config.model.supportedLanguages !== undefined &&
      Array.some(config.model.supportedLanguages, (language) => !/^[a-z]{2,3}(?:-[a-z]{4})?$/.test(language))
    ) {
      return yield* Effect.fail(invalidConfig())
    }
    return { ...config, model: { ...config.model, sha256: String.toLowerCase(config.model.sha256) } }
  })

/** Configuration is read once by the application-scoped translation layer. */
export const loadConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const explicit = yield* Config.option(Config.String('GLOSSSHIFT_CONFIG'))
  const selectedModel = yield* Config.option(Config.String('GLOSSSHIFT_MODEL'))
  const home = yield* Config.option(Config.String('HOME'))
  const cache = yield* Config.option(Config.String('XDG_CACHE_HOME'))
  const configRoot = yield* Config.option(Config.String('XDG_CONFIG_HOME'))
  const configDirectory = Option.getOrElse(configRoot, () =>
    Option.isSome(home) ? path.join(home.value, '.config') : undefined,
  )
  const configFile = Option.getOrElse(explicit, () =>
    configDirectory === undefined ? undefined : path.join(configDirectory, 'glossshift', 'local.json'),
  )
  if (configFile === undefined || !path.isAbsolute(configFile)) return yield* Effect.fail(invalidConfig())
  const exists = yield* fs.exists(configFile)
  if (Option.isSome(explicit) && !exists) return yield* Effect.fail(invalidConfig())
  const values = exists
    ? yield* fs
        .readFileString(configFile)
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ConfigFile))))
    : {}
  const cacheRoot = Option.getOrElse(cache, () => (Option.isSome(home) ? path.join(home.value, '.cache') : undefined))
  const cacheDirectory =
    values.cacheDirectory ?? (cacheRoot === undefined ? undefined : path.join(cacheRoot, 'glossshift', 'models'))
  if (cacheDirectory === undefined) return yield* Effect.fail(invalidConfig())
  // Environment selection overrides only the file's model, never explicit cache or token settings.
  const selection = Option.isSome(selectedModel)
    ? yield* Schema.decodeUnknownEffect(ModelId)(selectedModel.value)
    : (values.model ?? defaultModelId)
  const model = typeof selection === 'string' ? modelPresets[selection].model : selection
  const preset = Array.findFirst(
    Record.values(modelPresets),
    (value) => value.model.sha256 === String.toLowerCase(model.sha256),
  )
  const contextSize = values.contextSize ?? Option.map(preset, (value) => value.contextSize).pipe(Option.getOrUndefined)
  if (contextSize === undefined)
    return yield* Effect.fail(
      new TranslationError({
        code: 'InvalidConfig',
        message:
          'Set contextSize in local.json to the custom GGUF model context limit. Unknown model artifacts have no default context size.',
      }),
    )
  return yield* validateConfig({
    sourceLanguage: values.sourceLanguage ?? 'auto',
    model,
    cacheDirectory,
    contextSize,
    // No implicit output cap: generation uses the space left after the tokenized prompt.
    maxTokens: values.maxTokens ?? contextSize,
  })
}).pipe(Effect.mapError((error) => (error instanceof TranslationError ? error : invalidConfig())))
