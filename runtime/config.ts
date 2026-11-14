import { Array, Config, Data, Effect, FileSystem, Option, Path, Schema, String } from 'effect'

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

export const defaultModel: ModelSource = {
  uri: 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/1cf96ae02133958a20074bfdfab76517bb737d00/plamo-3-translate-0.8b-Q4_K_M.gguf',
  sha256: '70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6',
  prompt: 'plamo',
  supportedLanguages: String.split(
    'ar az be bg bn ca ceb de en es et eu fa fr gu he hi hr hu hy id it ja jv ka kk km ko lt lv ml mr ms my ne nl pa pl ru si sk sl sr sw ta te th tl ur uz vi zh-hans zh-hant',
    ' ',
  ),
}

const ConfigFile = Schema.Struct({
  sourceLanguage: Schema.optional(Schema.String),
  model: Schema.optional(ModelSource),
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
    if (
      (uri.protocol !== 'https:' && uri.protocol !== 'file:') ||
      uri.username !== '' ||
      uri.password !== '' ||
      !/^[a-fA-F0-9]{64}$/.test(config.model.sha256) ||
      !path.isAbsolute(config.cacheDirectory) ||
      config.contextSize < 256 ||
      config.contextSize > (config.model.prompt === 'plamo' ? 32768 : 131072) ||
      config.maxTokens < 1 ||
      config.maxTokens >= config.contextSize ||
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
  return yield* validateConfig({
    sourceLanguage: values.sourceLanguage ?? 'auto',
    model: values.model ?? defaultModel,
    cacheDirectory,
    contextSize: values.contextSize ?? 8192,
    maxTokens: values.maxTokens ?? 4096,
  })
}).pipe(Effect.mapError(invalidConfig))
