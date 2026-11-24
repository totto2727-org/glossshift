import type { PlatformError } from 'effect'
import { Predicate, Array, Config, Data, Effect, FileSystem, Option, Path, Record, Schema, String } from 'effect'

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

export class TranslationError extends Data.TaggedError('TranslationError')<
  Readonly<{
    code: TranslationErrorCode
    message: string
  }>
> {}

// oxlint-disable-next-line eslint/no-redeclare -- Existing runtime consumers use the same public name for the schema and its TypeScript type.
export const ModelSource = Schema.Struct({
  prompt: Schema.Literals(['plamo', 'chat']),
  sha256: Schema.String,
  supportedLanguages: Schema.optional(Schema.Array(Schema.String)),
  uri: Schema.String,
})
export type ModelSource = typeof ModelSource.Type

export type LocalConfig = Readonly<{
  sourceLanguage: string
  model: ModelSource
  cacheDirectory: string
  contextSize: number
  maxTokens: number
}>

// Official PFN GGUF repository, immutable revision and Git LFS SHA-256.
export const modelNotice =
  'Built with PLaMo. The default model is downloaded from PFN and uses the PLaMo Community License. Commercial use requires prior registration and eligibility. Review https://plamo.preferredai.jp/info/plamo-community-license-en before use.'

export const defaultModel: ModelSource = modelPresets[defaultModelId].model

const ModelId = Schema.Literals(Record.keys(modelPresets))
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The environment value must be validated against the supported model IDs.
const decodeModelId = Schema.decodeUnknownEffect(ModelId)

const ConfigFile = Schema.Struct({
  cacheDirectory: Schema.optional(Schema.String),
  contextSize: Schema.optional(Schema.Int),
  maxTokens: Schema.optional(Schema.Int),
  model: Schema.optional(Schema.Union([ModelId, ModelSource])),
  sourceLanguage: Schema.optional(Schema.String),
})
const decodeConfig = Schema.decodeEffect(Schema.fromJsonString(ConfigFile))

const invalidConfig = (): TranslationError =>
  new TranslationError({ code: 'InvalidConfig', message: 'The local translation configuration is invalid.' })

const minimumContextSize = 256
const minimumOutputTokens = 1

const findPreset = (sha256: string): Option.Option<(typeof modelPresets)[keyof typeof modelPresets]> =>
  Array.findFirst(Record.values(modelPresets), (value) => value.model.sha256 === String.toLowerCase(sha256))

export const validateConfig = (config: LocalConfig): Effect.Effect<LocalConfig, TranslationError, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const uri = yield* Effect.try({ catch: invalidConfig, try: () => new URL(config.model.uri) })
    const preset = findPreset(config.model.sha256)
    if (
      (uri.protocol !== 'https:' && uri.protocol !== 'file:') ||
      !String.isEmpty(uri.username) ||
      !String.isEmpty(uri.password) ||
      !/^[a-fA-F0-9]{64}$/u.test(config.model.sha256) ||
      !path.isAbsolute(config.cacheDirectory) ||
      config.contextSize < minimumContextSize ||
      (Option.isSome(preset) && config.contextSize > preset.value.contextLimit) ||
      config.maxTokens < minimumOutputTokens ||
      config.maxTokens > config.contextSize ||
      !Number.isSafeInteger(config.contextSize) ||
      !Number.isSafeInteger(config.maxTokens)
    ) {
      return yield* Effect.fail(invalidConfig())
    }
    if (
      Predicate.isNotNullish(config.model.supportedLanguages) &&
      Array.some(config.model.supportedLanguages, (language) => !/^[a-z]{2,3}(?:-[a-z]{4})?$/u.test(language))
    ) {
      return yield* Effect.fail(invalidConfig())
    }
    return { ...config, model: { ...config.model, sha256: String.toLowerCase(config.model.sha256) } }
  })

const readEnvironment = Effect.gen(function* () {
  const explicit = yield* Config.option(Config.String('GLOSSSHIFT_CONFIG'))
  const selectedModel = yield* Config.option(Config.String('GLOSSSHIFT_MODEL'))
  const home = yield* Config.option(Config.String('HOME'))
  const cache = yield* Config.option(Config.String('XDG_CACHE_HOME'))
  const configRoot = yield* Config.option(Config.String('XDG_CONFIG_HOME'))
  return { cache, configRoot, explicit, home, selectedModel }
})

type Environment = Effect.Success<typeof readEnvironment>
type ConfigOverrides = typeof ConfigFile.Type

const applicationConfigPath = (path: Path.Path, environment: Environment): Option.Option<string> =>
  Option.orElse(environment.explicit, () => {
    const root = Option.orElse(environment.configRoot, () =>
      Option.map(environment.home, (home) => path.join(home, '.config')),
    )
    return Option.map(root, (value) => path.join(value, 'glossshift', 'local.json'))
  })

const readConfigFile = (
  environment: Environment,
): Effect.Effect<
  ConfigOverrides,
  PlatformError.PlatformError | Schema.SchemaError | TranslationError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const configured = applicationConfigPath(path, environment)
    if (Option.isNone(configured) || !path.isAbsolute(configured.value)) {
      return yield* Effect.fail(invalidConfig())
    }
    const exists = yield* fs.exists(configured.value)
    if (Option.isSome(environment.explicit) && !exists) {
      return yield* Effect.fail(invalidConfig())
    }
    return exists ? yield* fs.readFileString(configured.value).pipe(Effect.flatMap(decodeConfig)) : {}
  })

const cacheDirectoryFrom = (
  environment: Environment,
  configured?: string,
): Effect.Effect<string, TranslationError, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const home = Option.map(environment.home, (value) => path.join(value, '.cache'))
    const cacheRoot = Option.orElse(environment.cache, () => home)
    const standard = Option.map(cacheRoot, (root) => path.join(root, 'glossshift', 'models'))
    const configuredDirectory = configured ?? Option.getOrUndefined(standard)
    return yield* Predicate.isNullish(configuredDirectory)
      ? Effect.fail(invalidConfig())
      : Effect.succeed(configuredDirectory)
  })

const resolveModelSettings = (
  overrides: ConfigOverrides,
  selectedModel: Option.Option<string>,
): Effect.Effect<Readonly<{ model: ModelSource; contextSize: number }>, TranslationError | Schema.SchemaError> =>
  Effect.gen(function* () {
    // Environment selection overrides only the model.
    const selection = Option.isSome(selectedModel)
      ? yield* decodeModelId(selectedModel.value)
      : (overrides.model ?? defaultModelId)
    const model = Predicate.isString(selection) ? modelPresets[selection].model : selection
    const preset = findPreset(model.sha256)
    const contextSize =
      overrides.contextSize ?? Option.map(preset, (value) => value.contextSize).pipe(Option.getOrUndefined)
    if (Predicate.isNullish(contextSize)) {
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message:
            'Set contextSize in local.json to the custom GGUF model context limit. Unknown model artifacts have no default context size.',
        }),
      )
    }
    return { contextSize, model }
  })

const toConfigError = (error: unknown): TranslationError =>
  error instanceof TranslationError ? error : invalidConfig()

/** Configuration is read once by the application-scoped translation layer. */
export const loadConfig = Effect.gen(function* () {
  const environment = yield* readEnvironment
  const values = yield* readConfigFile(environment)
  const cacheDirectory = yield* cacheDirectoryFrom(environment, values.cacheDirectory)
  const { contextSize, model } = yield* resolveModelSettings(values, environment.selectedModel)
  return yield* validateConfig({
    cacheDirectory,
    contextSize,
    // By default generation uses the space left after the tokenized prompt.
    maxTokens: values.maxTokens ?? contextSize,
    model,
    sourceLanguage: values.sourceLanguage ?? 'auto',
  })
}).pipe(Effect.mapError(toConfigError))
