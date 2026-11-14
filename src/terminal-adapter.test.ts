import { Effect, Fiber, Option, Queue, Result, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { createController } from './controller'
import { RequestId } from './domain'
import { localFixture } from './local-client.fixture'
import { readRuntimeSettings } from './runtime-settings'
import { connectTerminal } from './terminal-adapter'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))
const runtime = { command: 'node', entry: '/fixture/node/main.ts' }
const configuration = {
  shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'Japanese' }],
  window: { width: 700, height: 420, min_width: 320, min_height: 180 },
  directory: '/fixture/config',
  created_files: false,
}

test('terminal runtime requires an explicit absolute entry rather than depending on launch cwd', async () => {
  expect(
    await run(
      readRuntimeSettings({
        GLOSSSHIFT_NODE_COMMAND: '/immutable/bin/node',
        GLOSSSHIFT_NODE_ENTRY: '/immutable/main.ts',
      }),
    ),
  ).toEqual({ command: '/immutable/bin/node', entry: '/immutable/main.ts' })
  for (const environment of [
    {},
    { GLOSSSHIFT_NODE_COMMAND: 'node', GLOSSSHIFT_NODE_ENTRY: './node/main.ts' },
    { GLOSSSHIFT_NODE_COMMAND: 'sh', GLOSSSHIFT_NODE_ENTRY: '/main.ts' },
    { GLOSSSHIFT_NODE_COMMAND: 'node', GLOSSSHIFT_NODE_ENTRY: '/bad\0entry' },
  ]) {
    expect(Result.isFailure(await run(Effect.result(readRuntimeSettings(environment))))).toBe(true)
  }
})

test('terminal adapter uses Node settings and local translation without a native module', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const connection = yield* connectTerminal(runtime, f.launcher, () => Effect.succeed(configuration))
        expect(yield* connection.ports.settings).toEqual({
          sourceLanguage: 'auto',
          initialStatus: 'Ready',
          window: { width: 700, height: 420, minWidth: 320, minHeight: 180 },
        })
        expect(Result.isFailure(yield* Effect.result(connection.ports.capture))).toBe(true)
        const controller = yield* createController(connection.ports)
        yield* controller.submit({ text: '# terminal source', targetLanguage: 'ja' })
        const request = yield* Queue.take(f.written)
        if (request.kind !== 'translate') return yield* Effect.die('Expected translation request')
        expect(request.text).toBe('# terminal source')
        f.emit({ version: 1, kind: 'started', requestId: request.requestId, seq: 1, text: request.text })
        yield* Queue.take(f.written)
        f.emit({ version: 1, kind: 'delta', requestId: request.requestId, seq: 2, text: '日本語' })
        yield* Queue.take(f.written)
        f.emit({ version: 1, kind: 'finished', requestId: request.requestId, seq: 3 })
        const state = yield* controller.snapshots.pipe(
          Stream.filter((snapshot) => snapshot.phase === 'Complete'),
          Stream.runHead,
        )
        expect(Option.getOrThrow(state).output).toBe('日本語')
      }),
    ),
  )
})

test('terminal teardown cancels local translation and closes the child independently of native controls', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const opened = yield* Queue.bounded<void>(1)
        const connection = yield* Effect.scoped(
          Effect.gen(function* () {
            const connected = yield* connectTerminal(runtime, f.launcher, () => Effect.succeed(configuration))
            yield* connected.ports
              .translate({
                id: Schema.decodeUnknownSync(RequestId)('terminal'),
                text: 'source',
                sourceLanguage: 'auto',
                targetLanguage: 'ja',
              })
              .pipe(Stream.runDrain, Effect.forkScoped)
            yield* Queue.take(f.written)
            yield* Queue.offer(opened, undefined)
            yield* Effect.never
          }),
        ).pipe(Effect.forkScoped)
        yield* Queue.take(opened)
        yield* Fiber.interrupt(connection)
        expect(yield* Queue.take(f.lifecycle)).toBe('end')
        expect(yield* Queue.take(f.lifecycle)).toBe('kill')
      }),
    ),
  )
})
