import { Config, ConfigProvider, Effect, Path, Sink, Stdio, Stream } from 'effect'

import { layer, NshStdio } from '../platform.ts'

const observation = Effect.gen(function* () {
  const path = yield* Path.Path
  const stdio = yield* Stdio.Stdio
  return {
    path: path.resolve('child'),
    relative: path.relative('parent', 'child'),
    config: yield* Config.String('STANDALONE_VALUE'),
    args: yield* stdio.args,
  }
})

/** Only the public entry point is needed, with no application config, environment grants, or tools. */
export const verifyCompositions = Effect.gen(function* () {
  for (const [cwd, value] of [
    ['/first', 'one'],
    ['/second', 'two'],
  ] as const) {
    const result = yield* observation.pipe(
      Effect.provide(
        layer({
          cwd,
          configProvider: ConfigProvider.fromEnvRecord({ STANDALONE_VALUE: value }),
          stdio: NshStdio.unavailable([value]),
        }),
      ),
    )
    if (
      result.path !== `${cwd}/child` ||
      result.relative !== '../child' ||
      result.config !== value ||
      result.args[0] !== value
    )
      return yield* Effect.die('Platform instances shared application state')
  }
  for (const cwd of ['relative', '/invalid\0path']) {
    const invalid = yield* Effect.exit(observation.pipe(Effect.provide(layer({ cwd }))))
    if (invalid._tag !== 'Failure') return yield* Effect.die('Invalid cwd acquired a Path service')
  }
  let text = ''
  const custom = NshStdio.make({
    args: Effect.succeed([]),
    stdout: () =>
      Sink.forEach((value: string | Uint8Array) =>
        Effect.sync(() => {
          text += String(value)
        }),
      ),
    stderr: () => Sink.drain,
    stdin: Stream.empty,
  })
  yield* Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    yield* Stream.run(Stream.succeed('standalone'), stdio.stdout())
  }).pipe(Effect.provide(layer({ cwd: '/custom', stdio: custom })))
  if (text !== 'standalone') return yield* Effect.die('Custom Stdio layer was not installed')
})
