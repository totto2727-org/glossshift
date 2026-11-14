import { Array, Effect, Schema } from 'effect'

import { TranslationError } from './config.ts'

export interface LocalServer {
  readonly origin: string
  readonly key: string
}
export const inferenceFailed = () =>
  new TranslationError({
    code: 'InferenceFailed',
    message: 'Local translation failed. Check the selected GGUF model and available memory.',
  })
export const invalidMetadata = () =>
  new TranslationError({
    code: 'InvalidConfig',
    message: 'The GGUF model metadata does not support the configured prompt format.',
  })

export const serverFetch = (server: LocalServer, endpoint: string, body: unknown, signal: AbortSignal) => {
  const origin = new URL(server.origin)
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== '' ||
    !/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(endpoint)
  )
    throw inferenceFailed()
  return fetch(new URL(endpoint, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${server.key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
    redirect: 'error',
  })
}

const responseJson = async (response: Response): Promise<unknown> => {
  if (!response.ok || response.body === null) {
    await response.body?.cancel()
    throw inferenceFailed()
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      bytes += chunk.value?.byteLength ?? 0
      if (bytes > 8 * 1024 * 1024) throw inferenceFailed()
      text += decoder.decode(chunk.value, { stream: !chunk.done })
      if (chunk.done) return JSON.parse(text) as unknown
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export const serverJson = <A>(server: LocalServer, endpoint: string, body: unknown, schema: Schema.Codec<A, unknown>) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await serverFetch(server, endpoint, body, signal)
      return responseJson(response)
    },
    catch: inferenceFailed,
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)), Effect.mapError(inferenceFailed))

const Tokens = Schema.Struct({ tokens: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))) })
export const tokenize = (server: LocalServer, content: string, trusted: boolean, addSpecial = false) =>
  serverJson(server, '/tokenize', { content, parse_special: trusted, add_special: addSpecial }, Tokens).pipe(
    Effect.map((value) => value.tokens),
  )

export const CompletionFrame = Schema.Struct({
  content: Schema.String,
  stop: Schema.Boolean,
  stop_type: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
})

/** Bounded SSE framing, independent of the process runtime. Abort owns the HTTP request. */
export async function* completion(
  server: LocalServer,
  tokens: ReadonlyArray<number>,
  budget: number,
  stops: ReadonlyArray<string>,
  signal: AbortSignal,
) {
  const response = await serverFetch(
    server,
    '/completion',
    { prompt: tokens, n_predict: budget, temperature: 0, stream: true, stop: stops, cache_prompt: false, n_keep: 0 },
    signal,
  )
  if (!response.ok || response.body === null) {
    await response.body?.cancel()
    throw inferenceFailed()
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let terminal = false
  try {
    while (true) {
      const chunk = await reader.read()
      pending = `${pending}${decoder.decode(chunk.value, { stream: !chunk.done })}`.replaceAll('\r\n', '\n')
      if (pending.length > 1024 * 1024) throw inferenceFailed()
      let end = pending.indexOf('\n\n')
      while (end >= 0) {
        const event = pending.slice(0, end)
        pending = pending.slice(end + 2)
        const data = Array.join(
          Array.map(
            Array.filter(event.split('\n'), (line) => line.startsWith('data:')),
            (line) => line.slice(5).trimStart(),
          ),
          '\n',
        )
        if (data !== '') {
          const frame = Schema.decodeUnknownSync(CompletionFrame)(JSON.parse(data))
          if (frame.truncated === true || (frame.stop && frame.stop_type === 'limit'))
            throw new TranslationError({
              code: 'OutputTooLong',
              message:
                'The translation exceeded the output or context token limit. Translate a smaller section or increase the configured limits.',
            })
          if (frame.content !== '') yield frame.content
          if (frame.stop) {
            if (frame.stop_type !== 'eos' && frame.stop_type !== 'word') throw inferenceFailed()
            terminal = true
            return
          }
        }
        end = pending.indexOf('\n\n')
      }
      if (chunk.done) break
    }
    if (!terminal) throw inferenceFailed()
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
