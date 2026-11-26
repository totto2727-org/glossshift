// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import process, { spawn } from 'process'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- NSH's native process handle types come from the unprefixed module.
import type { ChildProcess as NativeChild, ExitResult } from 'process'

import {
  Predicate,
  Array,
  Cause,
  Deferred,
  Effect,
  Layer,
  MutableRef,
  Queue,
  Record,
  Redacted,
  Sink,
  Stream,
} from 'effect'
import type { PlatformError, Scope } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import type { ChildProcess } from 'effect/process'

import { platformFailure, unsupported, systemError } from './errors.ts'

const maxOutputChunks = 128
const maxOutputBytes = 1_048_576
const interruptedExitCode = 128
const initialQueuedBytes = 0
const utf8 = new TextEncoder()

const openOutput = Effect.gen(function* () {
  const queue = yield* Queue.bounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(maxOutputChunks)
  const queuedBytes = MutableRef.make(initialQueuedBytes)
  const receive = (text: string): boolean => {
    const bytes = utf8.encode(text)
    if (MutableRef.get(queuedBytes) + bytes.byteLength > maxOutputBytes || !Queue.offerUnsafe(queue, bytes)) {
      return false
    }
    MutableRef.update(queuedBytes, (total) => total + bytes.byteLength)
    return true
  }
  const stream = Stream.fromQueue(queue).pipe(
    Stream.tap((bytes) => Effect.sync(() => MutableRef.update(queuedBytes, (total) => total - bytes.byteLength))),
  )
  return { queue, receive, stream }
})

type OutputState = Effect.Success<typeof openOutput>

const unsupportedOutput = (output: ChildProcess.CommandOptions['stdout']): boolean =>
  Predicate.isNotNullish(output) && output !== 'pipe' && output !== 'ignore'

const supportsEnvironment = (options: ChildProcess.CommandOptions): boolean => {
  if (Predicate.isNullish(options.env)) {
    return true
  }
  const inherited = process.env
  return Array.every(
    Record.toEntries(options.env),
    ([name, value]) =>
      inherited[name] === (Predicate.isString(value) || Predicate.isNullish(value) ? value : Redacted.value(value)),
  )
}

const terminationOptions = (options?: Pick<ChildProcess.CommandOptions, 'killSignal' | 'forceKillAfter'>): boolean =>
  Predicate.isNotNullish(options?.killSignal) || Predicate.isNotNullish(options?.forceKillAfter)

const denied = (feature: string): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(unsupported('ChildProcess', feature))

const validateEnvironmentAndOutput = (
  options: ChildProcess.CommandOptions,
): Effect.Effect<void, PlatformError.PlatformError> => {
  if (!supportsEnvironment(options)) {
    return denied('per-spawn environment overrides')
  }
  if (unsupportedOutput(options.stdout) || unsupportedOutput(options.stderr)) {
    return denied('inherited or redirected descriptors')
  }
  return Effect.void
}

const validateOptions = (options: ChildProcess.CommandOptions): Effect.Effect<void, PlatformError.PlatformError> => {
  if (terminationOptions(options)) {
    return denied('custom termination signals or deadlines')
  }
  if (Predicate.isNotNullish(options.detached)) {
    return denied('custom process detachment')
  }
  if (Predicate.isNotNullish(options.env) && options.extendEnv !== true) {
    return denied('replacing the inherited environment')
  }
  if (Predicate.isNotNullish(options.stdin) && options.stdin !== 'ignore') {
    return denied('binary process stdin')
  }
  return validateEnvironmentAndOutput(options)
}

const validateCommand = (
  command: ChildProcess.Command,
): Effect.Effect<ChildProcess.StandardCommand, PlatformError.PlatformError> =>
  !Predicate.isTagged('StandardCommand')(command) ||
  command.options.shell ||
  !Predicate.isNullish(command.options.additionalFds)
    ? denied('pipelines, shell, or extra descriptors')
    : validateOptions(command.options).pipe(Effect.as(command))

const openProcess = Effect.gen(function* () {
  const stdout = yield* openOutput
  const stderr = yield* openOutput
  const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>()
  const actualExit = yield* Deferred.make<true>()
  return { actualExit, exited, running: MutableRef.make(true), stderr, stdout }
})

type ProcessState = Effect.Success<typeof openProcess>

const killRunning = (
  name: string,
  child: NativeChild,
  running: MutableRef.MutableRef<boolean>,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.try({
    catch: (cause) => platformFailure({ cause, method: 'kill', module: 'ChildProcess', path: name }),
    try: () => {
      if (MutableRef.get(running)) {
        child.kill()
      }
    },
  })

const releaseChild = (name: string, child: NativeChild, state: ProcessState): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* killRunning(name, child, state.running).pipe(Effect.ignore)
    yield* Deferred.await(state.actualExit)
    yield* Effect.sync(() => child.dispose())
  })

const startChild = (command: ChildProcess.StandardCommand): Effect.Effect<NativeChild, PlatformError.PlatformError> =>
  Effect.try({
    catch: (cause) => platformFailure({ cause, method: 'spawn', module: 'ChildProcess', path: command.command }),
    try: () => {
      const args = Array.map(command.args, (argument) =>
        Predicate.isString(argument) ? argument : Redacted.value(argument),
      )
      const { cwd } = command.options
      return spawn(command.command, args, {
        ...(Predicate.isNullish(cwd) ? {} : { cwd }),
        stdin: 'null',
      })
    },
  })

const failProcess = (state: ProcessState, error: PlatformError.PlatformError): void => {
  const cause = Cause.fail(error)
  Queue.failCauseUnsafe(state.stdout.queue, cause)
  Queue.failCauseUnsafe(state.stderr.queue, cause)
  Deferred.doneUnsafe(state.exited, Effect.fail(error))
}

const outputExceeded = (): PlatformError.PlatformError =>
  systemError('BadResource', {
    description: 'Private child output exceeded its bounded queue.',
    method: 'output',
    module: 'ChildProcess',
  })

const observeOutput = (child: NativeChild, options: ChildProcess.CommandOptions, state: ProcessState): void => {
  const observe = (kind: 'stdout' | 'stderr', output: OutputState, text: string): void => {
    if (options[kind] !== 'ignore' && !output.receive(text)) {
      failProcess(state, outputExceeded())
      child.kill()
    }
  }
  child.on('stdout', (text) => observe('stdout', state.stdout, text))
  child.on('stderr', (text) => observe('stderr', state.stderr, text))
}

const observeExit = (name: string, state: ProcessState, result: ExitResult): void => {
  MutableRef.set(state.running, false)
  Deferred.doneUnsafe(state.actualExit, Effect.succeed(true))
  if (Predicate.isNotNullish(result.error)) {
    failProcess(state, platformFailure({ cause: result.error, method: 'exit', module: 'ChildProcess', path: name }))
  } else {
    Queue.endUnsafe(state.stdout.queue)
    Queue.endUnsafe(state.stderr.queue)
    Deferred.doneUnsafe(state.exited, Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? interruptedExitCode)))
  }
}

const handleFor = (child: NativeChild, name: string, state: ProcessState): ChildProcessSpawner.ChildProcessHandle =>
  ChildProcessSpawner.makeHandle({
    all: Stream.merge(state.stdout.stream, state.stderr.stream),
    exitCode: Deferred.await(state.exited),
    getInputFd: () => Sink.forEach(() => denied('extra descriptors')),
    getOutputFd: () => Stream.fail(unsupported('ChildProcess', 'extra descriptors')),
    isRunning: Effect.sync(() => MutableRef.get(state.running)),
    kill: (options) =>
      terminationOptions(options)
        ? denied('custom termination signals or deadlines')
        : killRunning(name, child, state.running),
    pid: ChildProcessSpawner.ProcessId(child.pid),
    stderr: state.stderr.stream,
    stdin: Sink.forEach(() => denied('binary process stdin')),
    stdout: state.stdout.stream,
    unref: denied('unref'),
  })

/**
 * The manifest controls inherited variables, and termination applies to the process tree.
 *
 * @param {ChildProcess.Command} input Command requested by the consuming Effect program.
 * @returns {Effect.Effect} A native child handle owned by the current scope.
 */
const spawnChild = (
  input: ChildProcess.Command,
): Effect.Effect<ChildProcessSpawner.ChildProcessHandle, PlatformError.PlatformError, Scope.Scope> =>
  Effect.gen(function* () {
    const command = yield* validateCommand(input)
    const state = yield* openProcess
    const child = yield* Effect.acquireRelease(startChild(command), (nativeChild) =>
      releaseChild(command.command, nativeChild, state),
    )
    observeOutput(child, command.options, state)
    child.on('exit', (result) => observeExit(command.command, state, result))
    return handleFor(child, command.command, state)
  })

export const service = ChildProcessSpawner.make(spawnChild)
export const layer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, service)
