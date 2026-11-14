import { createHash } from 'node:crypto'

import { Effect, FileSystem, Path, Stdio, Stream } from 'effect'
import { createModelDownloader, getLlama, LlamaLogLevel, readGgufFileInfo } from 'node-llama-cpp'

import { defaultModel, modelNotice, TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'

const unavailable = () =>
  new TranslationError({
    code: 'ModelUnavailable',
    message:
      'The local GGUF model could not be downloaded or loaded. Check the model configuration and available memory.',
  })
const integrityMismatch = () =>
  new TranslationError({
    code: 'IntegrityMismatch',
    message:
      'The local model failed SHA-256 verification. Remove the damaged cached model or correct the configured digest.',
  })

/** Cancel the caller immediately, but always dispose a native acquisition that finishes afterward. */
export const scopedNative = <A>(
  create: () => Promise<A>,
  release: (resource: A) => Promise<void>,
  onError: () => TranslationError,
) =>
  Effect.acquireRelease(
    Effect.callback<A, TranslationError>((resume, signal) => {
      void create().then(
        (resource) => {
          if (signal.aborted) void release(resource).catch(() => undefined)
          else resume(Effect.succeed(resource))
        },
        () => resume(Effect.fail(onError())),
      )
    }),
    (resource) => Effect.promise(() => release(resource)).pipe(Effect.ignore),
    { interruptible: true },
  )

/** Hash incrementally through the Effect filesystem, without loading a GGUF into JS memory. */
export const verifyModel = (modelPath: string, sha256: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const hash = yield* Effect.sync(() => createHash('sha256'))
    yield* fs.stream(modelPath).pipe(
      Stream.runForEach((bytes) =>
        Effect.sync(() => {
          hash.update(bytes)
        }),
      ),
    )
    const actual = yield* Effect.sync(() => hash.digest('hex'))
    if (actual !== sha256) return yield* Effect.fail(integrityMismatch())
  }).pipe(Effect.mapError((error) => (error instanceof TranslationError ? error : unavailable())))

/** Offline cache hits do not perform a network request. Only verified bytes reach llama.cpp. */
export const resolveModel = (config: LocalConfig) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const uri = new URL(config.model.uri)
    if (uri.protocol === 'file:') {
      const modelPath = yield* path.fromFileUrl(uri)
      yield* verifyModel(modelPath, config.model.sha256)
      return modelPath
    }
    yield* fs.makeDirectory(config.cacheDirectory, { recursive: true })
    const modelPath = path.join(config.cacheDirectory, `${config.model.sha256}.gguf`)
    if (!(yield* fs.exists(modelPath))) {
      if (config.model.sha256 === defaultModel.sha256) {
        const stdio = yield* Stdio.Stdio
        yield* Stream.succeed(`${modelNotice}\n`).pipe(Stream.run(stdio.stderr({ endOnDone: false })))
      }
      // Official downloader owns resumable temporary files and remote size checks.
      // The official factory has no signal option, so a late factory result must also be released.
      const downloader = yield* scopedNative(
        () =>
          createModelDownloader({
            modelUri: config.model.uri,
            dirPath: config.cacheDirectory,
            fileName: `${config.model.sha256}.gguf`,
            showCliProgress: false,
            skipExisting: true,
            deleteTempFileOnCancel: false,
          }),
        (resource) => resource.cancel({ deleteTempFile: false }),
        unavailable,
      )
      // Split GGUFs require per-file hashes. A single digest must never pretend to verify all parts.
      if (downloader.totalFiles !== 1)
        return yield* Effect.fail(
          new TranslationError({
            code: 'InvalidConfig',
            message: 'Multipart GGUF models require a single merged GGUF artifact with its own SHA-256 digest.',
          }),
        )
      yield* Effect.tryPromise({ try: (signal) => downloader.download({ signal }), catch: unavailable })
    }
    yield* verifyModel(modelPath, config.model.sha256)
    return modelPath
  }).pipe(Effect.mapError((error) => (error instanceof TranslationError ? error : unavailable())))

/** The caller's scope owns the downloader, native runtime, model, and all child contexts. */
export const loadModel = (config: LocalConfig) =>
  Effect.gen(function* () {
    const modelPath = yield* resolveModel(config)
    const metadata = yield* Effect.tryPromise({
      try: (signal) =>
        readGgufFileInfo(modelPath, { sourceType: 'filesystem', readTensorInfo: false, logWarnings: false, signal }),
      catch: unavailable,
    })
    if (config.model.prompt === 'plamo' && metadata.metadata.general.architecture !== 'plamo3')
      return yield* Effect.fail(
        new TranslationError({ code: 'InvalidConfig', message: 'The PFML3 prompt requires a PLaMo 3 GGUF model.' }),
      )
    if (metadata.splicedParts !== 1)
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message: 'Use a single merged GGUF file. Multipart model integrity is not configured.',
        }),
      )
    const llama = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          getLlama({
            build: 'never',
            skipDownload: true,
            usePrebuiltBinaries: true,
            gpu: 'metal',
            logLevel: LlamaLogLevel.error,
          }),
        catch: unavailable,
      }),
      (resource) => Effect.promise(() => resource.dispose()).pipe(Effect.ignore),
    )
    // 3.22.3's abort-during-load path does not release the wrapper disposal guard.
    // Let allocation settle and use scopedNative's late-result disposal instead of loadSignal.
    const model = yield* scopedNative(
      () => llama.loadModel({ modelPath }),
      (resource) => resource.dispose(),
      unavailable,
    )
    if (config.contextSize > model.trainContextSize)
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message: 'The configured context exceeds the GGUF model context limit.',
        }),
      )
    return model
  })
