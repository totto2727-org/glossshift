import { Effect, Exit, Fiber, Queue, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { RequestIdSchema } from './domain.ts'
import { adapterFixture } from './native-adapter.test.ts'
import { connectDesktop } from './native-adapter.ts'

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
  Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

const shutdownObserved = <A>(queue: Queue.Queue<A>): Effect.Effect<boolean> =>
  Effect.exit(Queue.take(queue)).pipe(Effect.map(Exit.isFailure))

const closedAfterInterrupt = (
  fiber: Fiber.Fiber<void, unknown>,
  lifecycle: Queue.Queue<'closed'>,
): Effect.Effect<'closed'> => Effect.andThen(Fiber.interrupt(fiber), Queue.take(lifecycle))

test('desktop teardown releases its pending control receive without a translation child', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* adapterFixture
        const opened = yield* Queue.bounded<true>(1)
        const connection = yield* Effect.scoped(
          Effect.gen(function* () {
            const connected = yield* connectDesktop(testContext.options)
            yield* connected.commands.pipe(Stream.runDrain, Effect.forkScoped)
            yield* Queue.offer(opened, true)
            yield* Effect.never
          }),
        ).pipe(Effect.forkScoped)
        yield* Queue.take(opened)
        yield* Fiber.interrupt(connection)
        expect(yield* shutdownObserved(testContext.controls)).toBe(true)
        expect(testContext.desktopEvents).toEqual(['tray:install', 'tray:remove'])
      }),
    ),
  )
})

test('interrupting an in-process translation releases its stream and allows immediate reuse', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* adapterFixture
        const { ports } = yield* connectDesktop(testContext.options)
        const request = {
          id: RequestIdSchema.make('same'),
          sourceLanguage: 'auto',
          targetLanguage: 'ja',
          text: 'source',
        }
        const first = yield* ports.translate(request).pipe(Stream.runDrain, Effect.forkScoped)
        const old = yield* Queue.take(testContext.local.requests)
        expect(yield* closedAfterInterrupt(first, testContext.local.lifecycle)).toBe('closed')
        expect(yield* shutdownObserved(old.output)).toBe(true)
        const second = yield* ports.translate(request).pipe(Stream.runDrain, Effect.forkScoped)
        expect((yield* Queue.take(testContext.local.requests)).request.text).toBe('source')
        expect(yield* closedAfterInterrupt(second, testContext.local.lifecycle)).toBe('closed')
      }),
    ),
  )
})
