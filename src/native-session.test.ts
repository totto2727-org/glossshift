import { Effect, Exit, Fiber, Queue, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { RequestId } from './domain'
import { connectDesktop } from './native-adapter'
import { adapterFixture } from './native-adapter.test'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

test('desktop teardown releases its pending control receive without a translation child', async () => {
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
        expect(f.desktopEvents).toEqual(['tray:install', 'tray:remove'])
      }),
    ),
  )
})

test('interrupting an in-process translation releases its stream and allows immediate reuse', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        const { ports } = yield* connectDesktop(f.options)
        const request = {
          id: Schema.decodeUnknownSync(RequestId)('same'),
          text: 'source',
          sourceLanguage: 'auto',
          targetLanguage: 'ja',
        }
        const first = yield* ports.translate(request).pipe(Stream.runDrain, Effect.forkScoped)
        const old = yield* Queue.take(f.local.requests)
        yield* Fiber.interrupt(first)
        expect(yield* Queue.take(f.local.lifecycle)).toBe('closed')
        expect(Exit.isFailure(yield* Effect.exit(Queue.take(old.output)))).toBe(true)
        const second = yield* ports.translate(request).pipe(Stream.runDrain, Effect.forkScoped)
        const fresh = yield* Queue.take(f.local.requests)
        expect(fresh.request.text).toBe('source')
        yield* Fiber.interrupt(second)
        expect(yield* Queue.take(f.local.lifecycle)).toBe('closed')
      }),
    ),
  )
})
