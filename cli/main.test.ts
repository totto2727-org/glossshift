import * as NodeServices from '@effect/platform-node/NodeServices'
import { Effect, FileSystem, Path, Sink, Stdio, Stream } from 'effect'
import { CliOutput, Command } from 'effect/cli'
import { describe, expect, it } from 'vite-plus/test'

import { makeCommand, runCli } from '../runtime/main.ts'

const capture = () => {
  const output = { stdout: '', stderr: '' }
  const sink = (destination: 'stdout' | 'stderr') => () =>
    Sink.forEach((chunk: string | Uint8Array) =>
      Effect.sync(() => {
        output[destination] += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      }),
    )
  return { output, layer: Stdio.layerTest({ stdout: sink('stdout'), stderr: sink('stderr') }) }
}

const fixture = Effect.succeed({
  settings: { model: 'synthetic', sourceLanguage: 'en' },
  stream: ({ text }: { readonly text: string }) => Stream.succeed(`translated:${text}`),
})

const runFixture = (args: ReadonlyArray<string>) => Command.runWith(makeCommand(fixture), { version: '0.2.0' })(args)

describe('native Effect CLI', () => {
  it.each([{ args: [] }, { args: ['--help'] }, { args: ['-h'] }])(
    'prints help without configuration or a model for $args',
    async ({ args }) => {
      const { output, layer } = capture()
      await Effect.runPromise(
        runCli(args).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(NodeServices.layer)),
      )
      expect(output.stdout).toContain('gshift [flags] <files...>')
      expect(output.stdout).not.toContain('--tui')
      expect(output.stderr).toBe('')
    },
  )

  it.each(['--version', '-V'])('prints the version for %s', async (argument) => {
    const { output, layer } = capture()
    await Effect.runPromise(
      runCli([argument]).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(NodeServices.layer)),
    )
    expect(output.stdout).toBe('gshift v0.2.0\n')
    expect(output.stderr).toBe('')
  })

  it('rejects the removed interactive terminal option', async () => {
    const { output, layer } = capture()
    await expect(
      Effect.runPromise(
        runCli(['--tui']).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(NodeServices.layer)),
      ),
    ).rejects.toThrow()
    expect(output.stderr).toContain('--tui')
  })

  it.each([
    ['--stdout', '--force'],
    ['--color', 'always'],
  ])('rejects incompatible output flags %j before loading the model', async (...flags) => {
    const { layer } = capture()
    await expect(
      Effect.runPromise(
        runFixture(['input.md', '--lang', 'ja', ...flags]).pipe(
          Effect.scoped,
          Effect.provide(layer),
          Effect.provide(NodeServices.layer),
        ),
      ),
    ).rejects.toThrow()
  })

  it.each([
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
    await expect(
      Effect.runPromise(
        runFixture(args).pipe(
          Effect.scoped,
          Effect.provideService(CliOutput.Presenter, { present: () => Effect.void }),
          Effect.provide(layer),
          Effect.provide(NodeServices.layer),
        ),
      ),
    ).rejects.toThrow(message)
  })

  it('accepts the short language alias and literal dash-prefixed filename after --', async () => {
    const { layer } = capture()
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
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
        }),
      ).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)),
    )
    expect(result).toBe('translated:Literal input')
  })

  it('preserves ordered stdout without separators or automatic color when redirected', async () => {
    const { output, layer } = capture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gshift-cli-test-' })
          const first = path.join(directory, 'first.md')
          const second = path.join(directory, 'second.mbt.md')
          yield* fs.writeFileString(first, '# One\n')
          yield* fs.writeFileString(second, 'Two')
          yield* runFixture([first, second, '--lang', ' JA ', '--stdout'])
        }),
      ).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)),
    )
    expect(output.stdout).toBe('translated:# One\ntranslated:Two')
    expect(output.stderr).toBe('')
  })

  it('replaces a forced output symlink without modifying its target', async () => {
    const { layer } = capture()
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gshift-cli-test-' })
          const source = path.join(directory, 'source.md')
          const target = path.join(directory, 'unrelated.md')
          const destination = path.join(directory, 'source.ja.md')
          yield* fs.writeFileString(source, 'Original')
          yield* fs.writeFileString(target, 'Keep me')
          yield* fs.symlink(target, destination)
          yield* runFixture([source, '--lang', 'JA', '--force'])
          return {
            output: yield* fs.readFileString(destination),
            target: yield* fs.readFileString(target),
            type: (yield* fs.lstat(destination)).type,
          }
        }),
      ).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)),
    )
    expect(result).toEqual({ output: 'translated:Original', target: 'Keep me', type: 'File' })
  })

  it('rejects input/output collisions before initializing translation', async () => {
    const { layer } = capture()
    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            const path = yield* Path.Path
            const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gshift-cli-test-' })
            const source = path.join(directory, 'source.ja.md')
            yield* fs.writeFileString(source, 'Keep me')
            const command = makeCommand(Effect.die('translation must not initialize'))
            yield* Command.runWith(command, { version: '0.2.0' })([source, '--lang', 'ja', '--force'])
          }),
        ).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer)),
      ),
    ).rejects.toThrow('also an input file')
  })
})
