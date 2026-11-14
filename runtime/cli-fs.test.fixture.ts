import { Array, Effect, FileSystem, Path, Result, Sink, Stdio, Stream } from 'effect'

import { prepareBatch, readSource, writeTranslation } from './cli-files.ts'
import { runBatch } from './cli.ts'
import type { BatchOptions } from './cli.ts'
import { TranslationError } from './config.ts'

const equal = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Filesystem acceptance mismatch: ${actual} !== ${expected}`)
}
const rejects = <A, E, R>(program: Effect.Effect<A, E, R>, pattern: RegExp) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(program)
    if (Result.isSuccess(result)) return yield* Effect.die(new Error(`Expected rejection: ${pattern}`))
    const failure = result.failure
    const message =
      typeof failure === 'object' && failure !== null && 'message' in failure ? `${failure.message}` : `${failure}`
    if (!pattern.test(message)) return yield* Effect.die(new Error(`Unexpected rejection: ${message}`))
  })

/** Real native filesystem acceptance with synthetic translation, never model inference. */
export const verifyCliFiles = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'cli-acceptance-' })
    const file = (name: string) => path.join(directory, name)
    const options = (names: Array.NonEmptyReadonlyArray<string>, force = false) =>
      Effect.succeed<BatchOptions>({ files: names, language: 'ja', output: 'files', force })
    const guide = file('guide.md')
    const output = file('guide.ja.md')
    const target = file('target.md')
    yield* fs.writeFileString(guide, '# ORIGINAL\n')
    yield* fs.writeFileString(target, 'TARGET-ORIGINAL')
    yield* fs.symlink(target, output)
    yield* rejects(Effect.flatMap(options([guide]), prepareBatch), /symbolic link/)
    yield* Effect.flatMap(options([guide], true), prepareBatch)
    yield* writeTranslation(output, '# RAW **TEXT**\n<raw>', true, [guide])
    equal((yield* fs.lstat(output)).type, 'File')
    equal(yield* readSource(target), 'TARGET-ORIGINAL')
    equal(yield* readSource(output), '# RAW **TEXT**\n<raw>')
    yield* rejects(writeTranslation(output, 'NO', false), /AlreadyExists/)
    yield* fs.remove(output)
    yield* fs.link(guide, output)
    yield* rejects(Effect.flatMap(options([guide], true), prepareBatch), /also an input file/)
    yield* rejects(writeTranslation(output, 'MUST NOT TRUNCATE', true, [guide]), /also an input file/)
    equal(yield* readSource(guide), '# ORIGINAL\n')
    yield* fs.remove(output)
    const missing = file('missing.md')
    yield* fs.symlink(missing, output)
    yield* rejects(Effect.flatMap(options([guide]), prepareBatch), /symbolic link/)
    yield* writeTranslation(output, 'NEW', true, [guide])
    equal(yield* fs.exists(missing), false)
    equal(yield* readSource(output), 'NEW')
    const first = file('first.md')
    const second = file('second.mbt.md')
    yield* fs.writeFileString(first, '# FIRST\n')
    yield* fs.writeFileString(second, '# SECOND\n')
    const engine = Effect.succeed({
      settings: { sourceLanguage: 'auto', model: 'synthetic' },
      stream: ({ text }: { readonly text: string }) => Stream.make('<raw>', text, '</raw>'),
    })
    let stdout = ''
    const captured = Stdio.layerTest({
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Effect.sync(() => {
            stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
          }),
        ),
    })
    yield* runBatch({ files: [first, second], language: 'ja', output: 'stdout', color: 'never' }, engine, () =>
      Effect.die('plain output must not highlight'),
    ).pipe(Effect.provide(captured))
    equal(stdout, '<raw># FIRST\n</raw><raw># SECOND\n</raw>')
    yield* runBatch(yield* options([first, second]), engine, Effect.succeed).pipe(Effect.provide(Stdio.layerTest({})))
    equal(yield* readSource(file('first.ja.md')), '<raw># FIRST\n</raw>')
    equal(yield* readSource(file('second.ja.mbt.md')), '<raw># SECOND\n</raw>')
    const failing = Effect.succeed({
      settings: { sourceLanguage: 'auto', model: 'synthetic' },
      stream: () =>
        Stream.succeed('PARTIAL').pipe(
          Stream.concat(
            Stream.fail(new TranslationError({ code: 'InferenceFailed', message: 'synthetic inference failure' })),
          ),
        ),
    })
    yield* rejects(
      runBatch(yield* options([first], true), failing, Effect.succeed).pipe(Effect.provide(Stdio.layerTest({}))),
      /synthetic inference failure/,
    )
    equal(yield* readSource(file('first.ja.md')), '<raw># FIRST\n</raw>')
    const failed = file('failed.md')
    yield* fs.writeFileString(failed, 'source')
    yield* rejects(
      runBatch(yield* options([failed]), failing, Effect.succeed).pipe(Effect.provide(Stdio.layerTest({}))),
      /synthetic inference failure/,
    )
    equal(yield* fs.exists(file('failed.ja.md')), false)
    yield* rejects(Effect.flatMap(options([guide, output], true), prepareBatch), /also an input file/)
    const invalid = file('bad.md')
    yield* fs.writeFile(invalid, new Uint8Array([255]))
    yield* rejects(readSource(invalid), /not valid UTF-8/)
    const bom = file('bom.md')
    yield* fs.writeFileString(bom, '\ufeff  # raw\n')
    equal(yield* readSource(bom), '\ufeff  # raw\n')
  }),
)
