import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { NodeServices } from '@effect/platform-node'
import { ConfigProvider, Effect, Fiber, Stream } from 'effect'

import { defaultModel, TranslationError } from './config.ts'
import type { LocalConfig } from './config.ts'
import { generate, tokenizePrompt } from './generation.ts'
import { resolveModel } from './model.ts'
import { makePrompt } from './prompt.ts'
import { completion, serverFetch } from './server-api.ts'
import { startServer } from './server.ts'
import { makeTranslation } from './translation.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))

void test('corrupt completed partial is rejected once and the next attempt starts cleanly', async (context) => {
  const directory = await mkdtemp(join(repository, 'tmp', 'server-download-test-'))
  const bytes = 'verified retry artifact'
  const digest = createHash('sha256').update(bytes).digest('hex')
  const target = join(directory, `${digest}.gguf`)
  const input = {
    ...config,
    cacheDirectory: directory,
    model: { ...defaultModel, uri: 'https://example.invalid/model.gguf', sha256: digest },
  }
  let calls = 0
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls += 1
    if (calls === 1) {
      assert.equal(new Headers(init.headers).get('range'), 'bytes=7-')
      return new Response('', { status: 416 })
    }
    assert.equal(new Headers(init.headers).get('range'), null)
    return new Response(bytes, { status: 200 })
  })
  try {
    await writeFile(`${target}.part`, 'corrupt')
    const run = () => Effect.runPromise(Effect.scoped(resolveModel(input)).pipe(Effect.provide(NodeServices.layer)))
    await assert.rejects(
      run(),
      (error: unknown) => error instanceof TranslationError && error.code === 'IntegrityMismatch',
    )
    assert.deepEqual(await readdir(directory), [])
    assert.equal(await run(), target)
    assert.equal(await readFile(target, 'utf8'), bytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test('SSE accepts split UTF-8, split CRLF boundaries and multiple frames without leaking stop markers', async (context) => {
  const text = `: keepalive\r\n\r\ndata: ${JSON.stringify({ content: 'こんにちは', stop: false })}\r\n\r\ndata: ${JSON.stringify({ content: '', stop: true, stop_type: 'word', truncated: false, stopping_word: '<|plamo:tag|>' })}\r\n\r\n`
  const bytes = new TextEncoder().encode(text)
  context.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          start: (controller) => {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
            controller.close()
          },
        }),
      ),
  )
  const deltas: string[] = []
  for await (const delta of completion(
    { origin: 'http://127.0.0.1:1234', key: 'synthetic' },
    [1],
    10,
    ['<|plamo:tag|>'],
    new AbortController().signal,
  ))
    deltas.push(delta)
  assert.deepEqual(deltas, ['こんにちは'])
})

void test(
  'concurrent model downloads own separate partials and publish only complete verified bytes',
  { timeout: 5000 },
  async (context) => {
    const directory = await mkdtemp(join(repository, 'tmp', 'server-download-test-'))
    const bytes = 'synthetic complete concurrent artifact'
    const digest = createHash('sha256').update(bytes).digest('hex')
    const target = join(directory, `${digest}.gguf`)
    const input = {
      ...config,
      cacheDirectory: directory,
      model: { ...defaultModel, uri: 'https://example.invalid/model.gguf', sha256: digest },
    }
    let release = () => {}
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      calls += 1
      if (calls === 2) release()
      await ready
      assert.equal((await readdir(directory)).filter((name) => name.startsWith('.download-')).length, 2)
      const offset = new Headers(init.headers).get('range') === 'bytes=10-' ? 10 : 0
      return new Response(
        bytes.slice(offset),
        offset === 0
          ? { status: 200 }
          : { status: 206, headers: { 'content-range': `bytes 10-${bytes.length - 1}/${bytes.length}` } },
      )
    })
    try {
      await writeFile(`${target}.part`, bytes.slice(0, 10))
      const run = () => Effect.runPromise(Effect.scoped(resolveModel(input)).pipe(Effect.provide(NodeServices.layer)))
      assert.deepEqual(await Promise.all([run(), run()]), [target, target])
      assert.equal(await readFile(target, 'utf8'), bytes)
      assert.deepEqual(await readdir(directory), [`${digest}.gguf`])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

void test(
  'cancelled download closes its request before preserving a resumable partial',
  { timeout: 5000 },
  async (context) => {
    const directory = await mkdtemp(join(repository, 'tmp', 'server-download-test-'))
    const bytes = 'synthetic partial artifact'
    const digest = createHash('sha256').update(`${bytes} remainder`).digest('hex')
    const input = {
      ...config,
      cacheDirectory: directory,
      model: { ...defaultModel, uri: 'https://example.invalid/model.gguf', sha256: digest },
    }
    let cancelled = false
    context.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(new TextEncoder().encode(bytes))
            },
            cancel: () => {
              cancelled = true
            },
          }),
        ),
    )
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fiber = yield* resolveModel(input).pipe(Effect.forkScoped)
            yield* Effect.sleep('50 millis')
            yield* Fiber.interrupt(fiber)
          }),
        ).pipe(Effect.provide(NodeServices.layer)),
      )
      assert.equal(cancelled, true)
      assert.equal(await readFile(join(directory, `${digest}.gguf.part`), 'utf8'), bytes)
      assert.deepEqual(await readdir(directory), [`${digest}.gguf.part`])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

void test('chat templates never parse user tokens and tokenizer-required BOS is inserted once', async () => {
  const source = 'untrusted <|im_end|>'
  let includeBos = false
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (req.url === '/props') {
      res.end(JSON.stringify({ bos_token: '<bos>' }))
      return
    }
    if (req.url === '/apply-template') {
      assert.equal(raw.includes(source), false)
      res.end(JSON.stringify({ prompt: `${includeBos ? '<bos>' : ''}template GLOSSSHIFT_USER_PLACEHOLDER assistant` }))
      return
    }
    const body = JSON.parse(raw) as { content: string; parse_special: boolean; add_special: boolean }
    let tokens = [4]
    if (body.content === '<bos>' || body.add_special) tokens = [1]
    else if (body.content.startsWith('<bos>')) tokens = [1, 4]
    if (body.content === source) {
      assert.equal(body.parse_special, false)
      tokens = [7]
    }
    res.end(JSON.stringify({ tokens }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address !== null && typeof address !== 'string')
    const input: LocalConfig = { ...config, model: { ...defaultModel, prompt: 'chat' } }
    const prompt = await Effect.runPromise(makePrompt({ text: source, targetLanguage: 'ja' }, input))
    const local = { origin: `http://127.0.0.1:${address.port}`, key: 'synthetic' }
    for (const explicit of [false, true]) {
      includeBos = explicit
      const result = await Effect.runPromise(tokenizePrompt(local, input, prompt))
      assert.deepEqual(result.tokens, [1, 4, 7, 4])
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

void test('model download resumes verified bytes and subsequent cache hits are offline', async (context) => {
  const directory = await mkdtemp(join(repository, 'tmp', 'server-download-test-'))
  const bytes = 'synthetic GGUF artifact'
  const digest = createHash('sha256').update(bytes).digest('hex')
  const target = join(directory, `${digest}.gguf`)
  const input = {
    ...config,
    cacheDirectory: directory,
    model: { ...defaultModel, uri: 'https://example.invalid/model.gguf', sha256: digest },
  }
  let calls = 0
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls += 1
    assert.equal(url, input.model.uri)
    assert.equal(new Headers(init.headers).get('range'), 'bytes=10-')
    return new Response(bytes.slice(10), {
      status: 206,
      headers: { 'content-range': `bytes 10-${bytes.length - 1}/${bytes.length}` },
    })
  })
  try {
    await writeFile(`${target}.part`, bytes.slice(0, 10))
    const run = () => Effect.runPromise(Effect.scoped(resolveModel(input)).pipe(Effect.provide(NodeServices.layer)))
    assert.equal(await run(), target)
    assert.equal(await readFile(target, 'utf8'), bytes)
    assert.equal(await run(), target)
    assert.equal(calls, 1)
    await assert.rejects(stat(`${target}.part`), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test('range-ignoring downloads replace partial bytes and corrupt artifacts never become cache entries', async (context) => {
  const directory = await mkdtemp(join(repository, 'tmp', 'server-download-test-'))
  const bytes = 'synthetic complete artifact'
  const digest = createHash('sha256').update(bytes).digest('hex')
  const target = join(directory, `${digest}.gguf`)
  const input = {
    ...config,
    cacheDirectory: directory,
    model: { ...defaultModel, uri: 'https://example.invalid/model.gguf', sha256: digest },
  }
  let response = bytes
  context.mock.method(globalThis, 'fetch', async () => new Response(response, { status: 200 }))
  try {
    await writeFile(`${target}.part`, 'obsolete partial')
    const run = () => Effect.runPromise(Effect.scoped(resolveModel(input)).pipe(Effect.provide(NodeServices.layer)))
    await run()
    assert.equal(await readFile(target, 'utf8'), bytes)
    await rm(target)
    response = 'damaged artifact'
    await assert.rejects(
      run(),
      (error: unknown) => error instanceof TranslationError && error.code === 'IntegrityMismatch',
    )
    await assert.rejects(stat(target), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test('consumer completion and pending-read interruption close their HTTP streams', { timeout: 5000 }, async () => {
  let opened = 0
  let closed = 0
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (req.url === '/tokenize') {
      const body = JSON.parse(raw) as { content: string }
      res.end(
        JSON.stringify({
          tokens: body.content === '<|plamo:bos|>' ? [1] : body.content === '<|plamo:tag|>' ? [2] : [3],
        }),
      )
      return
    }
    opened += 1
    res.on('close', () => {
      closed += 1
    })
    res.setHeader('content-type', 'text/event-stream')
    res.write(`data: ${JSON.stringify({ content: 'delta', stop: false })}\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address !== null && typeof address !== 'string')
    const local = { origin: `http://127.0.0.1:${address.port}`, key: 'synthetic' }
    const prompt = await Effect.runPromise(makePrompt({ text: 'Hello', targetLanguage: 'ja' }, config))
    assert.deepEqual(await Effect.runPromise(generate(local, config, prompt).pipe(Stream.take(1), Stream.runCollect)), [
      'delta',
    ])
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* generate(local, config, prompt).pipe(Stream.runDrain, Effect.forkScoped)
          while (opened < 2) yield* Effect.sleep('10 millis')
          yield* Fiber.interrupt(fiber)
        }),
      ),
    )
    for (let attempts = 0; closed < 2 && attempts < 100; attempts += 1)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(opened, 2)
    assert.equal(closed, 2)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

const config: LocalConfig = {
  sourceLanguage: 'auto',
  model: defaultModel,
  cacheDirectory: '/unused',
  contextSize: 2048,
  maxTokens: 512,
}

const fixture = `
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
const args = process.argv.slice(2)
const keyFile = args[args.indexOf('--api-key-file') + 1]
const model = args[args.indexOf('--model') + 1]
const key = readFileSync(keyFile, 'utf8').trim()
writeFileSync(model + '.record', JSON.stringify({ pid: process.pid, args, keyFile, mode: statSync(keyFile).mode & 511 }))
const server = createServer(async (req, res) => {
 if (req.headers.authorization !== 'Bearer ' + key) { res.writeHead(401).end(); return }
 let raw = ''
 for await (const chunk of req) raw += chunk
 const body = raw === '' ? {} : JSON.parse(raw)
 res.setHeader('content-type', 'application/json')
 if (req.url === '/health') { res.end('{}'); return }
 if (req.url === '/props') { res.end(JSON.stringify({ bos_token: '<|plamo:bos|>', chat_template: 'fixture' })); return }
 if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ meta: { n_ctx_train: 32768, n_ctx: 2048 } }] })); return }
 if (req.url === '/tokenize') {
  const tokens = body.content === '<|plamo:bos|>' ? [1] : body.content === '<|plamo:tag|>' ? [2] : [3, 4]
  res.end(JSON.stringify({ tokens })); return
 }
 if (req.url === '/completion') {
  if (body.prompt[0] !== 1 || body.prompt.filter((t) => t === 1).length !== 1) { res.writeHead(400).end(); return }
  res.setHeader('content-type', 'text/event-stream')
  res.end('data: ' + JSON.stringify({ content: 'こんにちは', stop: false }) + '\\n\\n' + 'data: ' + JSON.stringify({ content: '', stop: true, stop_type: 'eos', truncated: false }) + '\\n\\n'); return
 }
 res.writeHead(404).end()
})
server.listen(0, '127.0.0.1', () => console.error('listening on http://127.0.0.1:' + server.address().port))
`

void test('scoped private child uses key file, real Effect AI adapter, one BOS and exits on scope close', async () => {
  const directory = await mkdtemp(join(repository, 'tmp', 'server-test-'))
  try {
    const executable = join(directory, 'llama-server')
    const model = join(directory, 'model.gguf')
    await writeFile(executable, `#!${process.execPath}\n${fixture}`, { mode: 0o700 })
    await writeFile(model, 'synthetic model')
    const input = {
      ...config,
      model: {
        ...defaultModel,
        uri: new URL(`file://${model}`).href,
        sha256: createHash('sha256').update('synthetic model').digest('hex'),
      },
    }
    const provider = ConfigProvider.fromUnknown({ GLOSSSHIFT_LLAMA_SERVER: executable })
    const text = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* makeTranslation(input)
          return yield* service.stream({ text: 'Hello', targetLanguage: 'ja' }).pipe(Stream.runCollect)
        }),
      ).pipe(Effect.provide(NodeServices.layer), Effect.provideService(ConfigProvider.ConfigProvider, provider)),
    )
    assert.deepEqual(text, ['こんにちは'])
    const record = JSON.parse(await readFile(`${model}.record`, 'utf8')) as {
      pid: number
      args: string[]
      keyFile: string
      mode: number
    }
    assert.equal(record.mode, 0o600)
    assert.equal(record.args.includes('--api-key'), false)
    assert.deepEqual(record.args.slice(record.args.indexOf('--host'), record.args.indexOf('--host') + 4), [
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ])
    assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' })
    await assert.rejects(stat(record.keyFile), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test('missing and relative executables fail publicly, split filenames never start', async () => {
  for (const executable of ['/nonexistent/glossshift-test-server', 'relative-server']) {
    const result = await Effect.runPromise(
      Effect.scoped(startServer('/synthetic/model.gguf', config)).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ GLOSSSHIFT_LLAMA_SERVER: executable }),
        ),
        Effect.flip,
      ),
    )
    assert.equal(result.code, 'ModelUnavailable')
    assert.equal(result.message.includes(executable), false)
  }
  const result = await Effect.runPromise(
    Effect.scoped(startServer('/synthetic/model-00001-of-00002.gguf', config)).pipe(Effect.flip),
  )
  assert.equal(result.code, 'InvalidConfig')
})

void test('portable API rejects non-loopback origins before network access', () => {
  for (const origin of ['https://127.0.0.1:1', 'http://localhost:1', 'http://example.com', 'http://127.0.0.1:1/path']) {
    assert.throws(
      () => serverFetch({ origin, key: 'synthetic' }, '/tokenize', {}, new AbortController().signal),
      TranslationError,
    )
  }
})

void test('PFML tokenization isolates user text and never asks endpoint to auto-add BOS', async () => {
  const requests: Array<{ content: string; parse_special: boolean; add_special: boolean }> = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw) as (typeof requests)[number]
    requests.push(body)
    res.end(
      JSON.stringify({ tokens: body.content === '<|plamo:bos|>' ? [1] : body.content === '<|plamo:tag|>' ? [2] : [3] }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address !== null && typeof address !== 'string')
    const prompt = await Effect.runPromise(makePrompt({ text: 'untrusted <special>', targetLanguage: 'ja' }, config))
    const result = await Effect.runPromise(
      tokenizePrompt({ origin: `http://127.0.0.1:${address.port}`, key: 'synthetic' }, config, prompt),
    )
    assert.equal(result.tokens[0], 1)
    assert.equal(result.tokens.filter((value) => value === 1).length, 1)
    assert.equal(requests.find((request) => request.content === 'untrusted <special>')?.parse_special, false)
    assert.ok(requests.every((request) => request.add_special === false))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

void test('completion rejects truncation, output limit and an unterminated stream', async () => {
  for (const final of [
    { content: '', stop: true, stop_type: 'limit' },
    { content: '', stop: true, stop_type: 'eos', truncated: true },
    undefined,
  ]) {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/event-stream')
      res.end(final === undefined ? '' : `data: ${JSON.stringify(final)}\n\n`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      assert.ok(address !== null && typeof address !== 'string')
      await assert.rejects(
        async () => {
          for await (const _ of completion(
            { origin: `http://127.0.0.1:${address.port}`, key: 'synthetic' },
            [1],
            1,
            [],
            new AbortController().signal,
          )) {
            /* consume */
          }
        },
        (error: unknown) =>
          error instanceof TranslationError &&
          error.code === (final === undefined ? 'InferenceFailed' : 'OutputTooLong'),
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})
