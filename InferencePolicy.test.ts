import { Array, ConfigProvider, Deferred, Effect, Fiber, FileSystem, Path, Record, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import { defaultModel, loadConfig, TranslationError, validateConfig } from './runtime/config.ts'
import type { LocalConfig } from './runtime/config.ts'
import { generate, tokenizePrompt } from './runtime/generation.ts'
import { modelPresets } from './runtime/models.ts'
import { makePrompt, normalizeLanguage } from './runtime/prompt.ts'
import { completion, tokenize } from './runtime/server-api.ts'

const loadFixtureConfig = (file: unknown = undefined, env: Record<string, string> = {}) =>
  loadConfig.pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        exists: () => Effect.succeed(file !== undefined),
        readFileString: () => Effect.succeed(JSON.stringify(file)),
      }),
    ),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnvRecord({ HOME: '/synthetic/home', ...env }),
    ),
    Effect.provide(Path.layer),
  )

test('optional configuration defaults to the pinned 0.8B model and its full context', async () => {
  const result = await Effect.runPromise(loadFixtureConfig())
  expect(result.model.uri).toBe(defaultModel.uri)
  expect(result.model.sha256).toBe(defaultModel.sha256)
  expect(result.contextSize).toBe(262144)
  expect(result.maxTokens).toBe(262144)
  expect(result.cacheDirectory).toBe('/synthetic/home/.cache/glossshift/models')
})

test('all four official IDs select pinned metadata and enforce the publisher context limit, with file or env selection', async () => {
  for (const id of [
    'plamo-3-translate-0.8b',
    'plamo-3-translate-2b',
    'plamo-3-translate-8b',
    'plamo-3-translate-31b',
  ] as const) {
    const preset = modelPresets[id]
    for (const program of [loadFixtureConfig({ model: id }), loadFixtureConfig(undefined, { GLOSSSHIFT_MODEL: id })]) {
      const result = await Effect.runPromise(program)
      expect(result.model.uri).toBe(preset.model.uri)
      expect(result.model.sha256).toBe(preset.model.sha256)
      expect(result.model.prompt).toBe('plamo')
      expect(result.model.supportedLanguages?.length).toBe(53)
      expect(result.contextSize).toBe(preset.contextSize)
      expect(result.maxTokens).toBe(preset.maxTokens)
      expect(/\/resolve\/[a-f0-9]{40}\//.test(result.model.uri)).toBe(true)
      expect(/^[a-f0-9]{64}$/.test(result.model.sha256)).toBe(true)
    }
    expect(preset.contextLimit).toBe(262144)
    const fullContext = await Effect.runPromise(loadFixtureConfig({ model: id, contextSize: 262144 }))
    expect(fullContext.contextSize).toBe(262144)
    expect(fullContext.maxTokens).toBe(262144)
    const overflow = await Effect.runPromise(loadFixtureConfig({ model: id, contextSize: 262145 }).pipe(Effect.result))
    expect(overflow._tag === 'Failure' && overflow.failure.code === 'InvalidConfig').toBe(true)
  }
})

test('environment model selection wins while explicit file cache and token overrides survive', async () => {
  const result = await Effect.runPromise(
    loadFixtureConfig(
      { model: 'plamo-3-translate-0.8b', cacheDirectory: '/synthetic/override', contextSize: 32768, maxTokens: 8192 },
      { GLOSSSHIFT_MODEL: 'plamo-3-translate-2b' },
    ),
  )
  expect(result.model.sha256).toBe(modelPresets['plamo-3-translate-2b'].model.sha256)
  expect(result.cacheDirectory).toBe('/synthetic/override')
  expect(result.contextSize).toBe(32768)
  expect(result.maxTokens).toBe(8192)
  const custom = { uri: 'file:///synthetic/custom.gguf', sha256: 'A'.repeat(64), prompt: 'chat' }
  const compatible = await Effect.runPromise(loadFixtureConfig({ model: custom, contextSize: 65536 }))
  expect(compatible.model.uri).toBe(custom.uri)
  expect(compatible.model.sha256).toBe('a'.repeat(64))
  expect(compatible.contextSize).toBe(65536)
})

test('invalid selections and unsafe explicit overrides fail without falling back', async () => {
  for (const program of [
    loadFixtureConfig({ model: 'plamo-3-translate-32b' }),
    loadFixtureConfig({ model: 'unknown' }),
    loadFixtureConfig(undefined, { GLOSSSHIFT_MODEL: 'unknown' }),
    loadFixtureConfig({ model: 'plamo-3-translate-2b' }, { GLOSSSHIFT_MODEL: 'not-a-model' }),
    loadFixtureConfig({ model: 'unknown' }, { GLOSSSHIFT_MODEL: 'plamo-3-translate-2b' }),
    loadFixtureConfig({ model: 'plamo-3-translate-2b', contextSize: 262145 }),
    loadFixtureConfig({ model: 'plamo-3-translate-0.8b', contextSize: 262145 }),
    loadFixtureConfig({ maxTokens: 262145 }),
    loadFixtureConfig({ contextSize: 8192.5 }),
    loadFixtureConfig({ cacheDirectory: './relative' }),
    loadFixtureConfig({ model: { uri: 'file:///synthetic/model.gguf', sha256: '', prompt: 'chat' } }),
  ]) {
    const result = await Effect.runPromise(program.pipe(Effect.result))
    expect(result._tag === 'Failure' && result.failure.code === 'InvalidConfig').toBe(true)
  }
})

test('unknown custom artifacts require an explicit model context without imposing an application cap', async () => {
  const model = { uri: 'file:///synthetic/custom.gguf', sha256: 'a'.repeat(64), prompt: 'chat' }
  for (const overrides of [{}, { maxTokens: 512 }]) {
    const result = await Effect.runPromise(loadFixtureConfig({ model, ...overrides }).pipe(Effect.result))
    expect(result._tag === 'Failure' && result.failure.code === 'InvalidConfig').toBe(true)
    expect(result._tag === 'Failure' && result.failure.message.includes('Set contextSize in local.json')).toBe(true)
  }
  for (const contextSize of [8192, 524288]) {
    const result = await Effect.runPromise(loadFixtureConfig({ model, contextSize }))
    expect(result.contextSize).toBe(contextSize)
    expect(result.maxTokens).toBe(contextSize)
  }
  const explicit = await Effect.runPromise(loadFixtureConfig({ model, contextSize: 8192, maxTokens: 512 }))
  expect(explicit.maxTokens).toBe(512)
  const selected = await Effect.runPromise(loadFixtureConfig({ model }, { GLOSSSHIFT_MODEL: 'plamo-3-translate-2b' }))
  expect(selected.contextSize).toBe(262144)
})

test('recognized artifact digests retain model defaults even with a local file URI', async () => {
  for (const preset of Record.values(modelPresets)) {
    const model = { ...preset.model, uri: 'file:///synthetic/known.gguf', sha256: preset.model.sha256.toUpperCase() }
    const defaults = await Effect.runPromise(loadFixtureConfig({ model }))
    expect(defaults.model.uri).toBe(model.uri)
    expect(defaults.contextSize).toBe(preset.contextSize)
    expect(defaults.maxTokens).toBe(preset.contextSize)
    const smaller = await Effect.runPromise(loadFixtureConfig({ model, contextSize: 8192 }))
    expect(smaller.maxTokens).toBe(8192)
  }
})

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
    { ...config, maxTokens: config.contextSize + 1 },
    { ...config, contextSize: 262145 },
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

test('generation uses all remaining model context and rejects only a full prompt', async () => {
  const original = globalThis.fetch
  const source = 'Synthetic source'
  let sourceTokens = 1
  let predictions = 0
  let completions = 0
  const CompletionRequest = Schema.Struct({ n_predict: Schema.Int, prompt: Schema.Unknown })
  globalThis.fetch = async (url, init) => {
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (String(url).endsWith('/completion')) {
      const request = Schema.decodeUnknownSync(CompletionRequest)(raw)
      predictions = request.n_predict
      completions += 1
      expect(Array.isArray(request.prompt) && request.prompt.length).toBe(sourceTokens + 3)
      return new Response('data: {"content":"translated","stop":true,"stop_type":"eos"}\n\n')
    }
    const request = Schema.decodeUnknownSync(TokenRequest)(raw)
    return new Response(
      JSON.stringify({
        tokens:
          request.content === source
            ? Array.makeBy(sourceTokens, () => 3)
            : [request.content === '<|plamo:bos|>' ? 1 : 2],
      }),
    )
  }
  try {
    const full = await Effect.runPromise(loadFixtureConfig())
    const prompt = await Effect.runPromise(makePrompt({ text: source, targetLanguage: 'ja' }, full))
    for (const count of [1, 140000, 262140]) {
      sourceTokens = count
      const output = await Effect.runPromise(generate(server, full, prompt).pipe(Stream.runCollect))
      expect(Array.join(output, '')).toBe('translated')
      expect(predictions).toBe(full.contextSize - count - 3)
    }
    expect(completions).toBe(3)
    for (const count of [262141, 262142]) {
      sourceTokens = count
      const result = await Effect.runPromise(generate(server, full, prompt).pipe(Stream.runDrain, Effect.result))
      expect(result._tag === 'Failure' && result.failure.code === 'ContextTooLong').toBe(true)
    }
    expect(completions).toBe(3)
    sourceTokens = 1
    await Effect.runPromise(generate(server, config, prompt).pipe(Stream.runDrain))
    expect(predictions).toBe(config.maxTokens)
  } finally {
    globalThis.fetch = original
  }
})

test('chunked token validation rejects invalid tokens beyond the first batch', async () => {
  const original = globalThis.fetch
  try {
    for (const invalid of [-1, 1.5, '3', null]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ tokens: [...Array.makeBy(1024, () => 3), invalid] }))
      const result = await Effect.runPromise(tokenize(server, 'Synthetic source', false).pipe(Effect.result))
      expect(result._tag === 'Failure' && result.failure.code === 'InferenceFailed').toBe(true)
    }
  } finally {
    globalThis.fetch = original
  }
})

test('SSE rejects both context truncation and exhausted prediction budgets', async () => {
  const original = globalThis.fetch
  try {
    for (const frame of [
      { content: '', stop: true, stop_type: 'eos', truncated: true },
      { content: '', stop: true, stop_type: 'limit', truncated: false },
    ]) {
      globalThis.fetch = async () => new Response(`data: ${JSON.stringify(frame)}\n\n`)
      const result = await Effect.runPromise(
        Effect.tryPromise({
          try: async () => {
            for await (const _delta of completion(server, [1], 1, [], new AbortController().signal)) {
              /* consume */
            }
          },
          catch: (error) => error,
        }).pipe(Effect.result),
      )
      expect(
        result._tag === 'Failure' &&
          result.failure instanceof TranslationError &&
          result.failure.code === 'OutputTooLong',
      ).toBe(true)
    }
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
