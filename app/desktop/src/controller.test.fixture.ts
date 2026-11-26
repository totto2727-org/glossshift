import { Deferred, Effect, Queue, Ref, Stream } from 'effect'

import { TranslationEvents } from './domain.ts'
import type { NativePorts, TranslationRequest } from './ports.ts'

const initialProduced = 0
const producedPerDelta = 1
const framesBeyondCapacity = 257

type FloodContext = Readonly<{ ports: NativePorts; requests: Queue.Queue<TranslationRequest> }>

export const blockedReveal = Effect.gen(function* () {
  const revealing = yield* Deferred.make<true>()
  const release = yield* Deferred.make<true>()
  const reveal = Effect.andThen(Deferred.succeed(revealing, true), Deferred.await(release)).pipe(Effect.asVoid)
  return { release, reveal, revealing }
})

export const floodFixture = (
  context: FloodContext,
): Effect.Effect<
  Effect.Success<typeof blockedReveal> & {
    ports: NativePorts
    saturated: Deferred.Deferred<true>
  }
> =>
  Effect.gen(function* () {
    const blocked = yield* blockedReveal
    const saturated = yield* Deferred.make<true>()
    const produced = yield* Ref.make(initialProduced)
    const translate: NativePorts['translate'] = (request) => {
      const events = Stream.fromEffectRepeat(
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(produced, (value) => value + producedPerDelta)
          if (count === framesBeyondCapacity) {
            yield* Deferred.succeed(saturated, true)
          }
          return TranslationEvents.Delta({ id: request.id, text: 'x' })
        }),
      )
      return Stream.unwrap(Queue.offer(context.requests, request).pipe(Effect.as(events)))
    }
    return { ...blocked, ports: { ...context.ports, reveal: blocked.reveal, translate }, saturated }
  })
