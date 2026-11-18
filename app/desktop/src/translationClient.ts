import type { TranslationService } from '@glossshift/runtime/translation'
import { Effect, Stream } from 'effect'

import { TranslationEvent } from './domain'
import { Fault } from './ports'
import type { TranslationRequest } from './ports'

/** The controller owns each stream's scope, including cancellation and backpressure. */
export const createTranslationClient = (service: TranslationService) => ({
  settings: service.settings,
  translate: (request: TranslationRequest): Stream.Stream<TranslationEvent, Fault> =>
    Stream.succeed(TranslationEvent.Started({ id: request.id, sourceText: request.text })).pipe(
      Stream.concat(
        service.stream(request).pipe(
          Stream.map((text) => TranslationEvent.Delta({ id: request.id, text })),
          Stream.mapError((error) => Fault.make({ message: error.message })),
        ),
      ),
      Stream.concat(Stream.succeed(TranslationEvent.Finished({ id: request.id }))),
    ),
  // The controller interrupts the stream before invoking this idempotent port.
  cancel: (_id: TranslationRequest['id']) => Effect.void,
})
