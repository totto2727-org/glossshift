import { Effect, Stream } from 'effect'

import type { TranslationService } from '../node/translation'
import type { TranslationEvent } from './domain'
import type { Fault, TranslationRequest } from './ports'

/** The controller owns each stream's scope, including cancellation and backpressure. */
export const createTranslationClient = (service: TranslationService) => ({
  settings: service.settings,
  translate: (request: TranslationRequest): Stream.Stream<TranslationEvent, Fault> =>
    Stream.succeed<TranslationEvent>({ _tag: 'Started', id: request.id, sourceText: request.text }).pipe(
      Stream.concat(
        service.stream(request).pipe(
          Stream.map((text): TranslationEvent => ({ _tag: 'Delta', id: request.id, text })),
          Stream.mapError((error): Fault => ({ _tag: 'ActionRequired', message: error.message })),
        ),
      ),
      Stream.concat(Stream.succeed<TranslationEvent>({ _tag: 'Finished', id: request.id })),
    ),
  // The controller interrupts the stream before invoking this idempotent port.
  cancel: (_id: TranslationRequest['id']) => Effect.void,
})
