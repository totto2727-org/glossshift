// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import { randomBytes } from 'crypto'

import { String, Predicate, Config, Effect, FileSystem, Option, Path, Ref, Schema, Stream } from 'effect'
import type { Scope } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'
import { ChildProcess } from 'effect/process'

import { TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { serverJson } from './server-api.ts'
import type { LocalServer } from './server-api.ts'

const ServerProperties = Schema.Struct({ bos_token: Schema.String, chat_template: Schema.String })
const ModelContext = Schema.Struct({ n_ctx: Schema.Int, n_ctx_train: Schema.Int })
const ServerModel = Schema.Struct({ meta: ModelContext })
const ServerModels = Schema.Struct({ data: Schema.Array(ServerModel) })
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- Validate properties from the llama.cpp JSON endpoint.
const decodeServerProperties = Schema.decodeUnknownEffect(ServerProperties)
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- Validate the untrusted loaded-model metadata.
const decodeServerModels = Schema.decodeUnknownEffect(ServerModels)

const authTokenBytes = 32
const maxDiagnosticFragmentChars = 8192
const maxTcpPort = 65_535

const unavailable = (): TranslationError =>
  new TranslationError({
    code: 'ModelUnavailable',
    message: 'The packaged local inference server could not start. Check the model configuration and available memory.',
  })

type ServerServices = Path.Path | FileSystem.FileSystem | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner

const privateKeyMode = 0o600
const firstTcpPort = 1
const expectedModelCount = 1

const serverArgs = (modelPath: string, keyFile: string, contextSize: number): Readonly<string[]> => [
  '--model',
  modelPath,
  '--host',
  '127.0.0.1',
  '--port',
  '0',
  '--api-key-file',
  keyFile,
  '--ctx-size',
  `${contextSize}`,
  '--parallel',
  '1',
  '--no-webui',
  '--no-context-shift',
  '--jinja',
]

const serverKey = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs
    .makeTempDirectoryScoped({ prefix: 'glossshift-server-' })
    .pipe(Effect.mapError(unavailable))
  const key = randomBytes(authTokenBytes).toString('hex')
  const keyFile = path.join(directory, 'auth')
  yield* fs
    .writeFileString(keyFile, `${key}\n`, { flag: 'wx', mode: privateKeyMode })
    .pipe(Effect.mapError(unavailable))
  return { key, keyFile }
})

const serverEnvironment = Effect.gen(function* () {
  const home = yield* Config.option(Config.String('HOME'))
  const temporary = yield* Config.option(Config.String('TMPDIR'))
  return {
    ...(Option.isSome(home) ? { HOME: home.value } : {}),
    ...(Option.isSome(temporary) ? { TMPDIR: temporary.value } : {}),
  }
})

const spawnServer = (
  modelPath: string,
  contextSize: number,
): Effect.Effect<
  Readonly<{ key: string; child: ChildProcessSpawner.ChildProcessHandle }>,
  TranslationError,
  ServerServices
> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const executable = yield* Config.String('GLOSSSHIFT_LLAMA_SERVER').pipe(Effect.mapError(unavailable))
    if (!path.isAbsolute(executable) && executable !== 'llama-server') {
      return yield* Effect.fail(unavailable())
    }
    const { key, keyFile } = yield* serverKey
    const env = yield* serverEnvironment.pipe(Effect.mapError(unavailable))
    const child = yield* ChildProcess.make(executable, serverArgs(modelPath, keyFile, contextSize), {
      env,
      extendEnv: true,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    }).pipe(Effect.mapError(unavailable))
    return { child, key }
  })

const addressFromDiagnostic = (bounded: string): Option.Option<string> => {
  const match = /listening on http:\/\/127\.0\.0\.1:(?<port>\d{1,5})/u.exec(bounded)
  const port = match?.groups?.['port']
  const number = Number(port)
  return Predicate.isNotNullish(port) && Number.isInteger(number) && number >= firstTcpPort && number <= maxTcpPort
    ? Option.some(`http://127.0.0.1:${port}`)
    : Option.none()
}

const monitorServerAddress = (
  child: ChildProcessSpawner.ChildProcessHandle,
): Effect.Effect<Ref.Ref<Option.Option<string>>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const origin = yield* Ref.make(Option.none<string>())
    const fragment = yield* Ref.make('')
    // Keep a bounded diagnostic fragment to discover the port.
    yield* child.all.pipe(
      Stream.decodeText(),
      Stream.runForEach((text) =>
        Effect.gen(function* () {
          const bounded = yield* Ref.updateAndGet(fragment, (previous) =>
            `${previous}${text}`.slice(-maxDiagnosticFragmentChars),
          )
          const address = addressFromDiagnostic(bounded)
          if (Option.isSome(address)) {
            yield* Ref.set(origin, address)
          }
        }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    )
    return origin
  })

const serverHealthy = (address: string, key: string): Effect.Effect<Option.Option<boolean>> =>
  Effect.tryPromise({
    catch: unavailable,
    try: async (signal) => {
      // oxlint-disable-next-line rules/no-fetch -- The bootstrap probe cancels the native llama.cpp response body.
      const response = await fetch(`${address}/health`, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: 'error',
        signal,
      })
      const { ok } = response
      await response.body?.cancel()
      return ok
    },
  }).pipe(Effect.timeoutOption('1 second'), Effect.orElseSucceed(Option.none<boolean>))

const waitForServer = (
  child: ChildProcessSpawner.ChildProcessHandle,
  key: string,
  origin: Ref.Ref<Option.Option<string>>,
): Effect.Effect<LocalServer, TranslationError> =>
  Effect.gen(function* () {
    while (yield* child.isRunning) {
      const address = yield* Ref.get(origin)
      if (Option.isSome(address)) {
        const healthy = yield* serverHealthy(address.value, key)
        if (Option.isSome(healthy) && healthy.value) {
          return { key, origin: address.value }
        }
      }
      yield* Effect.sleep('50 millis')
    }
    return yield* Effect.fail(unavailable())
  }).pipe(
    Effect.timeoutOption('2 minutes'),
    Effect.flatMap(Option.match({ onNone: () => Effect.fail(unavailable()), onSome: Effect.succeed })),
    Effect.mapError(unavailable),
  )

const validateServer = (server: LocalServer, config: LocalConfig): Effect.Effect<void, TranslationError> =>
  Effect.gen(function* () {
    const properties = yield* serverJson(server, { endpoint: '/props' }, decodeServerProperties)
    if (config.model.prompt === 'plamo' && properties.bos_token !== '<|plamo:bos|>') {
      return yield* Effect.fail(
        new TranslationError({ code: 'InvalidConfig', message: 'The PFML3 prompt requires a PLaMo 3 GGUF model.' }),
      )
    }
    if (config.model.prompt === 'chat' && String.isEmpty(properties.chat_template.trim())) {
      return yield* Effect.fail(
        new TranslationError({ code: 'InvalidConfig', message: 'The GGUF model requires a chat template.' }),
      )
    }
    const { data } = yield* serverJson(server, { endpoint: '/v1/models' }, decodeServerModels)
    const [model] = data
    if (
      data.length !== expectedModelCount ||
      Predicate.isNullish(model) ||
      model.meta.n_ctx_train < config.contextSize ||
      model.meta.n_ctx < config.contextSize
    ) {
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message: 'The configured context exceeds the GGUF model context limit.',
        }),
      )
    }
  })

/**
 * Process lifetime belongs to the injected platform and allocation scope.
 *
 * @param {string} modelPath Verified GGUF artifact to load.
 * @param {LocalConfig} config Prompt and context settings to verify against the loaded model.
 * @returns {Effect.Effect} The authenticated loopback server and its scoped child process.
 */
export const startServer = (
  modelPath: string,
  config: LocalConfig,
): Effect.Effect<LocalServer, TranslationError, ServerServices> =>
  Effect.gen(function* () {
    if (/-\d+-of-\d+\.gguf$/iu.test(modelPath)) {
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message: 'Use a single merged GGUF file. Multipart model integrity is not configured.',
        }),
      )
    }
    const { child, key } = yield* spawnServer(modelPath, config.contextSize)
    const origin = yield* monitorServerAddress(child)
    const server = yield* waitForServer(child, key, origin)
    yield* validateServer(server, config)
    return server
  })
