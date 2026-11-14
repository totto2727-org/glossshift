import { Deferred, Effect, Fiber, Option, Queue, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { TranslationError } from '../runtime/config'
import { RequestId } from './domain'
import { createTranslationClient } from './translation-client'
import { translationFixture } from './translation-client.test.fixture'

const request = {
  id: Schema.decodeUnknownSync(RequestId)('direct'),
  text: '# original\n<literal>',
  sourceLanguage: 'en',
  targetLanguage: 'ja',
}
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

test('direct translation emits original source, lossless Unicode deltas, and one completion', async () => {
  const client = createTranslationClient({
    settings: { sourceLanguage: 'auto', model: 'synthetic' },
    stream: () => Stream.fromArray(['こん', 'にちは\n']),
  })
  expect(await run(Stream.runCollect(client.translate(request)))).toEqual([
    { _tag: 'Started', id: request.id, sourceText: request.text },
    { _tag: 'Delta', id: request.id, text: 'こん' },
    { _tag: 'Delta', id: request.id, text: 'にちは\n' },
    { _tag: 'Finished', id: request.id },
  ])
})

test('direct translation preserves a typed actionable model failure without false completion', async () => {
  const client = createTranslationClient({
    settings: { sourceLanguage: 'auto', model: 'synthetic' },
    stream: () =>
      Stream.fail(
        new TranslationError({ code: 'OutputTooLong', message: 'Translation exceeded the model output limit.' }),
      ),
  })
  const error = await run(client.translate(request).pipe(Stream.runDrain, Effect.flip))
  expect(error).toEqual({ _tag: 'ActionRequired', message: 'Translation exceeded the model output limit.' })
})

test('in-process backpressure does not require an acknowledgement protocol and remains interruptible', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* translationFixture
        const client = createTranslationClient(f.service)
        const consumed = yield* Deferred.make<void>()
        const consumer = yield* client.translate(request).pipe(
          Stream.runForEach((event) =>
            event._tag === 'Delta'
              ? Deferred.succeed(consumed, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.void,
          ),
          Effect.forkScoped,
        )
        const { output } = yield* Queue.take(f.requests)
        yield* Queue.offer(output, Option.some('first'))
        yield* Deferred.await(consumed)
        yield* Fiber.interrupt(consumer)
        expect(yield* Queue.take(f.lifecycle)).toBe('closed')
      }),
    ),
  )
})
