import * as NodeServices from '@effect/platform-node/NodeServices'
import { Array, Effect, FileSystem, Option, Path, Result, Sink, Stdio, Stream } from 'effect'
import { ChildProcessSpawner, make as makeSpawner } from 'effect/process/ChildProcessSpawner'
import { expect, test } from 'vite-plus/test'

import { prepareBatch, readSource } from './cli-files.ts'
import { verifyCliFiles } from './cli-fs.test.fixture.ts'
import {
  boundedTranslation,
  colorEnabled,
  highlightMarkdown,
  normalizeLanguage,
  planBatch,
  runBatch,
  targetPath,
} from './cli.ts'
import type { BatchOptions } from './cli.ts'
import { runCli, runProgram } from './main.ts'

test('direct batch help and version require only Stdio and do not initialize configuration or models', async () => {
  for (const argument of ['--help', '-h', '--version', '-V']) {
    let output = ''
    const stdio = Stdio.layerTest({
      args: Effect.succeed([argument]),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Effect.sync(() => {
            output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
          }),
        ),
    })
    await Effect.runPromise(
      runProgram.pipe(
        Effect.scoped,
        Effect.provide(stdio),
        Effect.provide(NodeServices.layer),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.provide(Path.layer),
        Effect.provideService(
          ChildProcessSpawner,
          makeSpawner(() => Effect.die('help must not spawn a process')),
        ),
      ),
    )
    expect(output).toContain(argument === '--help' || argument === '-h' ? 'gshift [flags]' : 'gshift v0.2.0\n')
  }
  let output = ''
  await Effect.runPromise(
    runCli(['--version']).pipe(
      Effect.scoped,
      Effect.provide(
        Stdio.layerTest({
          stdout: () =>
            Sink.forEach((chunk: string | Uint8Array) =>
              Effect.sync(() => {
                output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
              }),
            ),
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
      Effect.provide(Path.layer),
      Effect.provideService(
        ChildProcessSpawner,
        makeSpawner(() => Effect.die('version must not spawn a process')),
      ),
    ),
  )
  expect(output).toBe('gshift v0.2.0\n')
})

const files = (files: Array.NonEmptyReadonlyArray<string>, language = 'ja', force = false): BatchOptions => ({
  files,
  language,
  output: 'files',
  force,
})
const fails = <A, E>(effect: Effect.Effect<A, E>) => Result.isFailure(Effect.runSync(Effect.result(effect)))

test('ANSI styling preserves every raw Markdown character and empty output', () => {
  const source = '# Heading\n\n```html\n<raw> & text\n```\n'
  expect(Effect.runSync(highlightMarkdown(source))).toBe(`\u001b[36m${source}\u001b[0m`)
  expect(Effect.runSync(highlightMarkdown(''))).toBe('')
})

test('translation byte budget counts UTF-8 bytes and accepts the exact bound', async () => {
  expect(await Effect.runPromise(Stream.mkString(boundedTranslation(Stream.fromIterable(['あ', 'a']), 4)))).toBe('あa')
  const result = await Effect.runPromise(
    Effect.result(Stream.mkString(boundedTranslation(Stream.fromIterable(['あ', 'ab']), 4))),
  )
  expect(Result.isFailure(result)).toBe(true)
})

test('source decoding rejects malformed UTF-8 and keeps BOM and raw Markdown whitespace', async () => {
  const input = '\ufeff  # Heading\n\n```html\n<raw>\n```\n'
  const decoded = await Effect.runPromise(
    readSource('source.md').pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({ readFile: () => Effect.succeed(new TextEncoder().encode(input)) }),
      ),
    ),
  )
  expect(decoded).toBe(input)
  const invalid = await Effect.runPromise(
    Effect.result(
      readSource('invalid.md').pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({ readFile: () => Effect.succeed(new Uint8Array([0xff])) }),
        ),
      ),
    ),
  )
  expect(Result.isFailure(invalid)).toBe(true)
})

test('language validation accepts only ASCII language codes', () => {
  for (const language of ['', ' ', '-ja', 'ja-', '../ja', '日本語', 'ja_JP', 'é', 'K', '\ufeffja']) {
    expect(fails(normalizeLanguage(language))).toBe(true)
  }
  expect(Effect.runSync(normalizeLanguage(' EN-US '))).toBe('en-us')
  expect(Effect.runSync(normalizeLanguage('\u0085JA\u0085'))).toBe('ja')
  expect(Effect.runSync(normalizeLanguage('x--1'))).toBe('x--1')
})

test('sibling paths retain compound extensions and replace only known language suffixes', () => {
  for (const [input, output] of [
    ['docs/guide.md', 'docs/guide.ja.md'],
    ['docs/guide.mbt.md', 'docs/guide.ja.mbt.md'],
    ['docs/guide.en.mbt.md', 'docs/guide.ja.mbt.md'],
    ['docs/guide.ja.md', 'docs/guide.ja.md'],
    ['docs/guide.fr.md', 'docs/guide.fr.ja.md'],
  ]) {
    if (input !== undefined && output !== undefined) expect(Effect.runSync(targetPath(input, 'ja'))).toBe(output)
  }
  expect(fails(targetPath('guide.MD', 'ja'))).toBe(true)
})

test('stdout plans accept non-Markdown sources without inventing sibling paths', () => {
  const plan = Effect.runSync(planBatch({ files: ['a.txt', 'b.md'], language: 'en', output: 'stdout', color: 'never' }))
  expect(plan).toEqual([
    { input: 'a.txt', output: Option.none() },
    { input: 'b.md', output: Option.none() },
  ])
  expect(colorEnabled('auto', false)).toBe(false)
  expect(colorEnabled('auto', true)).toBe(true)
  expect(colorEnabled('always', false)).toBe(true)
  expect(colorEnabled('never', true)).toBe(false)
})

// Synthetic filesystem checks isolate preflight ordering from the operating system.
const missingFs = FileSystem.makeNoop({ realPath: (path) => Effect.succeed(path), exists: () => Effect.succeed(false) })
const preflight = (options: BatchOptions) =>
  prepareBatch(options).pipe(Effect.provideService(FileSystem.FileSystem, missingFs), Effect.provide(Path.layer))

test('preflight rejects case-folded sibling collisions before model initialization', async () => {
  const result = await Effect.runPromise(Effect.result(preflight(files(['guide.md', 'GUIDE.en.md']))))
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) expect(result.failure.message).toContain('same output file')
})

test('preflight rejects a later input output collision even with force', async () => {
  const result = await Effect.runPromise(Effect.result(preflight(files(['guide.md', './guide.fr.md'], 'fr', true))))
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) expect(result.failure.message).toContain('is also an input file')
})

test('preflight accepts distinct ordered outputs with the synthetic filesystem', async () => {
  const plan = await Effect.runPromise(preflight(files(['first.md', 'second.mbt.md'])))
  expect(plan).toEqual([
    { input: 'first.md', output: Option.some('first.ja.md') },
    { input: 'second.mbt.md', output: Option.some('second.ja.mbt.md') },
  ])
})

test('plain stdout preserves raw deltas and source Markdown in input order without separators', async () => {
  let stdout = ''
  let sources: ReadonlyArray<string> = []
  const fs = FileSystem.makeNoop({
    realPath: (path) => Effect.succeed(path),
    readFile: (path) => Effect.succeed(new TextEncoder().encode(`# ${path}\n\n<raw> **text**\n`)),
  })
  const engine = Effect.succeed({
    settings: { sourceLanguage: 'auto', model: 'synthetic' },
    stream: (request: { readonly text: string; readonly targetLanguage: string }) => {
      sources = Array.append(sources, request.text)
      return Stream.fromIterable(['```md\n', request.text, '```'])
    },
  })
  await Effect.runPromise(
    runBatch({ files: ['first.md', 'second.md'], language: 'ja', output: 'stdout', color: 'never' }, engine, () =>
      Effect.die('plain stdout must not invoke a highlighter'),
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provide(Path.layer),
      Effect.provide(
        Stdio.layerTest({
          stdout: () =>
            Sink.forEach((chunk: string | Uint8Array) =>
              Effect.sync(() => {
                if (typeof chunk === 'string') stdout += chunk
              }),
            ),
        }),
      ),
    ),
  )
  expect(sources).toEqual(['# first.md\n\n<raw> **text**\n', '# second.md\n\n<raw> **text**\n'])
  expect(stdout).toBe('```md\n# first.md\n\n<raw> **text**\n``````md\n# second.md\n\n<raw> **text**\n```')
})

test('color stdout buffers each complete file before highlighting', async () => {
  let stdout = ''
  let highlighted: ReadonlyArray<string> = []
  await Effect.runPromise(
    runBatch(
      { files: ['first.md', 'second.md'], language: 'ja', output: 'stdout', color: 'always' },
      Effect.succeed({
        settings: { sourceLanguage: 'auto', model: 'synthetic' },
        stream: () => Stream.fromIterable(['# A', '\nB']),
      }),
      (source) =>
        Effect.sync(() => {
          highlighted = Array.append(highlighted, source)
          return `\u001b[36m${source}\u001b[0m`
        }),
    ).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          realPath: Effect.succeed,
          readFile: () => Effect.succeed(new TextEncoder().encode('source')),
        }),
      ),
      Effect.provide(Path.layer),
      Effect.provide(
        Stdio.layerTest({
          stdout: () =>
            Sink.forEach((chunk: string | Uint8Array) =>
              Effect.sync(() => {
                if (typeof chunk === 'string') stdout += chunk
              }),
            ),
        }),
      ),
    ),
  )
  expect(highlighted).toEqual(['# A\nB', '# A\nB'])
  expect(stdout).toBe('\u001b[36m# A\nB\u001b[0m\u001b[36m# A\nB\u001b[0m')
})

test('preflight failure does not initialize the model', async () => {
  let initialized = false
  const result = await Effect.runPromise(
    Effect.result(
      runBatch(
        files(['guide.md', 'guide.fr.md'], 'fr', true),
        Effect.sync(() => {
          initialized = true
          return { settings: { sourceLanguage: 'auto', model: 'synthetic' }, stream: () => Stream.empty }
        }),
        Effect.succeed,
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, missingFs),
        Effect.provide(Path.layer),
        Effect.provide(Stdio.layerTest({})),
      ),
    ),
  )
  expect(Result.isFailure(result)).toBe(true)
  expect(initialized).toBe(false)
})

test('native Node filesystem preserves force, hardlink, symlink, raw file, and ordered stdout behavior', async () => {
  await Effect.runPromise(verifyCliFiles.pipe(Effect.provide(NodeServices.layer)))
})
