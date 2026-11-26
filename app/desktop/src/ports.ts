import type { Effect, Stream } from 'effect'
import { Context, Schema } from 'effect'

import type { RequestId, TranslationEvent } from './domain.ts'

export const FaultSchema = Schema.TaggedStruct('ActionRequired', {
  message: Schema.String,
})
export type Fault = typeof FaultSchema.Type

export const PublicSettingsSchema = Schema.Struct({
  initialStatus: Schema.String,
  sourceLanguage: Schema.String,
  window: Schema.Struct({
    height: Schema.Number,
    minHeight: Schema.Number,
    minWidth: Schema.Number,
    width: Schema.Number,
  }),
})
export type PublicSettings = typeof PublicSettingsSchema.Type

export type TranslationRequest = Readonly<{
  id: RequestId
  text: string
  sourceLanguage: string
  targetLanguage: string
}>

/** Injectable application services run inside the official NSH host. */
export type NativePorts = Readonly<{
  settings: Effect.Effect<PublicSettings, Fault>
  capture: Effect.Effect<string, Fault>
  /** A lossless bounded stream. The controller finalizer releases the local request. */
  translate: (request: TranslationRequest) => Stream.Stream<TranslationEvent, Fault>
  /** Idempotent cleanup after the controller interrupts the request stream. */
  cancel: (id: RequestId) => Effect.Effect<void, Fault>
  copy: (text: string) => Effect.Effect<void, Fault>
  reveal: Effect.Effect<void, Fault>
  hide: Effect.Effect<void, Fault>
  quit: Effect.Effect<void, Fault>
  shortcuts: Stream.Stream<string, Fault>
}>

export const Native = Context.Service<NativePorts>('GlossShift/Native')
