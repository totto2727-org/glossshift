import { Effect, Fiber, Option, Queue, Result, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { createController } from './controller'
import { RequestId } from './domain'
import { connectTerminal } from './terminal-adapter'
import { translationFixture } from './translation-client.fixture'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))
const configuration = {
  shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'Japanese' }],
  window: { width: 700, height: 420, min_width: 320, min_height: 180 },
  directory: '/fixture/config',
  created_files: false,
}

test('terminal adapter shares direct Effect settings and translation without a Node module', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* translationFixture
        const connection = yield* connectTerminal(configuration, f.service)
        expect(yield* connection.ports.settings).toEqual({
          sourceLanguage: 'auto',
          initialStatus: 'Ready',
          window: { width: 700, height: 420, minWidth: 320, minHeight: 180 },
        })
        expect(Result.isFailure(yield* Effect.result(connection.ports.capture))).toBe(true)
        const controller = yield* createController(connection.ports)
        yield* controller.submit({ text: '# terminal source', targetLanguage: 'ja' })
        const { request, output } = yield* Queue.take(f.requests)
        expect(request.text).toBe('# terminal source')
        yield* Queue.offer(output, Option.some('日本語'))
        yield* Queue.offer(output, Option.none())
        const state = yield* controller.snapshots.pipe(
          Stream.filter((snapshot) => snapshot.phase === 'Complete'),
          Stream.runHead,
        )
        expect(Option.getOrThrow(state).output).toBe('日本語')
      }),
    ),
  )
})

test('terminal teardown releases in-process inference independently of native controls', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* translationFixture
        const connected = yield* connectTerminal(configuration, f.service)
        const connection = yield* connected.ports
          .translate({
            id: Schema.decodeUnknownSync(RequestId)('terminal'),
            text: 'source',
            sourceLanguage: 'auto',
            targetLanguage: 'ja',
          })
          .pipe(Stream.runDrain, Effect.forkScoped)
        yield* Queue.take(f.requests)
        yield* Fiber.interrupt(connection)
        expect(yield* Queue.take(f.lifecycle)).toBe('closed')
      }),
    ),
  )
})
