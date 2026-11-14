import { Context, Effect, Schema, Stream } from 'effect'

import type { RequestId, TranslationEvent } from './domain'

export const Fault = Schema.Struct({
  _tag: Schema.Literal('ActionRequired'),
  message: Schema.String,
})
export type Fault = typeof Fault.Type

export const PublicSettings = Schema.Struct({
  sourceLanguage: Schema.String,
  initialStatus: Schema.String,
  window: Schema.Struct({
    width: Schema.Number,
    height: Schema.Number,
    minWidth: Schema.Number,
    minHeight: Schema.Number,
  }),
})
export type PublicSettings = typeof PublicSettings.Type

export interface TranslationRequest {
  readonly id: RequestId
  readonly text: string
  readonly sourceLanguage: string
  readonly targetLanguage: string
}

/** Local model configuration remains inside the Node translation boundary. */
export interface NativePorts {
  readonly settings: Effect.Effect<PublicSettings, Fault>
  readonly capture: Effect.Effect<string, Fault>
  /** A lossless bounded stream. The controller finalizer releases the local request. */
  readonly translate: (request: TranslationRequest) => Stream.Stream<TranslationEvent, Fault>
  /** Idempotent and able to wake blocked transport operations. */
  readonly cancel: (id: RequestId) => Effect.Effect<void, Fault>
  readonly copy: (text: string) => Effect.Effect<void, Fault>
  readonly reveal: Effect.Effect<void, Fault>
  readonly hide: Effect.Effect<void, Fault>
  readonly quit: Effect.Effect<void, Fault>
  readonly shortcuts: Stream.Stream<string, Fault>
}

export const Native = Context.Service<NativePorts>('GlossShift/Native')
