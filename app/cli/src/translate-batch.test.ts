import { NodeServices } from '@effect/platform-node'
import { Predicate, Array, Effect, FileSystem, MutableRef, Option, Path, Result, Sink, Stdio, Stream } from 'effect'
import type { Layer } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { describe, expect, test } from 'vite-plus/test'

import { runCli, runProgram } from './program.ts'
import { boundedTranslation, colorEnabled, highlightMarkdown, runBatch } from './translate-batch.ts'
import type { CliError } from './translation-error.ts'
import { verifyCliFiles } from './translation-files.test.fixture.ts'
import { prepareBatch, readSource } from './translation-files.ts'
import { normalizeLanguage, planBatch, targetPath } from './translation-plan.ts'
import type { BatchOptions } from './translation-plan.ts'

const runTestEffect = <A, E>(program: Effect.Effect<A, E>): Promise<A> =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- This is the boundary where the test runner executes the Effect program.
  Effect.runPromise(program)

const captureStdout = (
  args: Readonly<string[]> = [],
): Readonly<{ layer: Layer.Layer<Stdio.Stdio>; read: () => string }> => {
  const output = MutableRef.make('')
  const decoder = new TextDecoder()
  const layer = Stdio.layerTest({
    args: Effect.succeed(args),
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => {
          const text = Predicate.isString(chunk) ? chunk : decoder.decode(chunk)
          MutableRef.update(output, (current) => current + text)
        }),
      ),
  })
  return { layer, read: () => MutableRef.get(output) }
}

const withoutProcesses = ChildProcessSpawner.make(() => Effect.die('help and version must not spawn a process'))

const withCliFixture =
  (layer: ReturnType<typeof captureStdout>['layer']) =>
  <A, E, R>(program: Effect.Effect<A, E, R>) =>
    program.pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provide(NodeServices.layer),
      Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
      Effect.provide(Path.layer),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, withoutProcesses),
    )

const files = (names: Array.NonEmptyReadonlyArray<string>, language = 'ja', force = false): BatchOptions => ({
  files: names,
  force,
  language,
  output: 'files',
})

const readFixture = (
  file: string,
  bytes: Uint8Array,
): Effect.Effect<string, Effect.Error<ReturnType<typeof readSource>>> => {
  const fs = FileSystem.makeNoop({ readFile: () => Effect.succeed(bytes) })
  return readSource(file).pipe(Effect.provideService(FileSystem.FileSystem, fs))
}

const readBoundedFixture = (chunks: Readonly<string[]>): Effect.Effect<string, CliError> => {
  const source = Stream.fromIterable(chunks)
  return Stream.mkString(boundedTranslation(source, 4))
}

// Synthetic filesystem checks isolate preflight ordering from the operating system.
const missingFs = FileSystem.makeNoop({
  exists: () => Effect.succeed(false),
  realPath: (path) => Effect.succeed(path),
})
const preflight = (
  options: BatchOptions,
): Effect.Effect<Effect.Success<ReturnType<typeof prepareBatch>>, Effect.Error<ReturnType<typeof prepareBatch>>> =>
  prepareBatch(options).pipe(Effect.provideService(FileSystem.FileSystem, missingFs), Effect.provide(Path.layer))

const sourceBytes = new TextEncoder().encode('source')

describe('help and version', () => {
  test.each([
    { argument: '--help', expected: 'gshift [flags]' },
    { argument: '-h', expected: 'gshift [flags]' },
    { argument: '--version', expected: 'gshift v0.2.0\n' },
    { argument: '-V', expected: 'gshift v0.2.0\n' },
  ])('prints $argument without configuration or a model', async ({ argument, expected }) => {
    const capture = captureStdout([argument])
    const program = runProgram.pipe(withCliFixture(capture.layer))
    await runTestEffect(program)
    expect(capture.read()).toContain(expected)
  })

  test('prints the version through direct CLI dispatch', async () => {
    const capture = captureStdout()
    await runTestEffect(runCli(['--version']).pipe(withCliFixture(capture.layer)))
    expect(capture.read()).toBe('gshift v0.2.0\n')
  })
})

describe('markdown formatting and byte bounds', () => {
  test('terminal colors preserve every raw Markdown character and empty output', async () => {
    const source = '# Heading\n\n```html\n<raw> & text\n```\n'
    await expect(runTestEffect(highlightMarkdown(source))).resolves.toBe(`\u001B[36m${source}\u001B[0m`)
    await expect(runTestEffect(highlightMarkdown(''))).resolves.toBe('')
  })

  test('translation byte budget counts UTF-8 bytes and accepts the exact bound', async () => {
    const allowed = readBoundedFixture(['あ', 'a'])
    await expect(runTestEffect(allowed)).resolves.toBe('あa')
    const tooLarge = readBoundedFixture(['あ', 'ab'])
    const result = await runTestEffect(Effect.result(tooLarge))
    expect(Result.isFailure(result)).toBe(true)
  })

  test('source decoding rejects malformed UTF-8 and keeps BOM and raw Markdown whitespace', async () => {
    const input = '\uFEFF  # Heading\n\n```html\n<raw>\n```\n'
    const bytes = new TextEncoder().encode(input)
    await expect(runTestEffect(readFixture('source.md', bytes))).resolves.toBe(input)
    const malformed = readFixture('invalid.md', new Uint8Array([255]))
    const invalid = await runTestEffect(Effect.result(malformed))
    expect(Result.isFailure(invalid)).toBe(true)
  })
})

describe('language codes and sibling paths', () => {
  test('language validation accepts only ASCII language codes', async () => {
    const invalid = ['', ' ', '-ja', 'ja-', '../ja', '日本語', 'ja_JP', 'é', 'K', '\uFEFFja']
    const rejected = Effect.forEach(invalid, (language) => Effect.result(normalizeLanguage(language)))
    const outcomes = await runTestEffect(rejected)
    expect(Array.every(outcomes, Result.isFailure)).toBe(true)

    const valid = [' EN-US ', '\u0085JA\u0085', 'x--1']
    const normalized = await runTestEffect(Effect.forEach(valid, normalizeLanguage))
    expect(normalized).toStrictEqual(['en-us', 'ja', 'x--1'])
  })

  test('sibling paths retain compound extensions and replace only known language suffixes', async () => {
    const inputs = [
      'docs/guide.md',
      'docs/guide.mbt.md',
      'docs/guide.en.mbt.md',
      'docs/guide.ja.md',
      'docs/guide.fr.md',
    ]
    const paths = Effect.forEach(inputs, (input) => targetPath(input, 'ja'))
    await expect(runTestEffect(paths)).resolves.toStrictEqual([
      'docs/guide.ja.md',
      'docs/guide.ja.mbt.md',
      'docs/guide.ja.mbt.md',
      'docs/guide.ja.md',
      'docs/guide.fr.ja.md',
    ])
    const invalid = await runTestEffect(Effect.result(targetPath('guide.MD', 'ja')))
    expect(Result.isFailure(invalid)).toBe(true)
  })

  test('stdout plans accept non-Markdown sources without inventing sibling paths', async () => {
    const plan = await runTestEffect(
      planBatch({ color: 'never', files: ['a.txt', 'b.md'], language: 'en', output: 'stdout' }),
    )
    expect(plan).toStrictEqual([
      { input: 'a.txt', output: Option.none() },
      { input: 'b.md', output: Option.none() },
    ])
    expect(colorEnabled('auto', false)).toBe(false)
    expect(colorEnabled('auto', true)).toBe(true)
    expect(colorEnabled('always', false)).toBe(true)
    expect(colorEnabled('never', true)).toBe(false)
  })
})

describe('file preflight', () => {
  test('preflight rejects case-folded sibling collisions before model initialization', async () => {
    const plan = preflight(files(['guide.md', 'GUIDE.en.md']))
    const failure = await runTestEffect(Effect.flip(plan))
    expect(failure.message).toContain('same output file')
  })

  test('preflight rejects a later input output collision even with force', async () => {
    const plan = preflight(files(['guide.md', './guide.fr.md'], 'fr', true))
    const failure = await runTestEffect(Effect.flip(plan))
    expect(failure.message).toContain('is also an input file')
  })

  test('preflight accepts distinct ordered outputs with the synthetic filesystem', async () => {
    const plan = await runTestEffect(preflight(files(['first.md', 'second.mbt.md'])))
    expect(plan).toStrictEqual([
      { input: 'first.md', output: Option.some('first.ja.md') },
      { input: 'second.mbt.md', output: Option.some('second.ja.mbt.md') },
    ])
  })
})

describe('plain stdout', () => {
  test('plain stdout preserves raw deltas and source Markdown in input order without separators', async () => {
    const capture = captureStdout()
    const sources = MutableRef.make<Readonly<string[]>>([])
    const fs = FileSystem.makeNoop({
      readFile: (path) => Effect.succeed(new TextEncoder().encode(`# ${path}\n\n<raw> **text**\n`)),
      realPath: (path) => Effect.succeed(path),
    })
    const engine = Effect.succeed({
      settings: { model: 'synthetic', sourceLanguage: 'auto' },
      stream: (request: Readonly<{ text: string; targetLanguage: string }>) => {
        MutableRef.update(sources, (values) => Array.append(values, request.text))
        return Stream.fromIterable(['```md\n', request.text, '```'])
      },
    })
    await runTestEffect(
      runBatch({ color: 'never', files: ['first.md', 'second.md'], language: 'ja', output: 'stdout' }, engine, () =>
        Effect.die('plain stdout must not invoke a highlighter'),
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provide(Path.layer),
        Effect.provide(capture.layer),
      ),
    )
    expect(MutableRef.get(sources)).toStrictEqual(['# first.md\n\n<raw> **text**\n', '# second.md\n\n<raw> **text**\n'])
    expect(capture.read()).toBe('```md\n# first.md\n\n<raw> **text**\n``````md\n# second.md\n\n<raw> **text**\n```')
  })
})

describe('colored stdout', () => {
  test('color stdout buffers each complete file before highlighting', async () => {
    const capture = captureStdout()
    const highlighted = MutableRef.make<Readonly<string[]>>([])
    const fs = FileSystem.makeNoop({
      readFile: () => Effect.succeed(sourceBytes),
      realPath: Effect.succeed,
    })
    const recordHighlight = (source: string): Effect.Effect<string> =>
      Effect.sync(() => {
        MutableRef.update(highlighted, (values) => Array.append(values, source))
        return `\u001B[36m${source}\u001B[0m`
      })
    const translation = Effect.succeed({
      settings: { model: 'synthetic', sourceLanguage: 'auto' },
      stream: () => Stream.fromIterable(['# A', '\nB']),
    })
    const batch = runBatch(
      { color: 'always', files: ['first.md', 'second.md'], language: 'ja', output: 'stdout' },
      translation,
      recordHighlight,
    )
    const program = batch.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provide(Path.layer),
      Effect.provide(capture.layer),
    )
    await runTestEffect(program)
    expect(MutableRef.get(highlighted)).toStrictEqual(['# A\nB', '# A\nB'])
    expect(capture.read()).toBe('\u001B[36m# A\nB\u001B[0m\u001B[36m# A\nB\u001B[0m')
  })
})

describe('initialization and output safety', () => {
  test('preflight failure does not initialize the model', async () => {
    const initialized = MutableRef.make(false)
    const initialize = Effect.sync(() => {
      MutableRef.set(initialized, true)
      return { settings: { model: 'synthetic', sourceLanguage: 'auto' }, stream: () => Stream.empty }
    })
    const options = files(['guide.md', 'guide.fr.md'], 'fr', true)
    const stdio = Stdio.layerTest({})
    const batch = runBatch(options, initialize, Effect.succeed).pipe(
      Effect.provideService(FileSystem.FileSystem, missingFs),
      Effect.provide(Path.layer),
      Effect.provide(stdio),
    )
    const result = await runTestEffect(Effect.result(batch))
    expect(Result.isFailure(result)).toBe(true)
    expect(MutableRef.get(initialized)).toBe(false)
  })

  test('native Node filesystem preserves force, hardlink, symlink, raw file, and ordered stdout behavior', async () => {
    const check = verifyCliFiles.pipe(Effect.provide(NodeServices.layer))
    await expect(runTestEffect(check)).resolves.toBeUndefined()
  })
})
