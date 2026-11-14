import * as native from 'fs/promises'
import process from 'process'

import { Config, ConfigProvider, Console, Effect, FileSystem, Path, Stdio, Stream } from 'effect'
import { mount, signal, Text } from 'nsh'

import { verifyCompositions } from './composition.test.fixture.ts'
import * as NshConfigProvider from './NshConfigProvider.ts'
import * as NshFileSystem from './NshFileSystem.ts'
import * as NshPath from './NshPath.ts'
import * as NshStdio from './NshStdio.ts'

const importProvider = ConfigProvider.fromEnvRecord({ PLATFORM_PROBE: 'synthetic' })
const diagnosticNotice = 'Standalone platform diagnostic'

mount(() => {
  const status = signal('Platform probe running')
  Effect.runFork(
    Effect.gen(function* () {
      yield* verifyCompositions
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const stdio = yield* Stdio.Stdio
      status.set('Stage path')
      if (path.resolve('child') !== '/synthetic/child') return yield* Effect.die('Path resolution failed')
      status.set('Stage config')
      const value = yield* Config.String('PLATFORM_PROBE').pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, importProvider),
      )
      if (value !== 'synthetic') return yield* Effect.die('Config provider failed')
      status.set('Stage open')
      const open = yield* Effect.result(Effect.scoped(fs.open('/synthetic/model.gguf')))
      if (open._tag !== 'Failure') return yield* Effect.die('Unsupported open succeeded')
      status.set('Stage streaming')
      const streaming = yield* Effect.result(Stream.runDrain(fs.stream('/synthetic/model.gguf')))
      if (streaming._tag !== 'Failure') return yield* Effect.die('Unsupported streaming succeeded')
      status.set('Stage stdin')
      const stdin = yield* Effect.result(Stream.runDrain(stdio.stdin))
      if (stdin._tag !== 'Failure') return yield* Effect.die('Unsupported stdin succeeded')
      const forbiddenRead = yield* Effect.result(fs.readFile('/synthetic/not-a-real-file'))
      if (forbiddenRead._tag !== 'Failure')
        return yield* Effect.die('Native filesystem unexpectedly read a synthetic path')
      const unsupportedMode = yield* Effect.result(
        fs.writeFileString('/synthetic/not-a-real-file', 'synthetic', { mode: 0o600 }),
      )
      if (unsupportedMode._tag !== 'Failure') return yield* Effect.die('Unsupported secure mode succeeded')
      const stdout = yield* Effect.result(Stream.run(Stream.make('synthetic'), stdio.stdout()))
      if (stdout._tag !== 'Failure') return yield* Effect.die('Unsupported stdout succeeded')
      const hostConsole = yield* Console.Console
      let diagnostic = ''
      yield* Stream.succeed(`${diagnosticNotice}\n`).pipe(
        Stream.run(stdio.stderr({ endOnDone: false })),
        Effect.provideService(Console.Console, {
          ...hostConsole,
          error: (...args: ReadonlyArray<unknown>) => {
            if (typeof args[0] === 'string') diagnostic = args[0]
            hostConsole.error(...args)
          },
        }),
      )
      if (diagnostic !== `${diagnosticNotice}\n`)
        return yield* Effect.die('Diagnostic was not delivered to host logger')
      yield* Stream.succeed(new TextEncoder().encode('Synthetic host diagnostic')).pipe(Stream.run(stdio.stderr()))
      const invalidDiagnostic = yield* Effect.result(
        Stream.succeed(new Uint8Array([0xff])).pipe(Stream.run(stdio.stderr())),
      )
      if (invalidDiagnostic._tag !== 'Failure') return yield* Effect.die('Invalid UTF-8 diagnostic did not fail')
      if (invalidDiagnostic.failure.reason.module !== 'Stdio')
        return yield* Effect.die('Invalid UTF-8 diagnostic reported the wrong service')
      const partialDiagnostic = yield* Effect.result(
        Stream.succeed(new Uint8Array([0xe3])).pipe(Stream.run(stdio.stderr())),
      )
      if (partialDiagnostic._tag !== 'Failure') return yield* Effect.die('Incomplete UTF-8 diagnostic did not fail')
      if (partialDiagnostic.failure.reason.module !== 'Stdio')
        return yield* Effect.die('Incomplete UTF-8 diagnostic reported the wrong service')
      const nativeKeys = Object.keys(native).sort().join(',')
      const processKeys = Object.keys(process).sort().join(',')
      status.set(`Platform probe passed\nfs:${nativeKeys}\nprocess:${processKeys}`)
    }).pipe(
      Effect.provide(NshFileSystem.layer()),
      Effect.provide(NshPath.make('/synthetic')),
      Effect.provide(NshConfigProvider.layer),
      Effect.provide(NshStdio.unavailable([])),
      Effect.catchCause((cause) => Effect.sync(() => status.set(`Platform probe failed at ${status()}: ${cause}`))),
    ),
  )
  return <Text>{status()}</Text>
})
