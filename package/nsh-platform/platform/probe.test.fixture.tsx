import { Predicate, Config, ConfigProvider, Console, Effect, Result, FileSystem, Path, Stdio, Stream } from 'effect'
import { mount, signal, Text } from 'nsh'

import { verifyCompositions } from './composition.test.fixture.ts'
import * as NshConfigProvider from './nsh-config-provider.ts'
import * as NshFileSystem from './nsh-file-system.ts'
import * as NshPath from './nsh-path.ts'
import * as NshStdio from './nsh-stdio.ts'

const importProvider = ConfigProvider.fromEnvRecord({ PLATFORM_PROBE: 'synthetic' })
const diagnosticNotice = 'Standalone platform diagnostic'

type ShowStage = (stage: string) => void

const verifyDefaultServices = (stage: ShowStage): Effect.Effect<void, Config.ConfigError, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    stage('Stage path')
    if (path.resolve('child') !== '/synthetic/child') {
      return yield* Effect.die('Path resolution failed')
    }
    stage('Stage config')
    const value = yield* Config.String('PLATFORM_PROBE').pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, importProvider),
    )
    if (value !== 'synthetic') {
      return yield* Effect.die('Config provider failed')
    }
  })

const requireFailure = <A, E, R>(work: Effect.Effect<A, E, R>, message: string): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const result = yield* Effect.result(work)
    if (!Result.isFailure(result)) {
      return yield* Effect.die(message)
    }
  })

const syntheticModel = '/synthetic/model.gguf'
const forbiddenFile = '/synthetic/not-a-real-file'
const ownerReadWriteMode = 0o600

const verifyFilesystem = (stage: ShowStage): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    stage('Stage open')
    yield* requireFailure(Effect.scoped(fs.open(syntheticModel)), 'Unsupported open succeeded')
    stage('Stage streaming')
    yield* requireFailure(Stream.runDrain(fs.stream(syntheticModel)), 'Unsupported streaming succeeded')
    yield* requireFailure(fs.readFile(forbiddenFile), 'Native filesystem unexpectedly read a synthetic path')
    const unsupportedMode = fs.writeFileString(forbiddenFile, 'synthetic', { mode: ownerReadWriteMode })
    yield* requireFailure(unsupportedMode, 'Unsupported secure mode succeeded')
  })

const verifyUnavailableStdio = (stage: ShowStage): Effect.Effect<void, never, Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    stage('Stage stdin')
    yield* requireFailure(Stream.runDrain(stdio.stdin), 'Unsupported stdin succeeded')
    const stdout = Stream.run(Stream.make('synthetic'), stdio.stdout())
    yield* requireFailure(stdout, 'Unsupported stdout succeeded')
  })

const logFixture = Effect.gen(function* () {
  const hostConsole = yield* Console.Console
  const observed = { diagnostic: '' }
  const stdio = yield* Stdio.Stdio
  const stream = Stream.succeed(`${diagnosticNotice}\n`)
  const logger = {
    ...hostConsole,
    error: (...args: Readonly<unknown[]>): void => {
      const [message] = args
      if (Predicate.isString(message)) {
        observed.diagnostic = message
      }
      hostConsole.error(...args)
    },
  }
  yield* Stream.run(stream, stdio.stderr({ endOnDone: false })).pipe(Effect.provideService(Console.Console, logger))
  if (observed.diagnostic !== `${diagnosticNotice}\n`) {
    return yield* Effect.die('Diagnostic was not delivered to host logger')
  }
})

const verifyRejectedBytes = (bytes: Uint8Array, fixture: string): Effect.Effect<void, never, Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const testBytes = Stream.succeed(bytes)
    const output = Stream.run(testBytes, stdio.stderr())
    const outcome = yield* Effect.result(output)
    if (!Result.isFailure(outcome)) {
      return yield* Effect.die(`${fixture} UTF-8 diagnostic did not fail`)
    }
    if (outcome.failure.reason.module !== 'Stdio') {
      return yield* Effect.die(`${fixture} UTF-8 diagnostic reported the wrong service`)
    }
  })

const invalidUtf8 = 255
const incompleteUtf8 = 227
const verifyDiagnostics = Effect.gen(function* () {
  yield* logFixture
  const stdio = yield* Stdio.Stdio
  const encoded = new TextEncoder().encode('Synthetic host diagnostic')
  yield* Stream.run(Stream.succeed(encoded), stdio.stderr())
  yield* verifyRejectedBytes(new Uint8Array([invalidUtf8]), 'Invalid')
  yield* verifyRejectedBytes(new Uint8Array([incompleteUtf8]), 'Incomplete')
})

mount(() => {
  const status = signal('Platform probe running')
  const fs = NshFileSystem.layer()
  const path = NshPath.make('/synthetic')
  const stdio = NshStdio.unavailable([])
  const probe = Effect.gen(function* () {
    yield* verifyCompositions
    yield* verifyDefaultServices(status.set)
    yield* verifyFilesystem(status.set)
    yield* verifyUnavailableStdio(status.set)
    yield* verifyDiagnostics
    status.set('Platform probe passed')
  })
  const program = probe.pipe(
    Effect.provide(fs),
    Effect.provide(path),
    Effect.provide(NshConfigProvider.layer),
    Effect.provide(stdio),
    Effect.catchCause((cause) => Effect.sync(() => status.set(`Platform probe failed at ${status()}: ${cause}`))),
  )
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native fixture mounts before it can start the test workflow.
  Effect.runFork(program)
  return <Text>{status()}</Text>
})
