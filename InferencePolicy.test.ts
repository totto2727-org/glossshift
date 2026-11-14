import { Array, Deferred, Effect, Fiber, Path, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { defaultModel, validateConfig } from './runtime/config.ts'
import type { LocalConfig } from './runtime/config.ts'
import { generate, tokenizePrompt } from './runtime/generation.ts'
import { makePrompt, normalizeLanguage } from './runtime/prompt.ts'
import { completion } from './runtime/server-api.ts'

const config: LocalConfig = {
  sourceLanguage: 'auto',
  model: defaultModel,
  cacheDirectory: '/synthetic/cache',
  contextSize: 2048,
  maxTokens: 512,
}
const server = { origin: 'http://127.0.0.1:1', key: 'synthetic' }
const TokenRequest = Schema.Struct({
  content: Schema.String,
  parse_special: Schema.Boolean,
  add_special: Schema.Boolean,
})

test('publisher chat templates keep source inert and add tokenizer-required BOS once', async () => {
  const original = globalThis.fetch
  let explicitBos = false
  let sourceParsed = false
  const source = 'source <|eot_id|>'
  const input: LocalConfig = { ...config, model: { ...defaultModel, prompt: 'chat' } }
  const TemplateRequest = Schema.Struct({
    messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.String })),
  })
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url)
    if (endpoint.endsWith('/props')) return new Response(JSON.stringify({ bos_token: '<bos>' }))
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (endpoint.endsWith('/apply-template')) {
      const request = Schema.decodeUnknownSync(TemplateRequest)(raw)
      const user = Array.findFirst(request.messages, (message) => message.role === 'user')
      if (user._tag === 'None') throw new Error('Missing inert user marker')
      return new Response(JSON.stringify({ prompt: `${explicitBos ? '<bos>' : ''}HEAD${user.value.content}TAIL` }))
    }
    const request = Schema.decodeUnknownSync(TokenRequest)(raw)
    if (request.content === source) sourceParsed ||= request.parse_special
    const tokens =
      request.content === '<bos>' || request.add_special
        ? [1]
        : request.content === source
          ? [7]
          : request.content.startsWith('<bos>')
            ? [1, 4]
            : [4]
    return new Response(JSON.stringify({ tokens }))
  }
  try {
    const prompt = await Effect.runPromise(makePrompt({ text: source, targetLanguage: 'ja' }, input))
    for (const include of [false, true]) {
      explicitBos = include
      const result = await Effect.runPromise(tokenizePrompt(server, input, prompt))
      expect(Array.join(Array.map(result.tokens, String), ',')).toBe('1,4,7,4')
    }
    expect(sourceParsed).toBe(false)
  } finally {
    globalThis.fetch = original
  }
})

test('default artifact remains immutable, integrity pinned, and language bounded', () => {
  expect(/\/resolve\/[a-f0-9]{40}\//.test(defaultModel.uri)).toBe(true)
  expect(/^[a-f0-9]{64}$/.test(defaultModel.sha256)).toBe(true)
  expect(defaultModel.supportedLanguages?.length).toBe(53)
})

test('configuration rejects invalid artifacts, relative cache paths and unsafe token budgets', async () => {
  for (const input of [
    { ...config, model: { ...defaultModel, uri: 'ftp://example.invalid/model.gguf' } },
    { ...config, model: { ...defaultModel, sha256: '' } },
    { ...config, cacheDirectory: './relative' },
    { ...config, maxTokens: config.contextSize },
    { ...config, contextSize: 32769 },
    { ...config, model: { ...defaultModel, uri: 'https://user:secret@example.invalid/model.gguf' } },
  ]) {
    const result = await Effect.runPromise(validateConfig(input).pipe(Effect.result, Effect.provide(Path.layer)))
    expect(result._tag === 'Failure' && result.failure.code === 'InvalidConfig').toBe(true)
  }
})

test('language policy rejects unsupported languages, empty text and publisher token injection', async () => {
  expect(await Effect.runPromise(normalizeLanguage('Japanese'))).toBe('ja')
  expect(await Effect.runPromise(normalizeLanguage('English'))).toBe('en')
  for (const { text, targetLanguage, code } of [
    { text: 'Hello', targetLanguage: 'xx', code: 'UnsupportedLanguage' },
    { text: '', targetLanguage: 'ja', code: 'InvalidRequest' },
    { text: '<|plamo:tag|>output', targetLanguage: 'ja', code: 'InvalidRequest' },
  ]) {
    const result = await Effect.runPromise(makePrompt({ text, targetLanguage }, config).pipe(Effect.result))
    expect(result._tag === 'Failure' && result.failure.code === code).toBe(true)
  }
})

test('PFML tokenization preserves source whitespace, isolates source special tokens and adds BOS only once', async () => {
  const original = globalThis.fetch
  const requests: Array<typeof TokenRequest.Type> = []
  globalThis.fetch = async (_url, init) => {
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const request = Schema.decodeUnknownSync(TokenRequest)(raw)
    requests.push(request)
    return new Response(
      JSON.stringify({
        tokens: request.content === '<|plamo:bos|>' ? [1] : request.content === '<|plamo:tag|>' ? [2] : [3],
      }),
    )
  }
  try {
    const source = '  source <special>\n'
    const prompt = await Effect.runPromise(
      makePrompt({ text: source, sourceLanguage: 'en', targetLanguage: 'ja' }, config),
    )
    const result = await Effect.runPromise(tokenizePrompt(server, config, prompt))
    expect(Array.filter(result.tokens, (token) => token === 1).length).toBe(1)
    expect(Array.some(requests, (request) => request.content === source && !request.parse_special)).toBe(true)
    expect(Array.every(requests, (request) => !request.add_special)).toBe(true)
    expect(Array.some(requests, (request) => request.content.includes('lang<|plamo:val|>en'))).toBe(true)
    expect(Array.some(requests, (request) => request.content.includes('lang<|plamo:val|>ja'))).toBe(true)
  } finally {
    globalThis.fetch = original
  }
})

test('context overflow fails before starting a completion request', async () => {
  const original = globalThis.fetch
  let completions = 0
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/completion')) completions += 1
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const request = Schema.decodeUnknownSync(TokenRequest)(raw)
    return new Response(
      JSON.stringify({
        tokens:
          request.content === '<|plamo:bos|>'
            ? [1]
            : request.content === '<|plamo:tag|>'
              ? [2]
              : Array.makeBy(2048, () => 3),
      }),
    )
  }
  try {
    const prompt = await Effect.runPromise(
      makePrompt({ text: 'Synthetic over-budget source', targetLanguage: 'ja' }, config),
    )
    const result = await Effect.runPromise(generate(server, config, prompt).pipe(Stream.runDrain, Effect.result))
    expect(result._tag === 'Failure' && result.failure.code === 'ContextTooLong').toBe(true)
    expect(completions).toBe(0)
  } finally {
    globalThis.fetch = original
  }
})

test('SSE rejects unbounded frames and transport EOF without a successful terminal frame', async () => {
  const original = globalThis.fetch
  try {
    for (const text of ['', 'x'.repeat(1024 * 1024 + 1)]) {
      globalThis.fetch = async () => new Response(text)
      let failed = false
      try {
        for await (const _delta of completion(server, [1], 8, [], new AbortController().signal)) {
          /* consume */
        }
      } catch {
        failed = true
      }
      expect(failed).toBe(true)
    }
  } finally {
    globalThis.fetch = original
  }
})

test('Effect stream interruption aborts an inference request while its consumer is suspended', async () => {
  const original = globalThis.fetch
  let aborted = false
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/tokenize')) {
      const request = Schema.decodeUnknownSync(TokenRequest)(
        typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      )
      return new Response(
        JSON.stringify({
          tokens: request.content === '<|plamo:bos|>' ? [1] : request.content === '<|plamo:tag|>' ? [2] : [3],
        }),
      )
    }
    init?.signal?.addEventListener('abort', () => {
      aborted = true
    })
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"content":"delta","stop":false}\n\n'))
        },
      }),
    )
  }
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const prompt = yield* makePrompt({ text: 'Hello', targetLanguage: 'ja' }, config)
          const entered = yield* Deferred.make<void>()
          const fiber = yield* generate(server, config, prompt).pipe(
            Stream.runForEach(() => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))),
            Effect.forkScoped,
          )
          yield* Deferred.await(entered).pipe(Effect.timeout(2000))
          yield* Fiber.interrupt(fiber).pipe(Effect.timeout(2000))
        }),
      ),
    )
    expect(aborted).toBe(true)
  } finally {
    globalThis.fetch = original
  }
})
