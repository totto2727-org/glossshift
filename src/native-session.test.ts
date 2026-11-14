import { Effect, Exit, Fiber, Queue, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { RequestId } from './domain'
import { connectLocal } from './local-client'
import { localFixture } from './local-client.fixture'
import { connectDesktop } from './native-adapter'
import { adapterFixture } from './native-adapter.test'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

test('desktop adapter releases pending control receive and application-owned child on teardown', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        const opened = yield* Queue.bounded<void>(1)
        const connection = yield* Effect.scoped(
          Effect.gen(function* () {
            const connected = yield* connectDesktop(f.options)
            yield* connected.commands.pipe(Stream.runDrain, Effect.forkScoped)
            yield* Queue.offer(opened, undefined)
            yield* Effect.never
          }),
        ).pipe(Effect.forkScoped)
        yield* Queue.take(opened)
        yield* Fiber.interrupt(connection)
        expect(Exit.isFailure(yield* Effect.exit(Queue.take(f.controls)))).toBe(true)
        expect(yield* Queue.take(f.local.lifecycle)).toBe('end')
        expect(yield* Queue.take(f.local.lifecycle)).toBe('kill')
      }),
    ),
  )
})

test('local child generations namespace identical domain IDs across reconnects', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* localFixture
        const second = yield* localFixture
        const request = {
          id: Schema.decodeUnknownSync(RequestId)('same'),
          text: 'source',
          sourceLanguage: 'auto',
          targetLanguage: 'ja',
        }
        const runtime = { command: 'fixture', entry: '/fixture/main.ts' }
        const old = yield* connectLocal(runtime, first.launcher)
        const fresh = yield* connectLocal(runtime, second.launcher)
        yield* old.translate(request).pipe(Stream.runDrain, Effect.forkScoped)
        yield* fresh.translate(request).pipe(Stream.runDrain, Effect.forkScoped)
        const oldFrame = yield* Queue.take(first.written)
        const freshFrame = yield* Queue.take(second.written)
        if (oldFrame.kind !== 'translate' || freshFrame.kind !== 'translate')
          return yield* Effect.die('Expected translations')
        expect(oldFrame.requestId !== freshFrame.requestId).toBe(true)
      }),
    ),
  )
})
