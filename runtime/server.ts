import { randomBytes } from 'crypto'

import { Config, Effect, FileSystem, Option, Path, Ref, Schema, Stream } from 'effect'
import { ChildProcess } from 'effect/process'

import { TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { serverJson } from './server-api.ts'
import type { LocalServer } from './server-api.ts'

const unavailable = () =>
  new TranslationError({
    code: 'ModelUnavailable',
    message: 'The packaged local inference server could not start. Check the model configuration and available memory.',
  })

/** Process lifetime belongs to the injected platform and allocation scope. */
export const startServer = (modelPath: string, config: LocalConfig) =>
  Effect.gen(function* () {
    if (/-\d+-of-\d+\.gguf$/i.test(modelPath))
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message: 'Use a single merged GGUF file. Multipart model integrity is not configured.',
        }),
      )
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const executable = yield* Config.String('GLOSSSHIFT_LLAMA_SERVER').pipe(Effect.mapError(unavailable))
    if (!path.isAbsolute(executable) && executable !== 'llama-server') return yield* Effect.fail(unavailable())
    const directory = yield* fs
      .makeTempDirectoryScoped({ prefix: 'glossshift-server-' })
      .pipe(Effect.mapError(unavailable))
    const key = randomBytes(32).toString('hex')
    const keyFile = path.join(directory, 'auth')
    yield* fs.writeFileString(keyFile, `${key}\n`, { mode: 0o600, flag: 'wx' }).pipe(Effect.mapError(unavailable))
    const home = yield* Config.option(Config.String('HOME'))
    const temporary = yield* Config.option(Config.String('TMPDIR'))
    const child = yield* ChildProcess.make(
      executable,
      [
        '--model',
        modelPath,
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--api-key-file',
        keyFile,
        '--ctx-size',
        String(config.contextSize),
        '--parallel',
        '1',
        '--no-webui',
        '--no-context-shift',
        '--jinja',
      ],
      {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...(Option.isSome(home) ? { HOME: home.value } : {}),
          ...(Option.isSome(temporary) ? { TMPDIR: temporary.value } : {}),
        },
        extendEnv: true,
      },
    ).pipe(Effect.mapError(unavailable))
    // Never forward diagnostics. Keep only a bounded fragment to discover the assigned port.
    const origin = yield* Ref.make(Option.none<string>())
    let fragment = ''
    yield* child.all.pipe(
      Stream.decodeText(),
      Stream.runForEach((text) => {
        fragment = `${fragment}${text}`.slice(-8192)
        const match = /listening on http:\/\/127\.0\.0\.1:(\d{1,5})/.exec(fragment)
        return match !== null && Number(match[1]) > 0 && Number(match[1]) <= 65535
          ? Ref.set(origin, Option.some(`http://127.0.0.1:${match[1]}`))
          : Effect.void
      }),
      Effect.ignore,
      Effect.forkScoped,
    )
    const ready = Effect.gen(function* () {
      while (yield* child.isRunning) {
        const address = yield* Ref.get(origin)
        if (Option.isSome(address)) {
          const healthy = yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(`${address.value}/health`, {
                headers: { Authorization: `Bearer ${key}` },
                signal,
                redirect: 'error',
              })
              const ok = response.ok
              await response.body?.cancel()
              return ok
            },
            catch: unavailable,
          }).pipe(
            Effect.timeoutOption(1000),
            Effect.catch(() => Effect.succeed(Option.none<boolean>())),
          )
          if (Option.isSome(healthy) && healthy.value) return { origin: address.value, key } satisfies LocalServer
        }
        yield* Effect.sleep(50)
      }
      return yield* Effect.fail(unavailable())
    })
    const server = yield* ready.pipe(
      Effect.timeoutOption(120_000),
      Effect.flatMap(Option.match({ onNone: () => Effect.fail(unavailable()), onSome: Effect.succeed })),
      Effect.mapError(unavailable),
    )
    const properties = yield* serverJson(
      server,
      '/props',
      undefined,
      Schema.Struct({ bos_token: Schema.String, chat_template: Schema.String }),
    )
    if (config.model.prompt === 'plamo' && properties.bos_token !== '<|plamo:bos|>')
      return yield* Effect.fail(
        new TranslationError({ code: 'InvalidConfig', message: 'The PFML3 prompt requires a PLaMo 3 GGUF model.' }),
      )
    if (config.model.prompt === 'chat' && properties.chat_template.trim() === '')
      return yield* Effect.fail(
        new TranslationError({ code: 'InvalidConfig', message: 'The GGUF model requires a chat template.' }),
      )
    const models = yield* serverJson(
      server,
      '/v1/models',
      undefined,
      Schema.Struct({
        data: Schema.Array(Schema.Struct({ meta: Schema.Struct({ n_ctx_train: Schema.Int, n_ctx: Schema.Int }) })),
      }),
    )
    if (
      models.data.length !== 1 ||
      models.data[0]!.meta.n_ctx_train < config.contextSize ||
      models.data[0]!.meta.n_ctx < config.contextSize
    )
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message: 'The configured context exceeds the GGUF model context limit.',
        }),
      )
    return server
  }).pipe(Effect.mapError((error) => (error instanceof TranslationError ? error : unavailable())))
