import process from 'process'

import { Array, Cause, Deferred, Effect, Layer, PlatformError, Queue, Record, Redacted, Sink, Stream } from 'effect'
import { ChildProcessSpawner } from 'effect/process'

import { failure, unsupported } from './errors.ts'

/** NSH controls the inherited environment by manifest, not per spawn, and always kills the process tree. */
export const service = ChildProcessSpawner.make((command) =>
  Effect.gen(function* () {
    if (command._tag !== 'StandardCommand' || command.options.shell || command.options.additionalFds !== undefined)
      return yield* Effect.fail(unsupported('ChildProcess', 'pipelines, shell, or extra descriptors'))
    if (command.options.stdin !== undefined && command.options.stdin !== 'ignore')
      return yield* Effect.fail(unsupported('ChildProcess', 'binary process stdin'))
    const inherited = process.env
    if (
      command.options.env !== undefined &&
      Array.some(
        Record.toEntries(command.options.env),
        ([name, value]) =>
          inherited[name] !== (typeof value === 'string' || value === undefined ? value : Redacted.value(value)),
      )
    )
      return yield* Effect.fail(unsupported('ChildProcess', 'per-spawn environment overrides'))
    if (
      Array.some(
        [command.options.stdout, command.options.stderr],
        (output) => output !== undefined && output !== 'pipe' && output !== 'ignore',
      )
    )
      return yield* Effect.fail(unsupported('ChildProcess', 'inherited or redirected descriptors'))
    const stdout = yield* Queue.bounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(128)
    const stderr = yield* Queue.bounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(128)
    const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>()
    const actualExit = yield* Deferred.make<void>()
    let running = true
    let stdoutBytes = 0
    let stderrBytes = 0
    const child = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          process.spawn(
            command.command,
            Array.map(command.args, (argument) => (typeof argument === 'string' ? argument : Redacted.value(argument))),
            {
              ...(command.options.cwd === undefined ? {} : { cwd: command.options.cwd }),
              stdin: 'null',
            },
          ),
        catch: (cause) => failure('spawn', command.command, cause),
      }),
      (child) =>
        Effect.gen(function* () {
          if (running)
            yield* Effect.try({
              try: () => child.kill(),
              catch: (cause) => failure('kill', command.command, cause),
            }).pipe(Effect.ignore)
          yield* Deferred.await(actualExit).pipe(Effect.timeoutOption(1000), Effect.ignore)
          yield* Effect.sync(() => child.dispose())
        }),
    )
    const fail = (error: PlatformError.PlatformError) => {
      Queue.failCauseUnsafe(stdout, Cause.fail(error))
      Queue.failCauseUnsafe(stderr, Cause.fail(error))
      Deferred.doneUnsafe(exited, Effect.fail(error))
      child.kill()
    }
    const observe = (kind: 'stdout' | 'stderr', text: string) => {
      if (command.options[kind] === 'ignore') return
      const bytes = new TextEncoder().encode(text)
      const queued = kind === 'stdout' ? stdoutBytes : stderrBytes
      if (queued + bytes.byteLength > 1024 * 1024 || !Queue.offerUnsafe(kind === 'stdout' ? stdout : stderr, bytes)) {
        fail(
          PlatformError.systemError({
            _tag: 'BadResource',
            module: 'ChildProcess',
            method: 'output',
            description: 'Private child output exceeded its bounded queue.',
          }),
        )
        return
      }
      if (kind === 'stdout') stdoutBytes += bytes.byteLength
      else stderrBytes += bytes.byteLength
    }
    child.on('stdout', (text) => observe('stdout', text))
    child.on('stderr', (text) => observe('stderr', text))
    child.on('exit', (result) => {
      running = false
      Deferred.doneUnsafe(actualExit, Effect.void)
      if (result.error !== undefined && result.error !== null) {
        const error = failure('exit', command.command, result.error)
        Queue.failCauseUnsafe(stdout, Cause.fail(error))
        Queue.failCauseUnsafe(stderr, Cause.fail(error))
        Deferred.doneUnsafe(exited, Effect.fail(error))
      } else {
        Queue.endUnsafe(stdout)
        Queue.endUnsafe(stderr)
        Deferred.doneUnsafe(exited, Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 128)))
      }
    })
    const out = Stream.fromQueue(stdout).pipe(
      Stream.tap((bytes) =>
        Effect.sync(() => {
          stdoutBytes -= bytes.byteLength
        }),
      ),
    )
    const err = Stream.fromQueue(stderr).pipe(
      Stream.tap((bytes) =>
        Effect.sync(() => {
          stderrBytes -= bytes.byteLength
        }),
      ),
    )
    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(child.pid),
      exitCode: Deferred.await(exited),
      isRunning: Effect.sync(() => running),
      kill: () =>
        Effect.try({
          try: () => {
            if (running) child.kill()
          },
          catch: (cause) => failure('kill', command.command, cause),
        }),
      stdin: Sink.forEach(() => Effect.fail(unsupported('ChildProcess', 'binary process stdin'))),
      stdout: out,
      stderr: err,
      all: Stream.merge(out, err),
      getInputFd: () => Sink.forEach(() => Effect.fail(unsupported('ChildProcess', 'extra descriptors'))),
      getOutputFd: () => Stream.fail(unsupported('ChildProcess', 'extra descriptors')),
      unref: Effect.fail(unsupported('ChildProcess', 'unref')),
    })
  }),
)

export const layer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, service)
