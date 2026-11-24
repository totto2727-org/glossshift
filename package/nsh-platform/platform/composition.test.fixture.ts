import { layer, NshStdio } from '@glossshift/nsh-platform'
import { Config, ConfigProvider, Effect, Exit, Path, Sink, Stdio, Stream } from 'effect'

const observation = Effect.gen(function* () {
  const path = yield* Path.Path
  const stdio = yield* Stdio.Stdio
  return {
    args: yield* stdio.args,
    config: yield* Config.String('STANDALONE_VALUE'),
    path: path.resolve('child'),
    relative: path.relative('parent', 'child'),
  }
})

const verifyInstance = ([cwd, value]: Readonly<[string, string]>): Effect.Effect<void, Config.ConfigError> =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromEnvRecord({ STANDALONE_VALUE: value })
    const stdio = NshStdio.unavailable([value])
    const platform = layer({ configProvider: provider, cwd, stdio })
    const result = yield* observation.pipe(Effect.provide(platform))
    const [argument] = result.args
    if (
      result.path !== `${cwd}/child` ||
      result.relative !== '../child' ||
      result.config !== value ||
      argument !== value
    ) {
      return yield* Effect.die('Platform instances shared application state')
    }
  })

const verifyInvalidCwd = (cwd: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const platform = layer({ cwd })
    const provider = observation.pipe(Effect.provide(platform))
    const invalid = yield* Effect.exit(provider)
    if (!Exit.isFailure(invalid)) {
      return yield* Effect.die('Invalid cwd acquired a Path service')
    }
  })

const outputStandalone = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  yield* Stream.run(Stream.succeed('standalone'), stdio.stdout())
})

const verifyCustomStdio = Effect.gen(function* () {
  const written = { text: '' }
  const custom = NshStdio.make({
    args: Effect.succeed([]),
    stderr: () => Sink.drain,
    stdin: Stream.empty,
    stdout: () =>
      Sink.forEach((value: string | Uint8Array) =>
        Effect.sync(() => {
          written.text += String(value)
        }),
      ),
  })
  const platform = layer({ cwd: '/custom', stdio: custom })
  yield* outputStandalone.pipe(Effect.provide(platform))
  if (written.text !== 'standalone') {
    return yield* Effect.die('Custom Stdio layer was not installed')
  }
})

/** Only the public entry point is needed, with no application config, environment grants, or tools. */
export const verifyCompositions = Effect.gen(function* () {
  yield* Effect.forEach(
    [
      ['/first', 'one'],
      ['/second', 'two'],
    ] as const,
    verifyInstance,
    { discard: true },
  )
  yield* Effect.forEach(['relative', '/invalid\0path'], verifyInvalidCwd, { discard: true })
  yield* verifyCustomStdio
})
