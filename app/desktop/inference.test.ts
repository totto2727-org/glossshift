import { loadConfig } from '@glossshift/runtime/config'
import { verifyModel } from '@glossshift/runtime/model'
import { runModelUtility } from '@glossshift/runtime/model-process'
import { completion, serverFetch } from '@glossshift/runtime/server-api'
import { Array, ConfigProvider, Effect, FileSystem, Layer, Path, Sink, Stream } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { expect, test } from 'nsh/test'

import { server, withFixtureFetch } from './inference-fetch.test.fixture.ts'
import { runTestEffect } from './inference.test.fixture.ts'

test('explicit model configuration does not require an unused HOME variable', async () => {
  const fs = FileSystem.makeNoop({
    exists: () => Effect.succeed(true),
    readFileString: () => Effect.succeed(JSON.stringify({ cacheDirectory: '/synthetic/cache' })),
  })
  const provider = ConfigProvider.fromEnvRecord({ GLOSSSHIFT_CONFIG: '/synthetic/local.json' })
  const config = loadConfig.pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(ConfigProvider.ConfigProvider, provider),
    Effect.provide(Path.layer),
  )
  const result = await runTestEffect(config)
  expect(result.cacheDirectory).toBe('/synthetic/cache')
})

interface UtilityFixture {
  layer: Layer.Layer<Path.Path | ChildProcessSpawner.ChildProcessSpawner>
  released: () => boolean
}

const utilityHandle = (stdout: string): ChildProcessSpawner.ChildProcessHandle => {
  const bytes = new TextEncoder().encode(stdout)
  const output = Stream.succeed(bytes)
  const exitCode = ChildProcessSpawner.ExitCode(0)
  return ChildProcessSpawner.makeHandle({
    all: output,
    exitCode: Effect.succeed(exitCode),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    pid: ChildProcessSpawner.ProcessId(1),
    stderr: Stream.empty,
    stdin: Sink.drain,
    stdout: output,
    unref: Effect.succeed(Effect.void),
  })
}

const utilityFixture = (stdout: string): UtilityFixture => {
  const state = { released: false }
  const handle = Effect.succeed(utilityHandle(stdout))
  const release = Effect.sync(() => {
    state.released = true
  })
  const spawner = ChildProcessSpawner.make(() => Effect.acquireRelease(handle, () => release))
  const provider = ConfigProvider.fromEnvRecord({ GLOSSSHIFT_COREUTILS: '/nix/store/fixture/bin/coreutils' })
  const environment = ConfigProvider.layer(Effect.succeed(provider))
  const layer = Layer.mergeAll(Path.layer, Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner), environment)
  return { layer, released: () => state.released }
}

test('model verification uses a scoped external digest without requiring FileSystem reads', async () => {
  const digest = 'a'.repeat(64)
  const fixture = utilityFixture(`${digest} */synthetic/model.gguf\0`)
  const verify = verifyModel('/synthetic/model.gguf', digest).pipe(Effect.provide(fixture.layer))
  await runTestEffect(verify)
  expect(fixture.released()).toBe(true)
})

test('model utility output quotas fail safely and release the child scope', async () => {
  const fixture = utilityFixture('a'.repeat(8193))
  const code = await runTestEffect(
    runModelUtility('sha256sum', []).pipe(
      Effect.as('unexpected success'),
      Effect.catch((error) => Effect.succeed(error.code)),
      Effect.provide(fixture.layer),
    ),
  )
  expect(code).toBe('ModelUnavailable')
  expect(fixture.released()).toBe(true)
})

test('inference rejects caller-selected non-loopback endpoints before fetching', () => {
  const controller = new AbortController()
  expect(() =>
    serverFetch({ key: 'synthetic', origin: 'https://example.invalid' }, { endpoint: '/health' }, controller.signal),
  ).toThrow('Local translation failed.')
})

const splitSseFixture = (text: string): typeof fetch => {
  const bytes = new TextEncoder().encode(text)
  return async () => {
    const stream = new ReadableStream({
      start(controller) {
        Array.forEach(bytes, (byte) => controller.enqueue(new Uint8Array([byte])))
        controller.close()
      },
    })
    return new Response(stream)
  }
}

const sseFrame = (frame: Readonly<{ content: string; stop: boolean; stop_type?: string }>, separator = '\n'): string =>
  `data: ${JSON.stringify(frame)}${separator}${separator}`

test('bounded SSE handles split UTF-8 and split CRLF without exposing protocol markers', async () => {
  const data = sseFrame({ content: 'こんにちは', stop: false }, '\r\n')
  const terminal = sseFrame({ content: '', stop: true, stop_type: 'word' }, '\r\n')
  await withFixtureFetch(splitSseFixture(data + terminal), async () => {
    const controller = new AbortController()
    const options = { budget: 8, stops: ['<|plamo:tag|>'], tokens: [1] }
    const frames = completion(server, options, controller.signal)
    const stream = Stream.fromAsyncIterable(frames, (cause) => cause)
    const result = await runTestEffect(Stream.mkString(stream))
    expect(result).toBe('こんにちは')
  })
})

const openSseFixture = (frame: string, state: { cancelled: boolean }): typeof fetch => {
  const bytes = new TextEncoder().encode(frame)
  return async () => {
    const stream = new ReadableStream({
      cancel() {
        state.cancelled = true
      },
      start(controller) {
        controller.enqueue(bytes)
      },
    })
    return new Response(stream)
  }
}

test('truncated inference fails publicly and cancels its reader instead of reporting success', async () => {
  const state = { cancelled: false }
  const frame = sseFrame({ content: '', stop: true, stop_type: 'limit' })
  await withFixtureFetch(openSseFixture(frame, state), async () => {
    const controller = new AbortController()
    const frames = completion(server, { budget: 1, stops: [], tokens: [1] }, controller.signal)
    await expect(frames.next()).rejects.toMatchObject({ code: 'OutputTooLong' })
    expect(state.cancelled).toBe(true)
  })
})

test('ending inference consumption cancels the HTTP response reader', async () => {
  const state = { cancelled: false }
  const frame = sseFrame({ content: 'partial', stop: false })
  await withFixtureFetch(openSseFixture(frame, state), async () => {
    const controller = new AbortController()
    const frames = completion(server, { budget: 8, stops: [], tokens: [1] }, controller.signal)
    await expect(frames.next()).resolves.toMatchObject({ done: false, value: 'partial' })
    await frames.return()
    expect(state.cancelled).toBe(true)
  })
})
