// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import path from 'path'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import { spawn } from 'process'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- The NSH process type belongs to the unprefixed native module.
import type { ExitResult } from 'process'

import { Predicate, Deferred, Effect, MutableRef, String } from 'effect'
import type { PlatformError } from 'effect'

import { platformFailure, unsupported } from './errors.ts'

interface Writer {
  on: (event: 'exit', handler: (result: ExitResult) => void) => unknown
  write: (text: string) => void
  end: () => void
  kill: () => void
  dispose: () => void
}
type Launch = (...args: Parameters<typeof spawn>) => Writer

type AppendRequest = Readonly<{
  file: string
  text: string
  executable?: string | undefined
  launch?: Launch
}>

type ValidAppendRequest = AppendRequest & Readonly<{ executable: string }>

type WriterLifecycle = Readonly<{
  exited: MutableRef.MutableRef<boolean>
  result: Deferred.Deferred<ExitResult>
}>

const captureWriterTimeoutMs = 30_000
const successfulExitCode = 0

const startWriter = (
  request: ValidAppendRequest,
  lifecycle: WriterLifecycle,
): Effect.Effect<Writer, PlatformError.PlatformError> =>
  Effect.try({
    catch: (cause) => platformFailure({ cause, method: 'append', module: 'Stdio', path: request.file }),
    try: () => {
      const { executable, file, launch = spawn } = request
      const writer = launch(
        executable,
        ['--coreutils-prog=dd', `of=${file}`, 'oflag=append', 'conv=notrunc', 'status=none'],
        { stdin: 'pipe', timeoutMs: captureWriterTimeoutMs },
      )
      writer.on('exit', (result) => {
        MutableRef.set(lifecycle.exited, true)
        // oxlint-disable-next-line rules/no-effect-runtime-run -- The native exit callback must complete the Deferred when the process exits.
        Effect.runSync(Deferred.succeed(lifecycle.result, result))
      })
      return writer
    },
  })

const releaseWriter = (file: string, writer: Writer, lifecycle: WriterLifecycle): Effect.Effect<void> => {
  const killIfRunning = Effect.try({
    catch: (cause) => platformFailure({ cause, method: 'kill capture writer', module: 'Stdio', path: file }),
    try: () => {
      if (!MutableRef.get(lifecycle.exited)) {
        writer.kill()
      }
    },
  }).pipe(Effect.orDie)
  // Native exit arrives after its writer task finishes. Interruption still waits before disposal.
  const disposeAfterExit = Deferred.await(lifecycle.result).pipe(Effect.andThen(Effect.sync(() => writer.dispose())))
  return Effect.ensuring(killIfRunning, disposeAfterExit)
}

const validatePaths = (request: AppendRequest): Effect.Effect<ValidAppendRequest, PlatformError.PlatformError> => {
  const { executable, file } = request
  if (
    !Predicate.isString(executable) ||
    (executable !== 'coreutils' && !path.isAbsolute(executable)) ||
    String.includes('\0')(executable)
  ) {
    return Effect.fail(unsupported('Stdio', 'capture requires an explicit coreutils executable'))
  }
  if (!path.isAbsolute(file) || String.includes('\0')(file)) {
    return Effect.fail(unsupported('Stdio', 'capture requires an absolute file path'))
  }
  return Effect.succeed({ ...request, executable })
}

/**
 * Dd appends a bounded UTF-8 chunk without buffering the complete capture file.
 *
 * @param {AppendRequest} request Capture file, chunk, and capability-granted coreutils executable.
 * @returns {Effect.Effect} A scoped append that waits for the native writer to finish.
 */
export const append = (request: AppendRequest): Effect.Effect<undefined, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const validated = yield* validatePaths(request)
    const { file, text } = validated
    const result = yield* Deferred.make<ExitResult>()
    const lifecycle = { exited: MutableRef.make(false), result }
    const writer = yield* Effect.acquireRelease(startWriter(validated, lifecycle), (child) =>
      releaseWriter(file, child, lifecycle),
    )
    yield* Effect.try({
      catch: (cause) => platformFailure({ cause, method: 'append', module: 'Stdio', path: file }),
      try: () => {
        writer.write(text)
        writer.end()
      },
    })
    const exit = yield* Deferred.await(result)
    if (exit.code !== successfulExitCode) {
      return yield* Effect.fail(platformFailure({ cause: exit, method: 'append', module: 'Stdio', path: file }))
    }
  }).pipe(Effect.scoped)
