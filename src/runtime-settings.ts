import process from 'process'

import { Effect, Schema } from 'effect'

import type { Fault } from './ports'

const AbsolutePath = Schema.String.check(Schema.isPattern(/^\/[^\0]+$/u))
export const RuntimeSettings = Schema.Struct({
  command: Schema.Union([Schema.Literal('node'), AbsolutePath]),
  entry: AbsolutePath,
})
export type RuntimeSettings = typeof RuntimeSettings.Type

/** Launchers supply only these two granted values; installed wrappers replace caller values. */
export const readRuntimeSettings = (environment: Readonly<Record<string, unknown>> = process.env) =>
  Schema.decodeUnknownEffect(RuntimeSettings)({
    command: environment['GLOSSSHIFT_NODE_COMMAND'],
    entry: environment['GLOSSSHIFT_NODE_ENTRY'],
  }).pipe(
    Effect.mapError((): Fault => ({
      _tag: 'ActionRequired',
      message: 'The local runtime location is unavailable. Start GlossShift with its installed launcher or Vite+ task.',
    })),
  )
