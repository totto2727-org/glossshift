import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { Config, Effect, Schema } from 'effect'

import { TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { serverJson } from './server-api.ts'
import type { LocalServer } from './server-api.ts'

const unavailable = () =>
  new TranslationError({
    code: 'ModelUnavailable',
    message: 'The packaged local inference server could not start. Check the model configuration and available memory.',
  })

/** Process-only adapter. HTTP and prompt policy live in portable modules. */
export const startServer = (modelPath: string, config: LocalConfig) =>
  Effect.gen(function* () {
    // llama.cpp discovers sibling shards only from its canonical split filename.
    // Digest-named cache entries cannot trigger that discovery. Reject explicit split paths too.
    if (/-\d+-of-\d+\.gguf$/i.test(modelPath))
      return yield* Effect.fail(
        new TranslationError({
          code: 'InvalidConfig',
          message: 'Use a single merged GGUF file. Multipart model integrity is not configured.',
        }),
      )
    const executable = yield* Config.String('GLOSSSHIFT_LLAMA_SERVER').pipe(Effect.mapError(unavailable))
    if (!isAbsolute(executable)) return yield* Effect.fail(unavailable())
    const directory = yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), 'glossshift-server-')), catch: unavailable }),
      (value) => Effect.promise(() => rm(value, { recursive: true, force: true })),
    )
    const key = randomBytes(32).toString('hex')
    const keyFile = join(directory, 'auth')
    yield* Effect.tryPromise({
      try: () => writeFile(keyFile, `${key}\n`, { mode: 0o600, flag: 'wx' }),
      catch: unavailable,
    })
    const child = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          spawn(
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
              stdio: ['ignore', 'pipe', 'pipe'],
              env: {
                ...(process.env['HOME'] === undefined ? {} : { HOME: process.env['HOME'] }),
                ...(process.env['TMPDIR'] === undefined ? {} : { TMPDIR: process.env['TMPDIR'] }),
              },
            },
          ),
        catch: unavailable,
      }),
      (process) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              if (process.pid === undefined || process.exitCode !== null || process.signalCode !== null) {
                resolve()
                return
              }
              const timer = setTimeout(() => {
                process.kill('SIGKILL')
              }, 3000)
              process.once('close', () => {
                clearTimeout(timer)
                resolve()
              })
              process.kill('SIGTERM')
            }),
        ),
    )
    // Never forward diagnostics: model paths and source text may be embedded in server logs.
    // Retain only a bounded line fragment to discover the kernel-selected loopback port.
    let fragment = ''
    let origin: string | undefined
    let failed = false
    const observe = (chunk: Buffer) => {
      fragment = `${fragment}${chunk.toString('utf8')}`.slice(-8192)
      const match = /listening on http:\/\/127\.0\.0\.1:(\d{1,5})/.exec(fragment)
      if (match !== null && Number(match[1]) > 0 && Number(match[1]) <= 65535) origin = `http://127.0.0.1:${match[1]}`
    }
    child.stdout.on('data', observe)
    child.stderr.on('data', observe)
    child.on('error', () => {
      failed = true
    })
    child.on('exit', () => {
      failed = true
    })
    const server = yield* Effect.tryPromise({
      try: async (signal): Promise<LocalServer> => {
        const deadline = Date.now() + 120_000
        while (!signal.aborted && !failed && Date.now() < deadline) {
          if (origin !== undefined) {
            try {
              const response = await fetch(`${origin}/health`, {
                headers: { Authorization: `Bearer ${key}` },
                signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
                redirect: 'error',
              })
              const ready = response.ok
              await response.body?.cancel()
              if (ready) return { origin, key }
            } catch {
              /* Model loading can temporarily reject requests. */
            }
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 50))
        }
        throw unavailable()
      },
      catch: unavailable,
    })
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
  })
