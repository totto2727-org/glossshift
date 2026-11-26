import { TranslationError } from '@glossshift/runtime/config'
import type { Array, PlatformError } from 'effect'
import { Data, Predicate, Effect, FileSystem, Path, Result, Sink, Stdio, Stream } from 'effect'

import { runBatch } from './translate-batch.ts'
import type { CliError } from './translation-error.ts'
import { prepareBatch, readSource, writeTranslation } from './translation-files.ts'
import type { BatchOptions } from './translation-plan.ts'

class FilesystemFixtureMismatch extends Data.TaggedError('FilesystemFixtureMismatch')<{ message: string }> {}

const equal = (actual: unknown, expected: unknown): void => {
  if (actual !== expected) {
    throw new FilesystemFixtureMismatch({ message: `Filesystem acceptance mismatch: ${actual} !== ${expected}` })
  }
}
const rejects = <A, E, R>(program: Effect.Effect<A, E, R>, pattern: RegExp): Effect.Effect<undefined, never, R> =>
  Effect.gen(function* () {
    const result = yield* Effect.result(program)
    if (Result.isSuccess(result)) {
      return yield* Effect.die(new FilesystemFixtureMismatch({ message: `Expected rejection: ${pattern}` }))
    }
    const { failure } = result
    const message =
      Predicate.isObject(failure) && !Predicate.isFunction(failure) && 'message' in failure
        ? `${failure['message']}`
        : `${failure}`
    if (!pattern.test(message)) {
      return yield* Effect.die(new FilesystemFixtureMismatch({ message: `Unexpected rejection: ${message}` }))
    }
  })

type FixtureStep = Effect.Effect<void, PlatformError.PlatformError | CliError, FileSystem.FileSystem | Path.Path>
type File = (name: string) => string

const baseText = '# ORIGINAL\n'
const targetText = 'TARGET-ORIGINAL'
const forcedText = '# RAW **TEXT**\n<raw>'
const firstTranslated = '<raw># FIRST\n</raw>'
const secondTranslated = '<raw># SECOND\n</raw>'

const options = (files: Array.NonEmptyReadonlyArray<string>, force = false): BatchOptions => ({
  files,
  force,
  language: 'ja',
  output: 'files',
})

type SymlinkFiles = Readonly<{ guide: string; output: string; target: string }>

const seedSymlink = ({ guide, output, target }: SymlinkFiles): FixtureStep =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(guide, baseText)
    yield* fs.writeFileString(target, targetText)
    yield* fs.symlink(target, output)
  })

const verifyForcedSymlink = ({ guide, output, target }: SymlinkFiles): FixtureStep =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* rejects(prepareBatch(options([guide])), /symbolic link/u)
    yield* prepareBatch(options([guide], true))
    yield* writeTranslation({ destination: output, force: true, inputs: [guide], translated: forcedText })
    equal((yield* fs.lstat(output)).type, 'File')
    equal(yield* readSource(target), targetText)
    equal(yield* readSource(output), forcedText)
    yield* rejects(writeTranslation({ destination: output, force: false, translated: 'NO' }), /AlreadyExists/u)
  })

const verifyHardlink = ({ guide, output }: SymlinkFiles): FixtureStep =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(output)
    yield* fs.link(guide, output)
    yield* rejects(prepareBatch(options([guide], true)), /also an input file/u)
    yield* rejects(
      writeTranslation({ destination: output, force: true, inputs: [guide], translated: 'MUST NOT TRUNCATE' }),
      /also an input file/u,
    )
    equal(yield* readSource(guide), baseText)
  })

const verifyDanglingSymlink = (file: File, { guide, output }: SymlinkFiles): FixtureStep =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(output)
    const missing = file('missing.md')
    yield* fs.symlink(missing, output)
    yield* rejects(prepareBatch(options([guide])), /symbolic link/u)
    yield* writeTranslation({ destination: output, force: true, inputs: [guide], translated: 'NEW' })
    equal(yield* fs.exists(missing), false)
    equal(yield* readSource(output), 'NEW')
  })

const engine = Effect.succeed({
  settings: { model: 'synthetic', sourceLanguage: 'auto' },
  stream: ({ text }: Readonly<{ text: string }>) => Stream.make('<raw>', text, '</raw>'),
})

const failing = Effect.succeed({
  settings: { model: 'synthetic', sourceLanguage: 'auto' },
  stream: () => {
    const error = new TranslationError({ code: 'InferenceFailed', message: 'synthetic inference failure' })
    return Stream.succeed('PARTIAL').pipe(Stream.concat(Stream.fail(error)))
  },
})

const verifyStdout = (first: string, second: string): FixtureStep =>
  Effect.gen(function* () {
    const output = { text: '' }
    const captured = Stdio.layerTest({
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Effect.sync(() => {
            output.text += Predicate.isString(chunk) ? chunk : new TextDecoder().decode(chunk)
          }),
        ),
    })
    const batch = runBatch({ color: 'never', files: [first, second], language: 'ja', output: 'stdout' }, engine, () =>
      Effect.die('plain output must not highlight'),
    )
    yield* batch.pipe(Effect.provide(captured))
    equal(output.text, firstTranslated + secondTranslated)
  })

const ignoredOutput = Stdio.layerTest({})

const verifyBatch = (file: File): FixtureStep =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const first = file('first.md')
    const second = file('second.mbt.md')
    yield* fs.writeFileString(first, '# FIRST\n')
    yield* fs.writeFileString(second, '# SECOND\n')
    yield* verifyStdout(first, second)
    const batch = runBatch(options([first, second]), engine, Effect.succeed)
    yield* batch.pipe(Effect.provide(ignoredOutput))
    equal(yield* readSource(file('first.ja.md')), firstTranslated)
    equal(yield* readSource(file('second.ja.mbt.md')), secondTranslated)
  })

const failingBatch = (file: string, force = false): FixtureStep => {
  const batch = runBatch(options([file], force), failing, Effect.succeed).pipe(Effect.provide(ignoredOutput))
  return rejects(batch, /synthetic inference failure/u)
}

const verifyFailurePreservesFiles = (file: File): FixtureStep =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* failingBatch(file('first.md'), true)
    equal(yield* readSource(file('first.ja.md')), firstTranslated)
    const failed = file('failed.md')
    yield* fs.writeFileString(failed, 'source')
    yield* failingBatch(failed)
    equal(yield* fs.exists(file('failed.ja.md')), false)
  })

const invalidUtf8Byte = 255
const utf8BomSource = '\uFEFF  # raw\n'
const verifySourceFiles = (file: File, { guide, output }: SymlinkFiles): FixtureStep =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* rejects(prepareBatch(options([guide, output], true)), /also an input file/u)
    const invalid = file('bad.md')
    yield* fs.writeFile(invalid, new Uint8Array([invalidUtf8Byte]))
    yield* rejects(readSource(invalid), /not valid UTF-8/u)
    const bom = file('bom.md')
    yield* fs.writeFileString(bom, utf8BomSource)
    equal(yield* readSource(bom), utf8BomSource)
  })

/** Real native filesystem acceptance with synthetic translation. */
export const verifyCliFiles = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'cli-acceptance-' })
    const file: File = (name) => path.join(directory, name)
    const links = { guide: file('guide.md'), output: file('guide.ja.md'), target: file('target.md') }
    yield* seedSymlink(links).pipe(Effect.andThen(verifyForcedSymlink(links)))
    yield* verifyHardlink(links)
    yield* verifyDanglingSymlink(file, links)
    yield* verifyBatch(file)
    yield* verifyFailurePreservesFiles(file).pipe(Effect.andThen(verifySourceFiles(file, links)))
  }),
)
