import { Effect, FileSystem, Path, Stdio, Stream } from 'effect'

import { defaultModel, modelNotice, TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { runModelUtility } from './model-process.ts'
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

/** The packaged utility hashes incrementally. No model bytes enter the JS heap. */
export const verifyModel = (modelPath: string, sha256: string) =>
  Effect.gen(function* () {
    const result = yield* runModelUtility('sha256sum', ['--binary', '--zero', '--', modelPath])
    if (result.code !== 0) return yield* Effect.fail(unavailable())
    const match = /^([a-f0-9]{64}) [*]/.exec(result.stdout)
    if (match === null || match[1] !== sha256) return yield* Effect.fail(integrityMismatch())
  }).pipe(Effect.mapError((error) => (error instanceof TranslationError ? error : unavailable())))

/** Private attempts own their partial file. Curl owns bounded binary transfer and byte-range validation. */
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
      if ((yield* fs.exists(partial)) && (yield* fs.lstat(partial)).type !== 'File') {
        yield* fs.remove(partial)
        return yield* Effect.fail(unavailable())
      }
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (!(yield* fs.exists(partial))) return
          if (yield* fs.exists(target)) return
          yield* fs.rename(partial, resume)
        }).pipe(Effect.ignore),
      )
      // Child scope ends the transfer before preserving partial bytes or removing the owned directory.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const existing = yield* fs.exists(partial)
          if (!existing) yield* fs.writeFileString(partial, '', { flag: 'wx', mode: 0o600 })
          const transfer = (resuming: boolean) =>
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
              ...(resuming ? ['--continue-at', '-'] : []),
              '--output',
              partial,
              '--write-out',
              '%{http_code}',
              '--url',
              config.model.uri,
            ])
          const result = yield* transfer(existing)
          if (result.code !== 0) {
            if (existing && result.stdout === '416') {
              yield* verifyPartial
              yield* fs.rename(partial, target)
              return
            }
            // A complete partial can receive 416. Unsupported ranges instead retry from a fresh private file.
            const complete =
              existing &&
              (yield* verifyModel(partial, config.model.sha256).pipe(
                Effect.as(true),
                Effect.catch(() => Effect.succeed(false)),
              ))
            if (!complete) {
              if (result.code !== 33) return yield* Effect.fail(unavailable())
              yield* fs.remove(partial)
              yield* fs.writeFileString(partial, '', { flag: 'wx', mode: 0o600 })
              const fresh = yield* transfer(false)
              if (fresh.code !== 0) return yield* Effect.fail(unavailable())
            }
          }
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
