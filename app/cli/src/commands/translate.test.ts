import { NodeServices } from '@effect/platform-node'
import { Predicate, Effect, FileSystem, Path, Sink, Stdio, Stream } from 'effect'
import type { Layer, Scope } from 'effect'
import { CliOutput, Command } from 'effect/cli'
import { describe, expect, test } from 'vite-plus/test'

import { runCli } from '#cli/program.ts'

import { makeTranslateCommand } from './translate.ts'

type TestServices = Layer.Success<typeof NodeServices.layer> | Scope.Scope | Stdio.Stdio

const runTestEffect = <A, E>(
  program: Effect.Effect<A, E, TestServices>,
  layer: Layer.Layer<Stdio.Stdio>,
): Promise<A> => {
  const scoped = Effect.scoped(program).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer))
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The Vitest callback executes the complete native CLI program.
  return Effect.runPromise(scoped)
}

const capture = (): Readonly<{
  layer: Layer.Layer<Stdio.Stdio>
  output: { stderr: string; stdout: string }
}> => {
  const output = { stderr: '', stdout: '' }
  const sink = (destination: 'stdout' | 'stderr') => () =>
    Sink.forEach((chunk: string | Uint8Array) =>
      Effect.sync(() => {
        output[destination] += Predicate.isString(chunk) ? chunk : new TextDecoder().decode(chunk)
      }),
    )
  return { layer: Stdio.layerTest({ stderr: sink('stderr'), stdout: sink('stdout') }), output }
}

const fixture = Effect.succeed({
  settings: { model: 'synthetic', sourceLanguage: 'en' },
  stream: ({ text }: Readonly<{ text: string }>) => Stream.succeed(`translated:${text}`),
})

const runFixture = Command.runWith(makeTranslateCommand(fixture), { version: '0.2.0' })

describe('native Effect CLI', () => {
  test.each([{ args: [] }, { args: ['--help'] }, { args: ['-h'] }])(
    'prints help without configuration or a model for $args',
    async ({ args }) => {
      const { output, layer } = capture()
      await runTestEffect(runCli(args), layer)
      expect(output.stdout).toContain('gshift [flags] <files...>')
      expect(output.stdout).not.toContain('--tui')
      expect(output.stderr).toBe('')
    },
  )

  test.each(['--version', '-V'])('prints the version for %s', async (argument) => {
    const { output, layer } = capture()
    await runTestEffect(runCli([argument]), layer)
    expect(output.stdout).toBe('gshift v0.2.0\n')
    expect(output.stderr).toBe('')
  })
})

describe('cli option validation', () => {
  test('rejects the removed interactive terminal option', async () => {
    const { output, layer } = capture()
    const result = runTestEffect(runCli(['--tui']), layer)
    await expect(result).rejects.toThrow('Help requested')
    expect(output.stderr).toContain('--tui')
  })

  test.each([
    { flags: ['--stdout', '--force'], message: '--force cannot be used with --stdout' },
    { flags: ['--color', 'always'], message: '--color requires --stdout' },
  ])('rejects incompatible output flags $flags before loading the model', async ({ flags, message }) => {
    const { layer } = capture()
    const result = runTestEffect(runFixture(['input.md', '--lang', 'ja', ...flags]), layer)
    await expect(result).rejects.toThrow(message)
  })

  test.each([
    { args: [], message: 'Help requested' },
    { args: ['a.md'], message: 'Help requested' },
    { args: ['--lang', 'ja'], message: 'Help requested' },
    { args: ['a.md', '--lang'], message: 'Help requested' },
    { args: ['a.md', '--lang', 'ja', '--force', '--stdout'], message: '--force cannot be used with --stdout' },
    { args: ['a.md', '--lang', 'ja', '--color', 'never'], message: '--color requires --stdout' },
    { args: ['a.md', '--lang', 'ja', '--stdout', '--color', 'sometimes'], message: 'Help requested' },
    { args: ['a.md', '--lang', 'ja', '--lang', 'en'], message: 'Help requested' },
    { args: ['a.md', '--lang', 'ja', '--unexpected'], message: 'Help requested' },
  ])('rejects missing, conflicting, duplicate or invalid declarative options $args', async ({ args, message }) => {
    const { layer } = capture()
    const output = Effect.provideService(CliOutput.Presenter, { present: () => Effect.void })
    const program = runFixture(args).pipe(output)
    await expect(runTestEffect(program, layer)).rejects.toThrow(message)
  })
})

describe('cli path and stdout handling', () => {
  test('accepts the short language alias and literal dash-prefixed filename after --', async () => {
    const { layer } = capture()
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gshift-cli-test-' })
      const source = path.join(directory, '-document.md')
      yield* fs.writeFileString(source, 'Literal input')
      yield* runFixture(['-l', 'zh-Hant', '-f', '--', '-document.md']).pipe(
        Effect.provideService(Path.Path, {
          ...path,
          resolve: (...segments) => path.resolve(directory, ...segments),
        }),
      )
      return yield* fs.readFileString(path.join(directory, '-document.zh-hant.md'))
    })
    const result = await runTestEffect(program, layer)
    expect(result).toBe('translated:Literal input')
  })

  test('preserves ordered stdout without separators or automatic color when redirected', async () => {
    const { output, layer } = capture()
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gshift-cli-test-' })
      const first = path.join(directory, 'first.md')
      const second = path.join(directory, 'second.mbt.md')
      yield* fs.writeFileString(first, '# One\n')
      yield* fs.writeFileString(second, 'Two')
      yield* runFixture([first, second, '--lang', ' JA ', '--stdout'])
    })
    await runTestEffect(program, layer)
    expect(output.stdout).toBe('translated:# One\ntranslated:Two')
    expect(output.stderr).toBe('')
  })
})

describe('cli write safety', () => {
  test('replaces a forced output symlink without modifying its target', async () => {
    const { layer } = capture()
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gshift-cli-test-' })
      const source = path.join(directory, 'source.md')
      const target = path.join(directory, 'unrelated.md')
      const destination = path.join(directory, 'source.ja.md')
      yield* fs.writeFileString(source, 'Original').pipe(Effect.andThen(() => fs.writeFileString(target, 'Keep me')))
      yield* fs.symlink(target, destination)
      yield* runFixture([source, '--lang', 'JA', '--force'])
      return {
        output: yield* fs.readFileString(destination),
        target: yield* fs.readFileString(target),
        type: (yield* fs.lstat(destination)).type,
      }
    })
    const result = await runTestEffect(program, layer)
    expect(result).toStrictEqual({ output: 'translated:Original', target: 'Keep me', type: 'File' })
  })

  test('rejects input/output collisions before initializing translation', async () => {
    const { layer } = capture()
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gshift-cli-test-' })
      const source = path.join(directory, 'source.ja.md')
      yield* fs.writeFileString(source, 'Keep me')
      const command = makeTranslateCommand(Effect.die('translation must not initialize'))
      yield* Command.runWith(command, { version: '0.2.0' })([source, '--lang', 'ja', '--force'])
    })
    await expect(runTestEffect(program, layer)).rejects.toThrow('also an input file')
  })
})
