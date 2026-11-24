import { TranslationError } from '@glossshift/runtime/config'
import { Predicate, Deferred, Effect, Fiber, Option, Queue, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import type { TranslationEvent } from './domain.ts'
import { RequestIdSchema, TranslationEvents } from './domain.ts'
import { FaultSchema } from './ports.ts'
import { translationFixture } from './translation-client.test.fixture.ts'
import { createTranslationClient } from './translation-client.ts'

const request = {
  id: RequestIdSchema.make('direct'),
  sourceLanguage: 'en',
  targetLanguage: 'ja',
  text: '# original\n<literal>',
}
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
  Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

test('direct translation emits original source, lossless Unicode deltas, and one completion', async () => {
  const client = createTranslationClient({
    settings: { model: 'synthetic', sourceLanguage: 'auto' },
    stream: () => Stream.fromArray(['こん', 'にちは\n']),
  })
  const output = await run(Stream.runCollect(client.translate(request)))
  expect(output).toEqual([
    TranslationEvents.Started({ id: request.id, sourceText: request.text }),
    TranslationEvents.Delta({ id: request.id, text: 'こん' }),
    TranslationEvents.Delta({ id: request.id, text: 'にちは\n' }),
    TranslationEvents.Finished({ id: request.id }),
  ])
})

test('direct translation preserves a typed actionable model failure without false completion', async () => {
  const client = createTranslationClient({
    settings: { model: 'synthetic', sourceLanguage: 'auto' },
    stream: () =>
      Stream.fail(
        new TranslationError({ code: 'OutputTooLong', message: 'Translation exceeded the model output limit.' }),
      ),
  })
  const error = await run(client.translate(request).pipe(Stream.runDrain, Effect.flip))
  expect(error).toEqual(FaultSchema.make({ message: 'Translation exceeded the model output limit.' }))
})

const observeDelta =
  (consumed: Deferred.Deferred<true>) =>
  (event: TranslationEvent): Effect.Effect<void> =>
    Predicate.isTagged('Delta')(event)
      ? Deferred.succeed(consumed, true).pipe(Effect.andThen(Effect.never))
      : Effect.void

test('in-process backpressure does not require an acknowledgement protocol and remains interruptible', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* translationFixture
        const client = createTranslationClient(testContext.service)
        const consumed = yield* Deferred.make<true>()
        const consumer = yield* client
          .translate(request)
          .pipe(Stream.runForEach(observeDelta(consumed)), Effect.forkScoped)
        const { output } = yield* Queue.take(testContext.requests)
        yield* Queue.offer(output, Option.some('first'))
        yield* Deferred.await(consumed)
        yield* Fiber.interrupt(consumer)
        expect(yield* Queue.take(testContext.lifecycle)).toBe('closed')
      }),
    ),
  )
})
