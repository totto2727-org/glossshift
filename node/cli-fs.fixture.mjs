import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Path, Result, Sink, Stdio, Stream } from 'effect'

import { prepareBatch, readSource, writeTranslation } from './cli-files.ts'
import { parseBatchArgs, runBatch } from './cli.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const entry = fileURLToPath(new URL('./main.ts', import.meta.url))
const help = spawnSync(process.execPath, [entry, '--help'], { encoding: 'utf8' })
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /Usage: gshift <FILES>/)
assert.equal(help.stderr, '')
const invalid = spawnSync(process.execPath, [entry, 'missing.md'], { encoding: 'utf8' })
assert.equal(invalid.status, 1)
assert.equal(invalid.stdout, '')
assert.match(invalid.stderr, /gshift failed: --lang is required/)

const program = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = path.join(repository, 'tmp', 'cli-tests')
    yield* fs.makeDirectory(root, { recursive: true })
    const dir = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'batch-' })
    const file = (name) => path.join(dir, name)
    const options = (names, ...flags) => parseBatchArgs([...names.map(file), '--lang', 'ja', ...flags])
    const rejected = (effect, message) =>
      Effect.gen(function* () {
        const result = yield* Effect.result(effect)
        assert.ok(Result.isFailure(result))
        assert.match(result.failure.message, message)
      })
    yield* fs.writeFileString(file('guide.md'), '# ORIGINAL\n')
    yield* fs.writeFileString(file('target.md'), 'TARGET-ORIGINAL')
    yield* fs.symlink(file('target.md'), file('guide.ja.md'))
    yield* rejected(Effect.flatMap(options(['guide.md']), prepareBatch), /symbolic link/)
    yield* Effect.flatMap(options(['guide.md'], '--force'), prepareBatch)
    yield* writeTranslation(file('guide.ja.md'), '# RAW **TEXT**\n<raw>', true)
    assert.equal((yield* fs.lstat(file('guide.ja.md'))).type, 'File')
    assert.equal(yield* readSource(file('target.md')), 'TARGET-ORIGINAL')
    assert.equal(yield* readSource(file('guide.ja.md')), '# RAW **TEXT**\n<raw>')
    yield* rejected(writeTranslation(file('guide.ja.md'), 'NO', false), /AlreadyExists/)
    yield* fs.remove(file('guide.ja.md'))
    yield* fs.link(file('guide.md'), file('guide.ja.md'))
    yield* rejected(Effect.flatMap(options(['guide.md'], '--force'), prepareBatch), /also an input file/)
    yield* rejected(
      writeTranslation(file('guide.ja.md'), 'MUST NOT TRUNCATE', true, [file('guide.md')]),
      /also an input file/,
    )
    assert.equal(yield* readSource(file('guide.md')), '# ORIGINAL\n')
    yield* fs.remove(file('guide.ja.md'))
    yield* fs.symlink(file('missing.md'), file('guide.ja.md'))
    yield* rejected(Effect.flatMap(options(['guide.md']), prepareBatch), /symbolic link/)
    yield* Effect.flatMap(options(['guide.md'], '--force'), prepareBatch)
    yield* writeTranslation(file('guide.ja.md'), 'NEW', true)
    assert.equal(yield* fs.exists(file('missing.md')), false)
    yield* fs.writeFileString(file('first.md'), '# FIRST\n')
    yield* fs.writeFileString(file('second.mbt.md'), '# SECOND\n')
    const engine = Effect.succeed({
      settings: { sourceLanguage: 'auto', model: 'synthetic' },
      stream: ({ text }) => Stream.fromIterable(['<raw>', text, '</raw>']),
    })
    let stdout = ''
    const captured = Stdio.layerTest({
      stdout: () =>
        Sink.forEach((chunk) =>
          Effect.sync(() => {
            stdout += chunk
          }),
        ),
    })
    yield* runBatch(yield* options(['first.md', 'second.mbt.md'], '--stdout', '--color', 'never'), engine, () =>
      Effect.die('plain output must not highlight'),
    ).pipe(Effect.provide(captured))
    assert.equal(stdout, '<raw># FIRST\n</raw><raw># SECOND\n</raw>')
    yield* runBatch(yield* options(['first.md', 'second.mbt.md']), engine, Effect.succeed).pipe(
      Effect.provide(Stdio.layerTest({})),
    )
    assert.equal(yield* readSource(file('first.ja.md')), '<raw># FIRST\n</raw>')
    assert.equal(yield* readSource(file('second.ja.mbt.md')), '<raw># SECOND\n</raw>')
    const failing = Effect.succeed({
      settings: { sourceLanguage: 'auto', model: 'synthetic' },
      stream: () =>
        Stream.succeed('PARTIAL').pipe(Stream.concat(Stream.fail({ message: 'synthetic inference failure' }))),
    })
    yield* rejected(
      runBatch(yield* options(['first.md'], '--force'), failing, Effect.succeed).pipe(
        Effect.provide(Stdio.layerTest({})),
      ),
      /synthetic inference failure/,
    )
    assert.equal(yield* readSource(file('first.ja.md')), '<raw># FIRST\n</raw>')
    yield* fs.writeFileString(file('failed.md'), 'source')
    yield* rejected(
      runBatch(yield* options(['failed.md']), failing, Effect.succeed).pipe(Effect.provide(Stdio.layerTest({}))),
      /synthetic inference failure/,
    )
    assert.equal(yield* fs.exists(file('failed.ja.md')), false)
    yield* rejected(Effect.flatMap(options(['guide.md', 'guide.ja.md'], '--force'), prepareBatch), /also an input file/)
    yield* fs.writeFile(file('bad.md'), new Uint8Array([255]))
    yield* rejected(readSource(file('bad.md')), /not valid UTF-8/)
    yield* runBatch(yield* options(['first.md', 'second.mbt.md'], '--stdout', '--color', 'never'), engine, () =>
      Effect.die('plain stdout must not highlight'),
    )
  }),
)
await Effect.runPromise(Effect.provide(program, NodeServices.layer))
console.log('CLI filesystem acceptance passed')
