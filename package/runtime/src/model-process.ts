import { Config, Effect, Path, Stream } from 'effect'
import { ChildProcess } from 'effect/process'
import type { ChildProcessSpawner } from 'effect/process'

import { TranslationError } from './config.ts'

const maxUtilityOutputChars = 8192

const unavailable = (): TranslationError =>
  new TranslationError({
    code: 'ModelUnavailable',
    message: 'The packaged local model utility could not complete. Check model settings and available disk space.',
  })

/** Installed launchers supply immutable paths. Source development uses exact narrowly granted command names. */
export interface ModelUtilityOutput {
  code: number
  stdout: string
}

export const runModelUtility = (
  tool: 'sha256sum' | 'curl',
  args: Readonly<string[]>,
): Effect.Effect<ModelUtilityOutput, TranslationError, Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const executable = yield* Config.String(tool === 'sha256sum' ? 'GLOSSSHIFT_COREUTILS' : 'GLOSSSHIFT_CURL')
      const expected = tool === 'sha256sum' ? 'coreutils' : 'curl'
      if (!path.isAbsolute(executable) && executable !== expected) {
        return yield* Effect.fail(unavailable())
      }
      const commandArgs = tool === 'sha256sum' ? ['--coreutils-prog=sha256sum', ...args] : args
      const child = yield* ChildProcess.make(executable, commandArgs, {
        env: {},
        extendEnv: true,
        stderr: 'pipe',
        stdin: 'ignore',
        stdout: 'pipe',
      })
      const [stdout, , code] = yield* Effect.all(
        [
          child.stdout.pipe(
            Stream.decodeText(),
            Stream.runFoldEffect(
              () => '',
              (text, chunk) =>
                text.length + chunk.length > maxUtilityOutputChars
                  ? Effect.fail(unavailable())
                  : Effect.succeed(text + chunk),
            ),
          ),
          child.stderr.pipe(Stream.runDrain),
          child.exitCode,
        ],
        { concurrency: 'unbounded' },
      )
      return { code: Number(code), stdout }
    }),
  ).pipe(Effect.mapError(unavailable))
