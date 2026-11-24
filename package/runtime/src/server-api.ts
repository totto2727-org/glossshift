import { Exit, Predicate, String, Array, Effect, Option, Schema } from 'effect'

import { TranslationError } from './config.ts'

export type LocalServer = Readonly<{
  origin: string
  key: string
}>
export const inferenceFailed = (): TranslationError =>
  new TranslationError({
    code: 'InferenceFailed',
    message: 'Local translation failed. Check the selected GGUF model and available memory.',
  })
export const invalidMetadata = (): TranslationError =>
  new TranslationError({
    code: 'InvalidConfig',
    message: 'The GGUF model metadata does not support the configured prompt format.',
  })

const ServerEndpoint = Schema.String.check(Schema.isPattern(/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/u))
const isServerEndpoint = Schema.is(ServerEndpoint)
const maxJsonResponseBytes = 8_388_608
const maxCompletionFrameChars = 1_048_576
const maxTokenBatchSize = 1024
const emptyResponseBytes = 0
const smallestTokenId = 0

type ServerRequest = Readonly<{ endpoint: string; body?: unknown }>

export const serverFetch = (server: LocalServer, options: ServerRequest, signal: AbortSignal): Promise<Response> => {
  const { endpoint, body } = options
  const origin = new URL(server.origin)
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    !String.isEmpty(origin.username) ||
    !String.isEmpty(origin.password) ||
    origin.pathname !== '/' ||
    !String.isEmpty(origin.search) ||
    !String.isEmpty(origin.hash) ||
    !isServerEndpoint(endpoint)
  ) {
    throw inferenceFailed()
  }
  const url = new URL(endpoint, origin)
  const headers = { Authorization: `Bearer ${server.key}`, 'Content-Type': 'application/json' }
  // oxlint-disable-next-line rules/prefer-is-nullish -- Undefined selects GET while JSON null is a valid POST body.
  const request: RequestInit = Predicate.isUndefined(body)
    ? { headers, method: 'GET', redirect: 'error', signal }
    : { body: JSON.stringify(body), headers, method: 'POST', redirect: 'error', signal }
  // oxlint-disable-next-line rules/no-fetch -- The llama.cpp boundary returns the native NSH response stream for bounded reads and cancellation.
  return fetch(url, request)
}

const responseReader = async (response: Response): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  if (!response.ok || Predicate.isNullish(response.body)) {
    await response.body?.cancel()
    throw inferenceFailed()
  }
  return response.body.getReader()
}

const closeReader = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> => {
  try {
    await reader.cancel()
  } catch {
    // The consumer may already have interrupted the underlying transport.
  } finally {
    reader.releaseLock()
  }
}

const readJsonBody = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> => {
  const decoder = new TextDecoder()
  const body = { bytes: emptyResponseBytes, text: '' }
  while (true) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- This reader advances only after the preceding chunk is decoded.
    const chunk = await reader.read()
    body.bytes += chunk.value?.byteLength ?? emptyResponseBytes
    if (body.bytes > maxJsonResponseBytes) {
      throw inferenceFailed()
    }
    body.text += decoder.decode(chunk.value, { stream: !chunk.done })
    if (chunk.done) {
      return JSON.parse(body.text) as unknown
    }
  }
}

const responseJson = async (response: Response): Promise<unknown> => {
  const reader = await responseReader(response)
  try {
    return await readJsonBody(reader)
  } finally {
    await closeReader(reader)
  }
}

export const serverJson = <A>(
  server: LocalServer,
  request: ServerRequest,
  decodeResponse: (response: unknown) => Effect.Effect<A, Schema.SchemaError>,
): Effect.Effect<A, TranslationError, never> =>
  Effect.tryPromise({
    catch: inferenceFailed,
    try: async (signal) => {
      const response = await serverFetch(server, request, signal)
      return responseJson(response)
    },
  }).pipe(Effect.flatMap(decodeResponse), Effect.mapError(inferenceFailed))

const TokenBatch = Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(smallestTokenId)))
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- Individual token values are untrusted until their integer schema validates.
const decodeTokenBatch = Schema.decodeUnknownEffect(TokenBatch)
const TokenResponse = Schema.Struct({ tokens: Schema.Unknown })
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The model's JSON response body is untrusted before decoding.
const decodeTokenResponse = Schema.decodeUnknownEffect(TokenResponse)

type TokenizeOptions = Readonly<{ trusted: boolean; addSpecial?: boolean }>

export const tokenize = (
  server: LocalServer,
  content: string,
  options: TokenizeOptions,
): Effect.Effect<number[], TranslationError, never> =>
  Effect.gen(function* () {
    const { trusted, addSpecial = false } = options
    const value = yield* serverJson(
      server,
      { body: { add_special: addSpecial, content, parse_special: trusted }, endpoint: '/tokenize' },
      decodeTokenResponse,
    )
    if (!Array.isArray(value.tokens)) {
      return yield* Effect.fail(inferenceFailed())
    }
    // Full-context arrays must not exceed NSH's synchronous JavaScript execution budget.
    const batches = yield* Effect.forEach(Array.chunksOf(value.tokens, maxTokenBatchSize), (batch) =>
      decodeTokenBatch(batch).pipe(Effect.tap(() => Effect.yieldNow)),
    )
    return Array.flatten(batches)
  }).pipe(Effect.mapError(inferenceFailed))

export const CompletionFrame = Schema.Struct({
  content: Schema.String,
  stop: Schema.Boolean,
  stop_type: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
})

const decodeCompletionFrame = Schema.decodeExit(Schema.fromJsonString(CompletionFrame))

const eventSeparator = '\n\n'
const dataPrefix = 'data:'

const parseEventData = (event: string): string => {
  const lines = String.split(event, '\n')
  const fields = Array.filter(lines, String.startsWith(dataPrefix))
  const values = Array.map(fields, (field) => field.slice(dataPrefix.length).trimStart())
  return Array.join(values, '\n')
}

const readFrame = (event: string): Option.Option<typeof CompletionFrame.Type> => {
  const data = parseEventData(event)
  if (String.isEmpty(data)) {
    return Option.none()
  }
  const decoded = decodeCompletionFrame(data)
  if (Exit.isFailure(decoded)) {
    throw inferenceFailed()
  }
  const frame = decoded.value
  if (frame.truncated === true || (frame.stop && frame.stop_type === 'limit')) {
    throw new TranslationError({
      code: 'OutputTooLong',
      message:
        'The translation exceeded the output or context token limit. Translate a smaller section or increase the configured limits.',
    })
  }
  return Option.some(frame)
}

type CompletionRequest = Readonly<{
  budget: number
  stops: Readonly<string[]>
  tokens: Readonly<number[]>
}>

const completionResponse = (server: LocalServer, request: CompletionRequest, signal: AbortSignal): Promise<Response> =>
  serverFetch(
    server,
    {
      body: {
        cache_prompt: false,
        n_keep: 0,
        n_predict: request.budget,
        prompt: request.tokens,
        stop: request.stops,
        stream: true,
        temperature: 0,
      },
      endpoint: '/completion',
    },
    signal,
  )

const trailingPartialEventCount = 1

const splitEvents = (pending: string, text: string): Readonly<{ complete: Readonly<string[]>; pending: string }> => {
  const normalized = `${pending}${text}`.replaceAll('\r\n', '\n')
  if (normalized.length > maxCompletionFrameChars) {
    throw inferenceFailed()
  }
  const events = String.split(normalized, eventSeparator)
  return {
    complete: Array.dropRight(events, trailingPartialEventCount),
    pending: Option.getOrElse(Array.last(events), () => ''),
  }
}

const readEvents = async function* (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string, never, unknown> {
  const decoder = new TextDecoder()
  const buffer = { pending: '' }
  while (true) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each SSE read follows consumption of the buffered frames.
    const chunk = await reader.read()
    const text = decoder.decode(chunk.value, { stream: !chunk.done })
    const events = splitEvents(buffer.pending, text)
    buffer.pending = events.pending
    yield* events.complete
    if (chunk.done) {
      throw inferenceFailed()
    }
  }
}

const readCompletion = async function* (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  // oxlint-disable-next-line rules/no-for-loops -- The native generator yields each frame before advancing the reader.
  for await (const event of readEvents(reader)) {
    const result = readFrame(event)
    if (Option.isSome(result)) {
      const frame = result.value
      if (!String.isEmpty(frame.content)) {
        yield frame.content
      }
      if (frame.stop) {
        if (frame.stop_type !== 'eos' && frame.stop_type !== 'word') {
          throw inferenceFailed()
        }
        return
      }
    }
  }
}

/**
 * Bounded SSE framing, independent of the process runtime. Abort owns the HTTP request.
 *
 * @param {LocalServer} server Private loopback server and access token.
 * @param {CompletionRequest} request Validated prompt tokens, prediction budget, and publisher stop markers.
 * @param {AbortSignal} signal Cancellation for the active HTTP request.
 * @yields {string} Text deltas as the model produces them.
 */
export const completion = async function* (
  server: LocalServer,
  request: CompletionRequest,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const response = await completionResponse(server, request, signal)
  const reader = await responseReader(response)
  try {
    yield* readCompletion(reader)
  } finally {
    await closeReader(reader)
  }
}
