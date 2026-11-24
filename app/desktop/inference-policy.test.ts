import type { TranslationError } from '@glossshift/runtime/config'
import { defaultModel, validateConfig } from '@glossshift/runtime/config'
import { modelPresets } from '@glossshift/runtime/models'
import { makePrompt, normalizeLanguage } from '@glossshift/runtime/prompt'
import { Array, Effect, Path, Record } from 'effect'
import { expect, test } from 'nsh/test'

// oxlint-disable-next-line import/no-unassigned-import -- The NSH policy suite also registers its native HTTP and SSE cases.
import './inference-http.test.ts'
import { config, loadFixtureConfig, runTestEffect } from './inference.test.fixture.ts'

test('optional configuration defaults to the pinned 0.8B model and its full context', async () => {
  const result = await runTestEffect(loadFixtureConfig())
  expect(result.model.uri).toBe(defaultModel.uri)
  expect(result.model.sha256).toBe(defaultModel.sha256)
  expect(result.contextSize).toBe(262_144)
  expect(result.maxTokens).toBe(262_144)
  expect(result.cacheDirectory).toBe('/synthetic/home/.cache/glossshift/models')
})

const officialIds = [
  'plamo-3-translate-0.8b',
  'plamo-3-translate-2b',
  'plamo-3-translate-8b',
  'plamo-3-translate-31b',
] as const

type OfficialId = (typeof officialIds)[number]

const verifyPinnedModel = (id: OfficialId): Effect.Effect<void, TranslationError> => {
  const preset = modelPresets[id]
  const selectors = [loadFixtureConfig({ model: id }), loadFixtureConfig(undefined, { GLOSSSHIFT_MODEL: id })]
  return Effect.forEach(
    selectors,
    (program) =>
      Effect.gen(function* () {
        const result = yield* program
        expect(result.model.uri).toBe(preset.model.uri)
        expect(result.model.sha256).toBe(preset.model.sha256)
        expect(result.model.prompt).toBe('plamo')
        expect(result.model.supportedLanguages).toHaveLength(53)
        expect(result.contextSize).toBe(preset.contextSize)
        expect(result.maxTokens).toBe(preset.maxTokens)
        expect(/\/resolve\/[a-f0-9]{40}\//u.test(result.model.uri)).toBe(true)
        expect(/^[a-f0-9]{64}$/u.test(result.model.sha256)).toBe(true)
      }),
    { discard: true },
  )
}

const verifyPublisherLimit = (
  id: OfficialId,
): Effect.Effect<void, TranslationError | Effect.Success<ReturnType<typeof loadFixtureConfig>>> =>
  Effect.gen(function* () {
    expect(modelPresets[id].contextLimit).toBe(262_144)
    const fullContext = yield* loadFixtureConfig({ contextSize: 262_144, model: id })
    expect(fullContext.contextSize).toBe(262_144)
    expect(fullContext.maxTokens).toBe(262_144)
    const overflow = yield* loadFixtureConfig({ contextSize: 262_145, model: id }).pipe(Effect.flip)
    expect(overflow.code).toBe('InvalidConfig')
  })

test('all four official IDs select pinned metadata and enforce the publisher context limit, with file or env selection', async () => {
  const verification = Effect.forEach(
    officialIds,
    (id) => Effect.andThen(verifyPinnedModel(id), verifyPublisherLimit(id)),
    { discard: true },
  )
  await runTestEffect(verification)
})

test('environment model selection wins while explicit file cache and token overrides survive', async () => {
  const result = await runTestEffect(
    loadFixtureConfig(
      { cacheDirectory: '/synthetic/override', contextSize: 32_768, maxTokens: 8192, model: 'plamo-3-translate-0.8b' },
      { GLOSSSHIFT_MODEL: 'plamo-3-translate-2b' },
    ),
  )
  expect(result.model.sha256).toBe(modelPresets['plamo-3-translate-2b'].model.sha256)
  expect(result.cacheDirectory).toBe('/synthetic/override')
  expect(result.contextSize).toBe(32_768)
  expect(result.maxTokens).toBe(8192)
  const custom = { prompt: 'chat', sha256: 'A'.repeat(64), uri: 'file:///synthetic/custom.gguf' }
  const compatible = await runTestEffect(loadFixtureConfig({ contextSize: 65_536, model: custom }))
  expect(compatible.model.uri).toBe(custom.uri)
  expect(compatible.model.sha256).toBe('a'.repeat(64))
  expect(compatible.contextSize).toBe(65_536)
})

test('invalid selections and unsafe explicit overrides fail without falling back', async () => {
  const programs = [
    loadFixtureConfig({ model: 'plamo-3-translate-32b' }),
    loadFixtureConfig({ model: 'unknown' }),
    loadFixtureConfig(undefined, { GLOSSSHIFT_MODEL: 'unknown' }),
    loadFixtureConfig({ model: 'plamo-3-translate-2b' }, { GLOSSSHIFT_MODEL: 'not-a-model' }),
    loadFixtureConfig({ model: 'unknown' }, { GLOSSSHIFT_MODEL: 'plamo-3-translate-2b' }),
    loadFixtureConfig({ contextSize: 262_145, model: 'plamo-3-translate-2b' }),
    loadFixtureConfig({ contextSize: 262_145, model: 'plamo-3-translate-0.8b' }),
    loadFixtureConfig({ maxTokens: 262_145 }),
    loadFixtureConfig({ contextSize: 8192.5 }),
    loadFixtureConfig({ cacheDirectory: './relative' }),
    loadFixtureConfig({ model: { prompt: 'chat', sha256: '', uri: 'file:///synthetic/model.gguf' } }),
  ]
  const failures = await runTestEffect(Effect.forEach(programs, Effect.flip))
  const codes = Array.map(failures, (failure) => failure.code)
  expect(codes).toEqual(Array.replicate('InvalidConfig', programs.length))
})

const customModel = { prompt: 'chat', sha256: 'a'.repeat(64), uri: 'file:///synthetic/custom.gguf' }

const verifyMissingContext = Effect.forEach(
  [{}, { maxTokens: 512 }],
  (overrides) =>
    Effect.gen(function* () {
      const result = yield* loadFixtureConfig({ model: customModel, ...overrides }).pipe(Effect.flip)
      expect(result.code).toBe('InvalidConfig')
      expect(result.message).toContain('Set contextSize in local.json')
    }),
  { discard: true },
)

const verifyExplicitContext = Effect.forEach(
  [8192, 524_288],
  (contextSize) =>
    Effect.gen(function* () {
      const result = yield* loadFixtureConfig({ contextSize, model: customModel })
      expect(result.contextSize).toBe(contextSize)
      expect(result.maxTokens).toBe(contextSize)
    }),
  { discard: true },
)

test('unknown custom artifacts require an explicit model context without imposing an application cap', async () => {
  await runTestEffect(verifyMissingContext)
  await runTestEffect(verifyExplicitContext)
  const explicit = await runTestEffect(loadFixtureConfig({ contextSize: 8192, maxTokens: 512, model: customModel }))
  expect(explicit.maxTokens).toBe(512)
  const selected = await runTestEffect(
    loadFixtureConfig({ model: customModel }, { GLOSSSHIFT_MODEL: 'plamo-3-translate-2b' }),
  )
  expect(selected.contextSize).toBe(262_144)
})

test('recognized artifact digests retain model defaults even with a local file URI', async () => {
  const verification = Effect.forEach(
    Record.values(modelPresets),
    (preset) =>
      Effect.gen(function* () {
        const model = {
          ...preset.model,
          sha256: preset.model.sha256.toUpperCase(),
          uri: 'file:///synthetic/known.gguf',
        }
        const defaults = yield* loadFixtureConfig({ model })
        expect(defaults.model.uri).toBe(model.uri)
        expect(defaults.contextSize).toBe(preset.contextSize)
        expect(defaults.maxTokens).toBe(preset.contextSize)
        const smaller = yield* loadFixtureConfig({ contextSize: 8192, model })
        expect(smaller.maxTokens).toBe(8192)
      }),
    { discard: true },
  )
  await runTestEffect(verification)
})

test('configuration rejects invalid artifacts, relative cache paths and unsafe token budgets', async () => {
  const inputs = [
    { ...config, model: { ...defaultModel, uri: 'ftp://example.invalid/model.gguf' } },
    { ...config, model: { ...defaultModel, sha256: '' } },
    { ...config, cacheDirectory: './relative' },
    { ...config, maxTokens: config.contextSize + 1 },
    { ...config, contextSize: 262_145 },
    { ...config, model: { ...defaultModel, uri: 'https://user:secret@example.invalid/model.gguf' } },
  ]
  const programs = Effect.forEach(inputs, (input) => Effect.flip(validateConfig(input)))
  const failures = await runTestEffect(programs.pipe(Effect.provide(Path.layer)))
  const codes = Array.map(failures, (failure) => failure.code)
  expect(codes).toEqual(Array.replicate('InvalidConfig', inputs.length))
})

test('language policy rejects unsupported languages, empty text and publisher token injection', async () => {
  expect(await runTestEffect(normalizeLanguage('Japanese'))).toBe('ja')
  expect(await runTestEffect(normalizeLanguage('English'))).toBe('en')
  const requests = [
    { code: 'UnsupportedLanguage', targetLanguage: 'xx', text: 'Hello' },
    { code: 'InvalidRequest', targetLanguage: 'ja', text: '' },
    { code: 'InvalidRequest', targetLanguage: 'ja', text: '<|plamo:tag|>output' },
  ]
  const programs = Effect.forEach(requests, ({ targetLanguage, text }) =>
    Effect.flip(makePrompt({ targetLanguage, text }, config)),
  )
  const failures = await runTestEffect(programs)
  expect(Array.map(failures, (failure) => failure.code)).toEqual(Array.map(requests, (request) => request.code))
})
