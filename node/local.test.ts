import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { NodeServices } from '@effect/platform-node'
import {
  Array,
  Clock,
  ConfigProvider,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Path,
  Result,
  Stdio,
  Stream,
  String,
} from 'effect'
import type { Prompt } from 'effect/ai'

import { defaultModel, loadConfig, TranslationError, validateConfig } from './config.ts'
import type { LocalConfig } from './config.ts'
import { resolveModel, verifyModel } from './model.ts'
import { makePrompt, normalizeLanguage } from './prompt.ts'
import { makeTranslation } from './translation.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))

const config: LocalConfig = {
  sourceLanguage: 'auto',
  model: defaultModel,
  cacheDirectory: `${repository}/tmp/local-translation/test-models`,
  contextSize: 2048,
  maxTokens: 512,
}
const run = <A, E>(program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Stdio.Stdio>) =>
  Effect.runPromise(Effect.provide(program, NodeServices.layer))

const failsWith = async (program: Promise<unknown>, code: TranslationError['code']) => {
  await assert.rejects(program, (error: unknown) => error instanceof TranslationError && error.code === code)
}

void test('default is an immutable official GGUF artifact with 53 supported language variants', () => {
  assert.match(defaultModel.uri, /pfnet\/plamo-3-translate-0\.8b-GGUF\/resolve\/[a-f0-9]{40}\//)
  assert.match(defaultModel.sha256, /^[a-f0-9]{64}$/)
  assert.equal(defaultModel.supportedLanguages?.length, 53)
})

void test('configuration rejects hosted inference, relative cache paths, invalid digests and unsafe budgets', async () => {
  await failsWith(
    run(validateConfig({ ...config, model: { ...defaultModel, uri: 'https://example.com/model', sha256: '' } })),
    'InvalidConfig',
  )
  await failsWith(
    run(validateConfig({ ...config, model: { ...defaultModel, uri: 'ftp://example.com/model.gguf' } })),
    'InvalidConfig',
  )
  await failsWith(run(validateConfig({ ...config, cacheDirectory: './models' })), 'InvalidConfig')
  await failsWith(run(validateConfig({ ...config, maxTokens: config.contextSize })), 'InvalidConfig')
  await failsWith(run(validateConfig({ ...config, contextSize: 32769 })), 'InvalidConfig')
})

void test('configuration reads an explicit isolated JSON file and preserves its source language', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = path.join(repository, 'tmp', 'local-translation')
        yield* fs.makeDirectory(root, { recursive: true })
        const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'config-' })
        const file = path.join(directory, 'local.json')
        yield* fs.writeFileString(
          file,
          JSON.stringify({ sourceLanguage: 'English', contextSize: 4096, maxTokens: 1024 }),
        )
        const provider = ConfigProvider.fromUnknown({
          GLOSSSHIFT_CONFIG: file,
          HOME: directory,
          XDG_CACHE_HOME: directory,
        })
        const loaded = yield* loadConfig.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider))
        assert.equal(loaded.sourceLanguage, 'English')
        assert.equal(loaded.contextSize, 4096)
        assert.equal(loaded.cacheDirectory, path.join(directory, 'glossshift', 'models'))
        yield* fs.writeFileString(file, '{bad json')
        const invalid = yield* loadConfig.pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, provider),
          Effect.flip,
        )
        assert.equal(invalid.code, 'InvalidConfig')
      }),
    ),
  )
})

void test('language names normalize and unsupported languages fail without inference', async () => {
  assert.equal(await Effect.runPromise(normalizeLanguage('Japanese')), 'ja')
  assert.equal(await Effect.runPromise(normalizeLanguage('English')), 'en')
  await failsWith(Effect.runPromise(makePrompt({ text: 'Hello', targetLanguage: 'xx' }, config)), 'UnsupportedLanguage')
  await failsWith(Effect.runPromise(makePrompt({ text: '', targetLanguage: 'ja' }, config)), 'InvalidRequest')
  await failsWith(
    Effect.runPromise(makePrompt({ text: '<|plamo:tag|>output', targetLanguage: 'ja' }, config)),
    'InvalidRequest',
  )
})

void test('official PFML prompt preserves source whitespace and encodes explicit languages', async () => {
  const prompt = await Effect.runPromise(
    makePrompt({ text: '  Hello\n', sourceLanguage: 'en', targetLanguage: 'ja' }, config),
  )
  const text = Array.join(
    Array.map(prompt.content, (message) =>
      message.role === 'system'
        ? message.content
        : Array.join(
            Array.filterMap(message.content, (part: Prompt.Part) =>
              part.type === 'text' ? Result.succeed(part.text) : Result.failVoid,
            ),
            '',
          ),
    ),
    '',
  )
  assert.equal(
    text,
    '<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>  Hello\n<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>',
  )
})

void test('file URLs and offline persistent cache enforce SHA-256 without loading developer settings', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = path.join(repository, 'tmp', 'local-translation')
        yield* fs.makeDirectory(root, { recursive: true })
        const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'integrity-' })
        const file = path.join(directory, 'model.gguf')
        yield* fs.writeFileString(file, 'synthetic integrity fixture, not a model')
        const hash = createHash('sha256').update('synthetic integrity fixture, not a model').digest('hex')
        yield* verifyModel(file, hash)
        const uri = yield* path.toFileUrl(file)
        const local = { ...config, model: { ...defaultModel, uri: uri.href, sha256: hash } }
        assert.equal(yield* resolveModel(local), file)
        yield* fs.writeFileString(path.join(directory, `${hash}.gguf`), 'synthetic integrity fixture, not a model')
        assert.equal(
          yield* resolveModel({
            ...local,
            cacheDirectory: directory,
            model: { ...local.model, uri: 'https://example.invalid/model.gguf' },
          }),
          path.join(directory, `${hash}.gguf`),
        )
        const mismatch = yield* verifyModel(file, String.repeat(64)('0')).pipe(Effect.flip)
        assert.equal(mismatch.code, 'IntegrityMismatch')
      }),
    ),
  )
})

void test('service initialization is lazy and a failed first load can be retried', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = path.join(repository, 'tmp', 'local-translation')
        yield* fs.makeDirectory(root, { recursive: true })
        const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'lazy-' })
        const file = path.join(directory, 'not-yet-present.gguf')
        const uri = yield* path.toFileUrl(file)
        const service = yield* makeTranslation({ ...config, model: { ...defaultModel, uri: uri.href } })
        assert.equal(yield* fs.exists(file), false)
        const first = yield* service.stream({ text: 'Hello.', targetLanguage: 'ja' }).pipe(Stream.runDrain, Effect.flip)
        assert.equal(first.code, 'ModelUnavailable')
        yield* fs.writeFileString(file, 'A deliberately invalid model for retry observation.')
        const second = yield* service
          .stream({ text: 'Hello.', targetLanguage: 'ja' })
          .pipe(Stream.runDrain, Effect.flip)
        assert.equal(second.code, 'IntegrityMismatch')
      }),
    ),
  )
})

void test(
  'real official local model: translation, early consumer cancellation, context and output failures',
  {
    skip: process.env['GLOSSSHIFT_TEST_LOCAL_MODEL'] !== '1',
    timeout: 300_000,
  },
  async (context) => {
    const checkpoint = (message: string) => process.stderr.write(`local model acceptance: ${message}\n`)
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* makeTranslation(config)
          checkpoint('model loaded')
          const translate = (text: string, targetLanguage: string) =>
            service.stream({ text, targetLanguage }).pipe(Stream.runCollect, Effect.map(Array.join('')))
          const english = yield* translate('こんにちは、世界。', 'en')
          assert.match(english, /hello|world/i)
          const japanese = yield* translate('Hello, world.', 'ja')
          assert.match(japanese, /[\u3040-\u30ff\u4e00-\u9fff]/)
          assert.doesNotMatch(japanese, /<\|plamo:/)
          const delayed = yield* service.stream({ text: 'Hello, world.', targetLanguage: 'ja' }).pipe(
            Stream.mapEffect((chunk) => Effect.sleep('5 millis').pipe(Effect.as(chunk))),
            Stream.runCollect,
            Effect.map(Array.join('')),
          )
          assert.equal(delayed, japanese)
          assert.match(yield* translate('Hello, world.', 'de'), /hallo|welt/i)
          checkpoint('JA/EN/DE and slow-consumer output passed')
          const entered = yield* Deferred.make<void>()
          const blocked = yield* service.stream({ text: 'Hello, world.', targetLanguage: 'ja' }).pipe(
            Stream.runForEach(() => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))),
            Effect.forkScoped,
          )
          yield* Deferred.await(entered).pipe(Effect.timeout('10 seconds'))
          const blockedStart = yield* Clock.currentTimeMillis
          checkpoint('interrupting suspended consumer')
          yield* Fiber.interrupt(blocked).pipe(Effect.timeout('5 seconds'))
          context.diagnostic(
            `backpressured cancellation settled in ${(yield* Clock.currentTimeMillis) - blockedStart}ms`,
          )
          const prefill = yield* service
            .stream({ text: String.repeat(128)('The meeting is scheduled for Monday. '), targetLanguage: 'ja' })
            .pipe(Stream.runDrain, Effect.forkScoped)
          yield* Effect.sleep('5 millis')
          const prefillStart = yield* Clock.currentTimeMillis
          checkpoint('interrupting in-flight request')
          yield* Fiber.interrupt(prefill).pipe(Effect.timeout('5 seconds'))
          context.diagnostic(`in-flight cancellation settled in ${(yield* Clock.currentTimeMillis) - prefillStart}ms`)
          // Closing a backpressured consumer must release its context and permit immediately.
          yield* service
            .stream({ text: String.repeat(12)('Hello, world. '), targetLanguage: 'ja' })
            .pipe(Stream.take(1), Stream.runDrain)
          assert.notEqual(yield* translate('Thank you.', 'ja').pipe(Effect.timeout('10 seconds')), '')
          const contextFailure = yield* translate(String.repeat(5000)('Hello '), 'ja').pipe(Effect.flip)
          assert.equal(contextFailure.code, 'ContextTooLong')
          checkpoint('cancellation, replacement and context failure passed')
          const tiny = yield* makeTranslation({ ...config, maxTokens: 1 })
          checkpoint('second model loaded')
          const outputFailure = yield* tiny
            .stream({ text: 'The project dashboard lists all current tasks.', targetLanguage: 'ja' })
            .pipe(Stream.runDrain, Effect.flip)
          assert.equal(outputFailure.code, 'OutputTooLong')
          checkpoint('output failure passed')
        }),
      ),
    )
  },
)
