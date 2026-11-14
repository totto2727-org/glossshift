import { createHash, randomBytes } from 'crypto'

import { Array, ConfigProvider, Effect, FileSystem, Layer, Path, Sink, Stream } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { expect, test } from 'nsh/test'

import { loadConfig, TranslationError } from './runtime/config.ts'
import { runModelUtility } from './runtime/model-process.ts'
import { verifyModel } from './runtime/model.ts'
import { completion, serverFetch } from './runtime/server-api.ts'

test('explicit model configuration does not require an unused HOME variable', async () => {
  const fs = FileSystem.makeNoop({
    exists: () => Effect.succeed(true),
    readFileString: () => Effect.succeed(JSON.stringify({ cacheDirectory: '/synthetic/cache' })),
  })
  const result = await Effect.runPromise(
    loadConfig.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          GLOSSSHIFT_CONFIG: '/synthetic/local.json',
        }),
      ),
      Effect.provide(Path.layer),
    ),
  )
  expect(result.cacheDirectory).toBe('/synthetic/cache')
})

const utilityFixture = (stdout: string) => {
  let released = false
  const output = Stream.succeed(new TextEncoder().encode(stdout))
  const spawner = ChildProcessSpawner.make(() =>
    Effect.acquireRelease(
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: output,
          stderr: Stream.empty,
          all: output,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      ),
      () =>
        Effect.sync(() => {
          released = true
        }),
    ),
  )
  return {
    layer: Layer.mergeAll(
      Path.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ConfigProvider.layer(
        Effect.succeed(
          ConfigProvider.fromEnvRecord({
            GLOSSSHIFT_COREUTILS: '/nix/store/fixture/bin/coreutils',
          }),
        ),
      ),
    ),
    released: () => released,
  }
}

test('model verification uses a scoped external digest without requiring FileSystem reads', async () => {
  const digest = 'a'.repeat(64)
  const fixture = utilityFixture(`${digest} */synthetic/model.gguf\0`)
  await Effect.runPromise(verifyModel('/synthetic/model.gguf', digest).pipe(Effect.provide(fixture.layer)))
  expect(fixture.released()).toBe(true)
})

test('model utility output quotas fail safely and release the child scope', async () => {
  const fixture = utilityFixture('a'.repeat(8193))
  const code = await Effect.runPromise(
    runModelUtility('sha256sum', []).pipe(
      Effect.as('unexpected success'),
      Effect.catch((error) => Effect.succeed(error.code)),
      Effect.provide(fixture.layer),
    ),
  )
  expect(code).toBe('ModelUnavailable')
  expect(fixture.released()).toBe(true)
})

// These execute inside the official NSH test host, not a Node subprocess.
test('the official runtime supports bounded incremental SHA-256 and private authentication entropy', () => {
  const hash = createHash('sha256')
  hash.update(new TextEncoder().encode('a'))
  hash.update(new TextEncoder().encode('bc'))
  expect(hash.digest('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const first = randomBytes(32).toString('hex')
  const second = randomBytes(32).toString('hex')
  expect(/^[a-f0-9]{64}$/.test(first)).toBe(true)
  expect(first === second).toBe(false)
})

test('inference rejects caller-selected non-loopback endpoints before fetching', () => {
  let rejected = false
  try {
    serverFetch(
      { origin: 'https://example.invalid', key: 'synthetic' },
      '/health',
      undefined,
      new AbortController().signal,
    )
  } catch {
    rejected = true
  }
  expect(rejected).toBe(true)
})

test('bounded SSE handles split UTF-8 and split CRLF without exposing protocol markers', async () => {
  const original = globalThis.fetch
  const bytes = new TextEncoder().encode(
    `data: ${JSON.stringify({ content: 'こんにちは', stop: false })}\r\n\r\ndata: ${JSON.stringify({ content: '', stop: true, stop_type: 'word' })}\r\n\r\n`,
  )
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
          controller.close()
        },
      }),
    )
  try {
    const deltas: string[] = []
    for await (const delta of completion(
      { origin: 'http://127.0.0.1:1', key: 'synthetic' },
      [1],
      8,
      ['<|plamo:tag|>'],
      new AbortController().signal,
    ))
      deltas.push(delta)
    expect(Array.join(deltas, '')).toBe('こんにちは')
  } finally {
    globalThis.fetch = original
  }
})

test('truncated inference fails publicly and cancels its reader instead of reporting success', async () => {
  const original = globalThis.fetch
  let cancelled = false
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ content: '', stop: true, stop_type: 'limit' })}\n\n`),
          )
        },
        cancel() {
          cancelled = true
        },
      }),
    )
  try {
    let code = ''
    try {
      for await (const _delta of completion(
        { origin: 'http://127.0.0.1:1', key: 'synthetic' },
        [1],
        1,
        [],
        new AbortController().signal,
      )) {
        /* A truncated terminal frame cannot produce a successful result. */
      }
    } catch (error) {
      if (error instanceof TranslationError) code = error.code
    }
    expect(code).toBe('OutputTooLong')
    expect(cancelled).toBe(true)
  } finally {
    globalThis.fetch = original
  }
})

test('ending inference consumption cancels the HTTP response reader', async () => {
  const original = globalThis.fetch
  let cancelled = false
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ content: 'partial', stop: false })}\n\n`),
          )
        },
        cancel() {
          cancelled = true
        },
      }),
    )
  try {
    for await (const delta of completion(
      { origin: 'http://127.0.0.1:1', key: 'synthetic' },
      [1],
      8,
      [],
      new AbortController().signal,
    )) {
      expect(delta).toBe('partial')
      break
    }
    expect(cancelled).toBe(true)
  } finally {
    globalThis.fetch = original
  }
})
