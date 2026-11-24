import { Predicate, Effect, FileSystem, Path, Stdio, Stream } from 'effect'
import type { PlatformError, Scope } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'

import { defaultModel, modelNotice, TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import type { ModelUtilityOutput } from './model-process.ts'
import { runModelUtility } from './model-process.ts'
import type { LocalServer } from './server-api.ts'
import { startServer } from './server.ts'

const successfulExit = 0
const unsupportedResumeExit = 33
const privateMode = 0o600

const unavailable = (): TranslationError =>
  new TranslationError({
    code: 'ModelUnavailable',
    message:
      'The local GGUF model could not be downloaded or loaded. Check the model configuration and available memory.',
  })
const integrityMismatch = (): TranslationError =>
  new TranslationError({
    code: 'IntegrityMismatch',
    message:
      'The local model failed SHA-256 verification. Remove the damaged cached model or correct the configured digest.',
  })

/**
 * The packaged utility hashes incrementally. No model bytes enter the JS heap.
 *
 * @param {string} modelPath A complete local model artifact.
 * @param {string} sha256 Expected SHA-256 digest for the artifact.
 * @returns {Effect.Effect} Verification of the model with the packaged hashing utility.
 */
export const verifyModel = (
  modelPath: string,
  sha256: string,
): Effect.Effect<undefined, TranslationError, Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const result = yield* runModelUtility('sha256sum', ['--binary', '--zero', '--', modelPath])
    if (result.code !== successfulExit) {
      return yield* Effect.fail(unavailable())
    }
    const match = /^(?<digest>[a-f0-9]{64}) [*]/u.exec(result.stdout)
    const digest = match?.groups?.['digest']
    if (Predicate.isNullish(digest) || digest !== sha256) {
      return yield* Effect.fail(integrityMismatch())
    }
  })

type ModelServices = Path.Path | ChildProcessSpawner.ChildProcessSpawner
type DownloadServices = ModelServices | FileSystem.FileSystem
type DownloadFailure = PlatformError.PlatformError | TranslationError

type DownloadPaths = Readonly<{ partial: string; resume: string; target: string }>

const rememberPartial = (files: DownloadPaths): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (!(yield* fs.exists(files.partial)) || (yield* fs.exists(files.target))) {
      return
    }
    yield* fs.rename(files.partial, files.resume)
  }).pipe(Effect.ignore)

const claimPartial = (files: DownloadPaths): Effect.Effect<void, DownloadFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    // Rename claims the dormant resume slot. Active attempts never share a writer.
    if (yield* fs.exists(files.resume)) {
      yield* fs.rename(files.resume, files.partial).pipe(Effect.ignore)
    }
    if ((yield* fs.exists(files.partial)) && (yield* fs.lstat(files.partial)).type !== 'File') {
      yield* fs.remove(files.partial)
      return yield* Effect.fail(unavailable())
    }
  })

const transferModel = (
  modelUri: string,
  partial: string,
  resume: boolean,
): Effect.Effect<ModelUtilityOutput, TranslationError, ModelServices> =>
  runModelUtility('curl', [
    '--disable',
    '--silent',
    '--show-error',
    '--fail',
    '--location',
    '--max-redirs',
    '5',
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--header',
    'Accept-Encoding: identity',
    ...(resume ? ['--continue-at', '-'] : []),
    '--output',
    partial,
    '--write-out',
    '%{http_code}',
    '--url',
    modelUri,
  ])

const recoverTransfer = (
  config: LocalConfig,
  partial: string,
  failed: Readonly<{ code: number; existing: boolean }>,
): Effect.Effect<void, DownloadFailure, DownloadServices> =>
  Effect.gen(function* () {
    const verified = verifyModel(partial, config.model.sha256).pipe(
      Effect.match({ onFailure: () => false, onSuccess: () => true }),
    )
    if (failed.existing && (yield* verified)) {
      return
    }
    if (failed.code !== unsupportedResumeExit) {
      return yield* Effect.fail(unavailable())
    }
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(partial)
    yield* fs.writeFileString(partial, '', { flag: 'wx', mode: privateMode })
    const fresh = yield* transferModel(config.model.uri, partial, false)
    return yield* fresh.code === successfulExit ? Effect.void : Effect.fail(unavailable())
  })

const removeDamagedPartial =
  (partial: string): ((error: TranslationError) => Effect.Effect<void, never, FileSystem.FileSystem>) =>
  (error) =>
    error.code === 'IntegrityMismatch'
      ? FileSystem.FileSystem.use((fs) => fs.remove(partial).pipe(Effect.ignore))
      : Effect.void

const transferAndPublish = (
  config: LocalConfig,
  files: DownloadPaths,
): Effect.Effect<void, DownloadFailure, DownloadServices> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const existing = yield* fs.exists(files.partial)
      if (!existing) {
        yield* fs.writeFileString(files.partial, '', { flag: 'wx', mode: privateMode })
      }
      const { code, stdout } = yield* transferModel(config.model.uri, files.partial, existing)
      // A complete partial can receive 416. Verify it before publishing.
      if (code !== successfulExit && !(existing && stdout === '416')) {
        yield* recoverTransfer(config, files.partial, { code, existing })
      }
      yield* verifyModel(files.partial, config.model.sha256).pipe(Effect.tapError(removeDamagedPartial(files.partial)))
      yield* fs.rename(files.partial, files.target)
    }),
  )

/**
 * Private attempts own their partial file. Curl owns bounded binary transfer and byte-range validation.
 * @param {LocalConfig} config Model source, context, and expected digest.
 * @param {string} target Path where a verified model is published.
 * @returns {Effect.Effect} Download, verification, and publication of the model.
 */
const downloadModel = (config: LocalConfig, target: string): Effect.Effect<void, DownloadFailure, DownloadServices> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ directory: config.cacheDirectory, prefix: '.download-' })
      const files = { partial: path.join(directory, 'model.part'), resume: `${target}.part`, target }
      yield* claimPartial(files)
      yield* Effect.addFinalizer(() => rememberPartial(files))
      // The transfer closes before preserving partial bytes or removing the owned directory.
      yield* transferAndPublish(config, files)
    }),
  )

const announceDefaultDownload = (config: LocalConfig): Effect.Effect<void, PlatformError.PlatformError, Stdio.Stdio> =>
  config.model.sha256 === defaultModel.sha256
    ? Stdio.Stdio.use((stdio) =>
        Stream.succeed(`${modelNotice}\n`).pipe(Stream.run(stdio.stderr({ endOnDone: false }))),
      )
    : Effect.void

const verifiedCachedModel = (
  config: LocalConfig,
): Effect.Effect<string, DownloadFailure, DownloadServices | Stdio.Stdio> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(config.cacheDirectory, { recursive: true })
    const modelPath = path.join(config.cacheDirectory, `${config.model.sha256}.gguf`)
    if (!(yield* fs.exists(modelPath))) {
      yield* announceDefaultDownload(config)
      yield* downloadModel(config, modelPath)
    }
    yield* verifyModel(modelPath, config.model.sha256)
    return modelPath
  })

const mapModelError = (error: DownloadFailure | PlatformError.BadArgument): TranslationError =>
  error instanceof TranslationError ? error : unavailable()

/**
 * Cache hits are entirely offline. Only verified complete bytes reach the child process.
 *
 * @param {LocalConfig} config Model URI, expected digest, and cache directory.
 * @returns {Effect.Effect} A local path to the verified model artifact.
 */
export const resolveModel = (
  config: LocalConfig,
): Effect.Effect<
  string,
  TranslationError,
  Path.Path | FileSystem.FileSystem | Stdio.Stdio | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const uri = new URL(config.model.uri)
    if (uri.protocol !== 'file:') {
      return yield* verifiedCachedModel(config)
    }
    const path = yield* Path.Path
    const modelPath = yield* path.fromFileUrl(uri)
    yield* verifyModel(modelPath, config.model.sha256)
    return modelPath
  }).pipe(Effect.mapError(mapModelError))

/**
 * One private server and its model are owned by the application allocation scope.
 *
 * @param {LocalConfig} config Model identity and local inference settings.
 * @returns {Effect.Effect} A private loopback server tied to the application scope.
 */
export const loadModel = (
  config: LocalConfig,
): Effect.Effect<
  LocalServer,
  TranslationError,
  Path.Path | FileSystem.FileSystem | Stdio.Stdio | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> => Effect.flatMap(resolveModel(config), (path) => startServer(path, config))
