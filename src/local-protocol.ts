import { Schema } from 'effect'

export const MAX_FRAME_BYTES = 1024 * 1024
const Request = Schema.NonEmptyString.check(Schema.isMaxLength(128))
const Sequence = Schema.Int.check(Schema.isGreaterThan(0))
const Language = Schema.NonEmptyString.check(Schema.isMaxLength(64))
const Text = Schema.String.check(Schema.isMaxLength(MAX_FRAME_BYTES / 2))

export const ClientFrame = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal('translate'),
    requestId: Request,
    text: Text,
    sourceLanguage: Language,
    targetLanguage: Language,
  }),
  Schema.Struct({ version: Schema.Literal(1), kind: Schema.Literal('cancel'), requestId: Request }),
  Schema.Struct({ version: Schema.Literal(1), kind: Schema.Literal('ack'), requestId: Request, seq: Sequence }),
])
export type ClientFrame = typeof ClientFrame.Type

export const ServerFrame = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal('ready'),
    sourceLanguage: Language,
    model: Schema.NonEmptyString,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal('started'),
    requestId: Request,
    seq: Sequence,
    text: Text,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal('delta'),
    requestId: Request,
    seq: Sequence,
    text: Text,
  }),
  Schema.Struct({ version: Schema.Literal(1), kind: Schema.Literal('finished'), requestId: Request, seq: Sequence }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal('failed'),
    requestId: Request,
    seq: Sequence,
    message: Schema.NonEmptyString,
  }),
  Schema.Struct({ version: Schema.Literal(1), kind: Schema.Literal('fatal'), message: Schema.NonEmptyString }),
])
export type ServerFrame = typeof ServerFrame.Type
export const ClientJson = Schema.fromJsonString(ClientFrame)
export const ServerJson = Schema.fromJsonString(ServerFrame)
