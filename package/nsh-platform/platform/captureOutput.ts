import path from 'path'
import process from 'process'

import { Deferred, Effect, String } from 'effect'

import { failure, unsupported } from './errors.ts'

interface Writer {
  on(event: 'exit', handler: (result: import('process').ExitResult) => void): unknown
  write(text: string): void
  end(): void
  kill(): void
  dispose(): void
}
type Launch = (...args: Parameters<typeof process.spawn>) => Writer

/** dd appends a bounded UTF-8 chunk without buffering the complete capture file. */
export const append = (file: string, text: string, executable?: string, launch: Launch = process.spawn) =>
  Effect.gen(function* () {
    if (
      typeof executable !== 'string' ||
      (executable !== 'coreutils' && !path.isAbsolute(executable)) ||
      String.includes('\0')(executable)
    ) {
      return yield* Effect.fail(unsupported('Stdio', 'capture requires an explicit coreutils executable'))
    }
    if (!path.isAbsolute(file) || String.includes('\0')(file))
      return yield* Effect.fail(unsupported('Stdio', 'capture requires an absolute file path'))
    const actualExit = yield* Deferred.make<import('process').ExitResult>()
    let exited = false
    const child = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const child = launch(
            executable,
            ['--coreutils-prog=dd', `of=${file}`, 'oflag=append', 'conv=notrunc', 'status=none'],
            { stdin: 'pipe', timeoutMs: 30_000 },
          )
          child.on('exit', (result) => {
            exited = true
            Effect.runSync(Deferred.succeed(actualExit, result))
          })
          return child
        },
        catch: (cause) => failure('append', file, cause, 'Stdio'),
      }),
      (child) =>
        Effect.try({
          try: () => {
            if (!exited) child.kill()
          },
          catch: (cause) => failure('kill capture writer', file, cause, 'Stdio'),
        }).pipe(
          Effect.orDie,
          // Native exit is delivered only after its writer task is finished. Never dispose early on interruption.
          Effect.ensuring(Deferred.await(actualExit).pipe(Effect.andThen(Effect.sync(() => child.dispose())))),
        ),
    )
    yield* Effect.try({
      try: () => {
        child.write(text)
        child.end()
      },
      catch: (cause) => failure('append', file, cause, 'Stdio'),
    })
    const result = yield* Deferred.await(actualExit)
    if (result.code !== 0) return yield* Effect.fail(failure('append', file, result, 'Stdio'))
  }).pipe(Effect.scoped)
