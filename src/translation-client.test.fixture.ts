import { Effect, Option, Queue, Stream } from 'effect'

import type { TranslationRequest } from '../runtime/prompt'
import type { TranslationService } from '../runtime/translation'

export const translationFixture = Effect.gen(function* () {
  const requests = yield* Queue.unbounded<{
    readonly request: TranslationRequest
    readonly output: Queue.Queue<Option.Option<string>>
  }>()
  const lifecycle = yield* Queue.unbounded<'closed'>()
  const service: TranslationService = {
    settings: { sourceLanguage: 'auto', model: 'synthetic' },
    stream: (request) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const output = yield* Effect.acquireRelease(Queue.bounded<Option.Option<string>>(1), (queue) =>
            Queue.shutdown(queue).pipe(Effect.andThen(Queue.offer(lifecycle, 'closed')), Effect.asVoid),
          )
          yield* Queue.offer(requests, { request, output })
          return Stream.fromQueue(output).pipe(Stream.takeWhile(Option.isSome), Stream.map(Option.getOrThrow))
        }),
      ),
  }
  return { service, requests, lifecycle }
})
