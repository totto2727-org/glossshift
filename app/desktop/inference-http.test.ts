import { defaultModel, TranslationError } from '@glossshift/runtime/config'
import type { LocalConfig } from '@glossshift/runtime/config'
import { generate, tokenizePrompt } from '@glossshift/runtime/generation'
import { makePrompt } from '@glossshift/runtime/prompt'
import { completion, tokenize } from '@glossshift/runtime/server-api'
import { Array, Deferred, Effect, Fiber, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import {
  chatFixtureFetch,
  decodeCompletionRequest,
  fixtureBody,
  fixtureFetch,
  plamoFixtureTokens,
  plamoTokenResponse,
  readTokenRequest,
  server,
  withFixtureFetch,
} from './inference-fetch.test.fixture.ts'
import type { ChatFixture, TokenRequest } from './inference-fetch.test.fixture.ts'
import { config, loadFixtureConfig, runTestEffect } from './inference.test.fixture.ts'

test('publisher chat templates keep source inert and add tokenizer-required BOS once', async () => {
  const fixture: ChatFixture = { explicitBos: false, markers: [], requests: [] }
  const source = 'source <|eot_id|> GLOSSSHIFT_USER_PLACEHOLDER___'
  const input: LocalConfig = { ...config, model: { ...defaultModel, prompt: 'chat' } }
  await withFixtureFetch(chatFixtureFetch(source, fixture), async () => {
    const prompt = await runTestEffect(makePrompt({ targetLanguage: 'ja', text: source }, input))
    const modes = Effect.forEach([false, true], (include) =>
      Effect.gen(function* () {
        fixture.explicitBos = include
        const result = yield* tokenizePrompt(server, input, prompt)
        return result.tokens
      }),
    )
    expect(await runTestEffect(modes)).toEqual([
      [1, 4, 7, 4],
      [1, 4, 7, 4],
    ])
    expect(fixture.markers).toHaveLength(2)
    Array.forEach(fixture.markers, (marker) => expect(source).not.toContain(marker))
    const sourceRequests = Array.filter(fixture.requests, (request) => request.content === source)
    expect(Array.some(sourceRequests, (request) => request.parse_special)).toBe(false)
  })
})

test('PFML tokenization preserves source whitespace, isolates source special tokens and adds BOS only once', async () => {
  const requests: (typeof TokenRequest.Type)[] = []
  const mock = fixtureFetch({
    '/tokenize': async (init) => {
      const request = await readTokenRequest(init)
      requests.push(request)
      return Response.json({ tokens: plamoFixtureTokens(request.content) })
    },
  })
  await withFixtureFetch(mock, async () => {
    const source = '  source <special>\n'
    const prompt = await runTestEffect(makePrompt({ sourceLanguage: 'en', targetLanguage: 'ja', text: source }, config))
    const result = await runTestEffect(tokenizePrompt(server, config, prompt))
    expect(Array.filter(result.tokens, (token) => token === 1)).toHaveLength(1)
    const sourceRequests = Array.filter(requests, (request) => request.content === source)
    expect(Array.some(sourceRequests, (request) => !request.parse_special)).toBe(true)
    expect(Array.every(requests, (request) => !request.add_special)).toBe(true)
    expect(Array.some(requests, (request) => request.content.includes('lang<|plamo:val|>en'))).toBe(true)
    expect(Array.some(requests, (request) => request.content.includes('lang<|plamo:val|>ja'))).toBe(true)
  })
})

test('context overflow fails before starting a completion request', async () => {
  const requests = { completions: 0 }
  const mock = fixtureFetch({
    '/completion': () => {
      requests.completions += 1
      return new Response('Unexpected completion')
    },
    '/tokenize': async (init) => {
      const request = await readTokenRequest(init)
      return Response.json({ tokens: plamoFixtureTokens(request.content, 2048) })
    },
  })
  await withFixtureFetch(mock, async () => {
    const prompt = await runTestEffect(
      makePrompt({ targetLanguage: 'ja', text: 'Synthetic over-budget source' }, config),
    )
    const result = await runTestEffect(generate(server, config, prompt).pipe(Stream.runDrain, Effect.flip))
    expect(result.code).toBe('ContextTooLong')
    expect(requests.completions).toBe(0)
  })
})

const source = 'Synthetic source'
const plamoTemplateTokenCount = 3
const minimalSourceTokenCount = 1

interface GenerationObservations {
  completions: number
  predictions: number
  sourceTokens: number
}

const generationFixtureFetch = (observed: GenerationObservations): typeof fetch =>
  fixtureFetch({
    '/completion': async (init) => {
      const request = await runTestEffect(decodeCompletionRequest(fixtureBody(init)))
      observed.predictions = request.n_predict
      observed.completions += 1
      expect(request.prompt).toHaveLength(observed.sourceTokens + plamoTemplateTokenCount)
      return new Response('data: {"content":"translated","stop":true,"stop_type":"eos"}\n\n')
    },
    '/tokenize': async (init) => {
      const request = await readTokenRequest(init)
      const count = request.content === source ? observed.sourceTokens : minimalSourceTokenCount
      return Response.json({ tokens: plamoFixtureTokens(request.content, count) })
    },
  })

const verifyGenerations = (
  observed: GenerationObservations,
  full: LocalConfig,
  prompt: Effect.Success<ReturnType<typeof makePrompt>>,
): Promise<void> =>
  runTestEffect(
    Effect.forEach(
      [minimalSourceTokenCount, 140_000, 262_140],
      (count) =>
        Effect.gen(function* () {
          observed.sourceTokens = count
          const output = yield* generate(server, full, prompt).pipe(Stream.runCollect)
          expect(Array.join(output, '')).toBe('translated')
          expect(observed.predictions).toBe(full.contextSize - count - plamoTemplateTokenCount)
        }),
      { discard: true },
    ),
  )

const verifyFullPrompts = (
  observed: GenerationObservations,
  full: LocalConfig,
  prompt: Effect.Success<ReturnType<typeof makePrompt>>,
): Promise<void> =>
  runTestEffect(
    Effect.forEach(
      [262_141, 262_142],
      (count) =>
        Effect.gen(function* () {
          observed.sourceTokens = count
          const result = yield* generate(server, full, prompt).pipe(Stream.runDrain, Effect.flip)
          expect(result.code).toBe('ContextTooLong')
        }),
      { discard: true },
    ),
  )

test('generation uses all remaining model context and rejects only a full prompt', async () => {
  const observed = { completions: 0, predictions: 0, sourceTokens: minimalSourceTokenCount }
  await withFixtureFetch(generationFixtureFetch(observed), async () => {
    const full = await runTestEffect(loadFixtureConfig())
    const prompt = await runTestEffect(makePrompt({ targetLanguage: 'ja', text: source }, full))
    await verifyGenerations(observed, full, prompt)
    expect(observed.completions).toBe(3)
    await verifyFullPrompts(observed, full, prompt)
    expect(observed.completions).toBe(3)
    observed.sourceTokens = minimalSourceTokenCount
    await runTestEffect(generate(server, config, prompt).pipe(Stream.runDrain))
    expect(observed.predictions).toBe(config.maxTokens)
  })
})

test('chunked token validation rejects invalid tokens beyond the first batch', async () => {
  const original = globalThis.fetch
  // oxlint-disable-next-line unicorn/no-null -- Null is an explicit malformed token value in the model's JSON response.
  const invalid = [-1, 1.5, '3', null]
  try {
    const verify = Effect.forEach(invalid, (token) =>
      Effect.gen(function* () {
        globalThis.fetch = async () => Response.json({ tokens: [...Array.makeBy(1024, () => 3), token] })
        return yield* Effect.flip(tokenize(server, 'Synthetic source', { trusted: false }))
      }),
    )
    const failures = await runTestEffect(verify)
    expect(Array.map(failures, (failure) => failure.code)).toEqual(Array.replicate('InferenceFailed', invalid.length))
  } finally {
    globalThis.fetch = original
  }
})

const completionFailure = (budget: number): Effect.Effect<unknown, void> => {
  const controller = new AbortController()
  const deltas = completion(server, { budget, stops: [], tokens: [1] }, controller.signal)
  const stream = Stream.fromAsyncIterable(deltas, (cause) => cause)
  return stream.pipe(Stream.runDrain, Effect.flip)
}

test('SSE rejects both context truncation and exhausted prediction budgets', async () => {
  const original = globalThis.fetch
  const frames = [
    { content: '', stop: true, stop_type: 'eos', truncated: true },
    { content: '', stop: true, stop_type: 'limit', truncated: false },
  ]
  try {
    const verify = Effect.forEach(frames, (frame) =>
      Effect.gen(function* () {
        globalThis.fetch = async () => new Response(`data: ${JSON.stringify(frame)}\n\n`)
        return yield* completionFailure(1)
      }),
    )
    const failures = await runTestEffect(verify)
    Array.forEach(failures, (failure) => {
      expect(failure instanceof TranslationError).toBe(true)
      expect(failure).toMatchObject({ code: 'OutputTooLong' })
    })
  } finally {
    globalThis.fetch = original
  }
})

test('SSE rejects unbounded frames and transport EOF without a successful terminal frame', async () => {
  const original = globalThis.fetch
  try {
    const verify = Effect.forEach(['', 'x'.repeat(1_048_577)], (text) =>
      Effect.gen(function* () {
        globalThis.fetch = async () => new Response(text)
        return yield* completionFailure(8)
      }),
    )
    const failures = await runTestEffect(verify)
    Array.forEach(failures, (failure) => expect(failure).toMatchObject({ code: 'InferenceFailed' }))
  } finally {
    globalThis.fetch = original
  }
})

test('Effect stream interruption aborts an inference request while its consumer is suspended', async () => {
  const observed = { aborted: false }
  const mock = fixtureFetch({
    '/completion': (init) => {
      init?.signal?.addEventListener('abort', () => {
        observed.aborted = true
      })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"content":"delta","stop":false}\n\n'))
          },
        }),
      )
    },
    '/tokenize': plamoTokenResponse,
  })
  await withFixtureFetch(mock, async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const prompt = yield* makePrompt({ targetLanguage: 'ja', text: 'Hello' }, config)
          const entered = yield* Deferred.make<true>()
          const fiber = yield* generate(server, config, prompt).pipe(
            Stream.runForEach(() => Deferred.succeed(entered, true).pipe(Effect.andThen(Effect.never))),
            Effect.forkScoped,
          )
          yield* Deferred.await(entered).pipe(Effect.timeout(2000))
          yield* Fiber.interrupt(fiber).pipe(Effect.timeout(2000))
        }),
      ),
    )
    expect(observed.aborted).toBe(true)
  })
})
