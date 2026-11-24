import type { TranslationError, TranslationService } from '@glossshift/runtime/translation'
import { Effect, Stream } from 'effect'

import { TranslationEvents } from './domain.ts'
import type { TranslationEvent } from './domain.ts'
import { FaultSchema } from './ports.ts'
import type { Fault, NativePorts, PublicSettings, TranslationRequest } from './ports.ts'

/** The controller owns each stream's scope, including cancellation and backpressure. */
type TranslationClient = Pick<NativePorts, 'translate' | 'cancel'> &
  Readonly<{ settings: Pick<PublicSettings, 'sourceLanguage'> & Readonly<{ model: string }> }>

const publicFailure = (failure: TranslationError): Fault => FaultSchema.make({ message: failure.message })

const translateWith =
  (service: TranslationService) =>
  (request: TranslationRequest): Stream.Stream<TranslationEvent, Fault> => {
    const { id } = request
    const begin = Stream.succeed(TranslationEvents.Started({ id, sourceText: request.text }))
    const end = Stream.succeed(TranslationEvents.Finished({ id }))
    const translation = service.stream(request).pipe(
      Stream.map((text) => TranslationEvents.Delta({ id, text })),
      Stream.mapError(publicFailure),
    )
    return begin.pipe(Stream.concat(translation), Stream.concat(end))
  }

export const createTranslationClient = (service: TranslationService): TranslationClient => ({
  // The controller interrupts the stream before invoking this idempotent port.
  cancel: (_id: TranslationRequest['id']) => Effect.void,
  settings: service.settings,
  translate: translateWith(service),
})
