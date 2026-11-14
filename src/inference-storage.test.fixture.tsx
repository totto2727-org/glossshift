import { createHash } from 'crypto'

import { Array, Config, Deferred, Effect, Fiber, FileSystem, Path, Sink, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { mount, signal, Text } from 'nsh'

import { defaultModel } from '../runtime/config'
import { resolveModel } from '../runtime/model'
import { layer } from '../runtime/platform.ts'

type Reply = { readonly code: number; readonly status: string; readonly content?: string; readonly pending?: boolean }

const acceptance = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const actual = yield* ChildProcessSpawner.ChildProcessSpawner
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'model-storage-' })
    const bytes = 'synthetic verified GGUF artifact, not inference weights'
    const digest = createHash('sha256').update(bytes).digest('hex')
    const target = path.join(directory, `${digest}.gguf`)
    const resume = `${target}.part`
    const config = {
      sourceLanguage: 'auto',
      cacheDirectory: directory,
      contextSize: 2048,
      maxTokens: 512,
      model: { ...defaultModel, uri: 'https://example.invalid/synthetic.gguf', sha256: digest },
    }
    let transfers = 0
    let closes = 0
    let observedResume = false
    let mode: 'resume' | 'ignore' | 'corrupt416' | 'corrupt' | 'cancel' | 'missing' = 'resume'
    const started = yield* Deferred.make<void>()
    const service = ChildProcessSpawner.make((command) => {
      if (command._tag !== 'StandardCommand' || !command.command.endsWith('curl')) return actual.spawn(command)
      return Effect.gen(function* () {
        transfers += 1
        const args = Array.map(command.args, (argument) => (typeof argument === 'string' ? argument : ''))
        const outputIndex = args.indexOf('--output')
        const output = args[outputIndex + 1]
        if (output === undefined) return yield* Effect.die('Missing private curl output')
        const resuming = args.includes('--continue-at')
        observedResume ||= resuming
        let reply: Reply
        if (mode === 'missing') reply = { code: 22, status: '404' }
        else if (mode === 'corrupt416') reply = { code: 22, status: '416' }
        else if (mode === 'ignore' && resuming) reply = { code: 33, status: '200' }
        else if (mode === 'corrupt') reply = { code: 0, status: '200', content: 'corrupt bytes' }
        else if (mode === 'cancel') reply = { code: 0, status: '206', content: 'partial bytes', pending: true }
        else reply = { code: 0, status: resuming ? '206' : '200', content: bytes }
        if (reply.content !== undefined) yield* fs.writeFileString(output, reply.content, { mode: 0o600 })
        const result = reply
        const handle = yield* Effect.acquireRelease(
          Effect.succeed(
            ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: result.pending ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
              isRunning: Effect.succeed(result.pending === true),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: result.pending ? Stream.never : Stream.succeed(new TextEncoder().encode(result.status)),
              stderr: result.pending ? Stream.never : Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            }),
          ),
          () =>
            Effect.gen(function* () {
              closes += 1
              if (result.pending && (yield* fs.exists(resume)))
                return yield* Effect.die('Resume preserved before transfer closed')
            }).pipe(Effect.orDie),
        )
        if (result.pending) yield* Deferred.succeed(started, undefined)
        return handle
      })
    })
    const resolve = resolveModel(config).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, service))
    const require = (condition: boolean, message: string) => (condition ? Effect.void : Effect.die(message))
    const failureCode = resolve.pipe(
      Effect.as('success'),
      Effect.catch((error) => Effect.succeed(error.code)),
    )

    yield* fs.writeFileString(resume, bytes.slice(0, 10), { mode: 0o600 })
    yield* resolve
    yield* require(observedResume && transfers === 1, 'Resume byte range not requested')
    yield* require((yield* fs.readFileString(target)) === bytes, 'Verified bytes missing')
    yield* resolve
    yield* require(transfers === 1, 'Cache hit contacted download utility')
    yield* fs.remove(target)

    mode = 'ignore'
    yield* fs.writeFileString(resume, 'obsolete', { mode: 0o600 })
    yield* resolve
    yield* require((yield* fs.readFileString(target)) === bytes, 'Ignored range did not restart')
    yield* fs.remove(target)

    mode = 'corrupt416'
    yield* fs.writeFileString(resume, 'corrupt partial', { mode: 0o600 })
    yield* require((yield* failureCode) === 'IntegrityMismatch', 'Corrupt completed partial was accepted')
    yield* require(!(yield* fs.exists(resume)), 'Corrupt completed partial poisoned retry')
    mode = 'resume'
    yield* resolve
    yield* fs.remove(target)

    mode = 'corrupt'
    yield* require((yield* failureCode) === 'IntegrityMismatch', 'Corrupt transfer was accepted')
    yield* require(!(yield* fs.exists(target)) && !(yield* fs.exists(resume)), 'Corrupt bytes were published')

    mode = 'missing'
    const noticeResult = yield* resolveModel({ ...config, model: defaultModel }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, service),
      Effect.as('success'),
      Effect.catch((error) => Effect.succeed(error.code)),
    )
    yield* require(noticeResult === 'ModelUnavailable', 'Default model notice blocked the download boundary')

    mode = 'cancel'
    const before = closes
    const fiber = yield* resolve.pipe(Effect.forkScoped)
    yield* Deferred.await(started).pipe(Effect.timeout(5000))
    yield* Fiber.interrupt(fiber).pipe(Effect.timeout(2000))
    yield* require(closes > before, 'Cancelled transfer scope did not close')
    yield* require((yield* fs.readFileString(resume)) === 'partial bytes', 'Cancelled bytes were not preserved')
    yield* require(!(yield* fs.exists(target)), 'Cancelled model was published')
    const executable = yield* Config.String('GLOSSSHIFT_COREUTILS')
    const cancelledChild = yield* Effect.scoped(
      actual.spawn(ChildProcess.make(executable, ['--coreutils-prog=sleep', '30'], { stdin: 'ignore' })),
    )
    yield* require(!(yield* cancelledChild.isRunning), 'Child scope returned before actual exit callback')
    const failedChild = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* actual.spawn(ChildProcess.make(executable, ['--coreutils-prog=yes'], { stdin: 'ignore' }))
        yield* child.exitCode.pipe(Effect.flip, Effect.timeout(5000))
        return child
      }),
    )
    yield* require(!(yield* failedChild.isRunning), 'Output failure released scope before actual child exit')
    return 'Model storage acceptance passed'
  }),
)

mount(() => {
  const status = signal('Model storage acceptance running')
  Effect.runFork(
    acceptance.pipe(
      Effect.provide(layer),
      Effect.tap((message) => Effect.sync(() => status.set(message))),
      Effect.catchCause((cause) => Effect.sync(() => status.set(`Model storage acceptance failed: ${cause}`))),
    ),
  )
  return <Text>{status()}</Text>
})
