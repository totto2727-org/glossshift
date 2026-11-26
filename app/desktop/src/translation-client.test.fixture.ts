import type { TranslationRequest } from '@glossshift/runtime/prompt'
import type { TranslationService } from '@glossshift/runtime/translation'
import { Effect, Option, Queue, Stream } from 'effect'

const pendingDeltaSlots = 1

const closeOutput =
  (lifecycle: Queue.Queue<'closed'>) =>
  (queue: Queue.Queue<Option.Option<string>>): Effect.Effect<void> =>
    Queue.shutdown(queue).pipe(Effect.andThen(Queue.offer(lifecycle, 'closed')), Effect.asVoid)

export const translationFixture = Effect.gen(function* () {
  const requests = yield* Queue.unbounded<
    Readonly<{
      request: TranslationRequest
      output: Queue.Queue<Option.Option<string>>
    }>
  >()
  const lifecycle = yield* Queue.unbounded<'closed'>()
  const service: TranslationService = {
    settings: { model: 'synthetic', sourceLanguage: 'auto' },
    stream: (request) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const queue = Queue.bounded<Option.Option<string>>(pendingDeltaSlots)
          const output = yield* Effect.acquireRelease(queue, closeOutput(lifecycle))
          yield* Queue.offer(requests, { output, request })
          return Stream.fromQueue(output).pipe(Stream.takeWhile(Option.isSome), Stream.map(Option.getOrThrow))
        }),
      ),
  }
  return { lifecycle, requests, service }
})
