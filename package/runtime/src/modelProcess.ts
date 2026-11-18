import { Config, Effect, Path, Stream } from 'effect'
import { ChildProcess } from 'effect/process'

import { TranslationError } from './config.ts'

const unavailable = () =>
  new TranslationError({
    code: 'ModelUnavailable',
    message: 'The packaged local model utility could not complete. Check model settings and available disk space.',
  })

/** Installed launchers supply immutable paths. Source development uses exact narrowly granted command names. */
export const runModelUtility = (tool: 'sha256sum' | 'curl', args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const executable = yield* Config.String(tool === 'sha256sum' ? 'GLOSSSHIFT_COREUTILS' : 'GLOSSSHIFT_CURL')
      const expected = tool === 'sha256sum' ? 'coreutils' : 'curl'
      if (!path.isAbsolute(executable) && executable !== expected) return yield* Effect.fail(unavailable())
      const arguments_ = tool === 'sha256sum' ? ['--coreutils-prog=sha256sum', ...args] : args
      const child = yield* ChildProcess.make(executable, arguments_, {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {},
        extendEnv: true,
      })
      const [stdout, , code] = yield* Effect.all(
        [
          child.stdout.pipe(
            Stream.decodeText(),
            Stream.runFoldEffect(
              () => '',
              (text, chunk) =>
                text.length + chunk.length > 8192 ? Effect.fail(unavailable()) : Effect.succeed(text + chunk),
            ),
          ),
          child.stderr.pipe(Stream.runDrain),
          child.exitCode,
        ],
        { concurrency: 'unbounded' },
      )
      return { stdout, code: Number(code) }
    }),
  ).pipe(Effect.mapError(unavailable))
