import { createHash } from 'node:crypto'

import { Effect, FileSystem, Path, Stdio, Stream } from 'effect'

import { defaultModel, modelNotice, TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { startServer } from './server.ts'

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

/** Hash incrementally without loading model bytes into JS memory. */
export const verifyModel = (modelPath: string, sha256: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const hash = createHash('sha256')
    yield* fs.stream(modelPath).pipe(
      Stream.runForEach((bytes) =>
        Effect.sync(() => {
          hash.update(bytes)
        }),
      ),
    )
    if (hash.digest('hex') !== sha256) return yield* Effect.fail(integrityMismatch())
  }).pipe(Effect.mapError((error) => (error instanceof TranslationError ? error : unavailable())))

/** Resume only byte ranges, then verify the complete artifact before publishing the cache entry. */
const downloadModel = (config: LocalConfig, target: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const resume = `${target}.part`
      const directory = yield* fs.makeTempDirectoryScoped({ directory: config.cacheDirectory, prefix: '.download-' })
      const partial = path.join(directory, 'model.part')
      const verifyPartial = verifyModel(partial, config.model.sha256).pipe(
        Effect.tapError((error) =>
          error.code === 'IntegrityMismatch' ? fs.remove(partial).pipe(Effect.ignore) : Effect.void,
        ),
      )
      // Rename atomically claims the dormant resume slot. Active attempts never share a writer.
      if (yield* fs.exists(resume)) yield* fs.rename(resume, partial).pipe(Effect.ignore)
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (!(yield* fs.exists(partial))) return
          if (yield* fs.exists(target)) return
          yield* fs.rename(partial, resume)
        }).pipe(Effect.ignore),
      )
      // Close the writer and HTTP request before preserving partial bytes or removing their directory.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const offset = (yield* fs.exists(partial)) ? Number((yield* fs.stat(partial)).size) : 0
          const abort = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (controller) => Effect.sync(() => controller.abort()),
          )
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(config.model.uri, {
                headers: offset === 0 ? {} : { Range: `bytes=${offset}-`, 'Accept-Encoding': 'identity' },
                signal: abort.signal,
              }),
            catch: unavailable,
          })
          if (response.status === 416 && offset > 0) {
            yield* verifyPartial
            yield* fs.rename(partial, target)
            return
          }
          if (!response.ok || response.body === null || (response.status !== 200 && response.status !== 206))
            return yield* Effect.fail(unavailable())
          if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))
            return yield* Effect.fail(unavailable())
          yield* Stream.fromReadableStream({ evaluate: () => response.body!, onError: unavailable }).pipe(
            Stream.run(fs.sink(partial, { flag: response.status === 206 ? 'a' : 'w', mode: 0o600 })),
          )
          yield* verifyPartial
          yield* fs.rename(partial, target)
        }),
      )
    }),
  )

/** Cache hits are entirely offline. Only verified complete bytes reach the child process. */
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
      yield* downloadModel(config, modelPath)
    }
    yield* verifyModel(modelPath, config.model.sha256)
    return modelPath
  }).pipe(Effect.mapError((error) => (error instanceof TranslationError ? error : unavailable())))

/** One private server and its model are owned by the application allocation scope. */
export const loadModel = (config: LocalConfig) =>
  Effect.flatMap(resolveModel(config), (path) => startServer(path, config))
