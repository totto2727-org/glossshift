import process from 'process'

import { Deferred, Effect, Fiber, FileSystem, Option, Stdio, Stream } from 'effect'
import { ChildProcess } from 'effect/process'
import { mount, signal, Text } from 'nsh'

import { append } from './capture-output.ts'
import { layer, NshStdio } from './index.ts'

const checkDelayedCaptureRelease = (writeFails: boolean) =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    let order = ''
    let onExit: (result: import('process').ExitResult) => void = () => {
      throw new Error('Missing exit listener')
    }
    const task = yield* append('/synthetic-capture', 'synthetic', () => ({
      on: (_event, handler) => {
        onExit = handler
      },
      write: () => {
        Effect.runSync(Deferred.succeed(started, undefined))
        if (writeFails) throw new Error('Synthetic write failure')
      },
      end: () => {},
      kill: () => {
        order += 'kill,'
        setTimeout(() => {
          order += 'exit,'
          onExit({ code: null, signal: 'SIGTERM' })
        }, 30)
      },
      dispose: () => {
        order += 'dispose'
      },
    })).pipe(Effect.result, Effect.forkChild)
    yield* Deferred.await(started)
    if (writeFails) yield* Fiber.join(task)
    else yield* Fiber.interrupt(task)
    if (order !== 'kill,exit,dispose') return yield* Effect.die(`Capture cleanup preceded native exit: ${order}`)
  })

mount(() => {
  const status = signal('Secure filesystem probe running')
  Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* checkDelayedCaptureRelease(false)
        yield* checkDelayedCaptureRelease(true)
        const fs = yield* FileSystem.FileSystem
        const executable = process.env['GLOSSSHIFT_COREUTILS']
        if (executable === undefined) return yield* Effect.die('Packaged executable missing')
        const child = yield* ChildProcess.make(executable, ['--coreutils-prog=printf', '%s', 'synthetic-child'], {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: {},
        })
        const [childOutput, , code] = yield* Effect.all(
          [
            child.stdout.pipe(
              Stream.decodeText(),
              Stream.runFold(
                () => '',
                (text, chunk) => text + chunk,
              ),
            ),
            child.stderr.pipe(Stream.runDrain),
            child.exitCode,
          ],
          { concurrency: 'unbounded' },
        )
        if (childOutput !== 'synthetic-child' || Number(code) !== 0)
          return yield* Effect.die('Integrated child process service failed')
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'acceptance-' })
        const dirStat = yield* fs.stat(directory)
        if ((dirStat.mode & 0o777) !== 0o700) return yield* Effect.die('Temporary directory was not 0700')
        const file = yield* fs.makeTempFileScoped({ directory, suffix: '.txt' })
        const initial = yield* fs.stat(file)
        if ((initial.mode & 0o777) !== 0o600) return yield* Effect.die('Temporary file was not 0600')
        yield* fs.writeFileString(file, 'synthetic こんにちは', { mode: 0o600 })
        if ((yield* fs.readFileString(file)) !== 'synthetic こんにちは') return yield* Effect.die('Read/write mismatch')
        yield* fs.access(file, { readable: true, writable: true })
        const exclusive = `${directory}/exclusive.txt`
        yield* fs.writeFileString(exclusive, 'original', { flag: 'wx', mode: 0o600 })
        const collision = yield* Effect.result(fs.writeFileString(exclusive, 'replacement', { flag: 'wx' }))
        if (collision._tag !== 'Failure' || collision.failure.reason._tag !== 'AlreadyExists')
          return yield* Effect.die('Exclusive collision not rejected')
        if ((yield* fs.readFileString(exclusive)) !== 'original')
          return yield* Effect.die('Exclusive write changed target')
        yield* fs.chmod(exclusive, 0o400)
        if (((yield* fs.stat(exclusive)).mode & 0o777) !== 0o400) return yield* Effect.die('chmod failed')
        const linked = `${directory}/linked.txt`
        yield* fs.link(exclusive, linked)
        if ((yield* fs.readFileString(linked)) !== 'original') return yield* Effect.die('Hard link mismatch')
        const identity = yield* fs.stat(exclusive)
        const linkedIdentity = yield* fs.stat(linked)
        if (
          identity.dev <= 0n ||
          Option.isNone(identity.ino) ||
          Option.isNone(identity.uid) ||
          Option.isNone(identity.gid)
        )
          return yield* Effect.die('Real identity metadata missing')
        if (
          Option.isNone(linkedIdentity.ino) ||
          identity.ino.value !== linkedIdentity.ino.value ||
          identity.dev !== linkedIdentity.dev
        )
          return yield* Effect.die('Hard links do not share real inode metadata')
        const symbolic = `${directory}/symbolic.txt`
        yield* fs.symlink(exclusive, symbolic)
        if ((yield* fs.lstat(symbolic)).type !== 'SymbolicLink') return yield* Effect.die('lstat missed symlink')
        if ((yield* fs.readLink(symbolic)) !== exclusive) return yield* Effect.die('readLink mismatch')
        const symbolicCollision = yield* Effect.result(fs.writeFileString(symbolic, 'replacement', { flag: 'wx' }))
        if (symbolicCollision._tag !== 'Failure') return yield* Effect.die('wx replaced a symlink')
        yield* fs.writeFileString(symbolic, 'replacement')
        if ((yield* fs.readFileString(exclusive)) !== 'original')
          return yield* Effect.die('Forced replacement altered symlink target')
        if ((yield* fs.lstat(symbolic)).type !== 'File') return yield* Effect.die('Forced replacement retained symlink')
        const whitespaceRoot = `${directory}/ trailing root \t`
        yield* fs.makeDirectory(whitespaceRoot, { mode: 0o700 })
        const whitespaceFile = yield* fs.makeTempFileScoped({
          directory: whitespaceRoot,
          prefix: ' leading ',
          suffix: ' \t',
        })
        if (!whitespaceFile.endsWith(' \t') || !(yield* fs.exists(whitespaceFile)))
          return yield* Effect.die('mktemp corrupted trailing whitespace')
        if ((yield* fs.realPath(whitespaceFile)) !== whitespaceFile)
          return yield* Effect.die('realPath corrupted trailing whitespace')
        const newlineFile = `${directory}/file with newline\n`
        yield* fs.writeFileString(newlineFile, 'synthetic newline path')
        if ((yield* fs.realPath(newlineFile)) !== newlineFile)
          return yield* Effect.die('realPath corrupted newline filename')
        const ambiguousTempRoot = yield* Effect.result(fs.makeTempFile({ directory: `${directory}\n` }))
        if (ambiguousTempRoot._tag !== 'Failure' || ambiguousTempRoot.failure.reason._tag !== 'BadArgument')
          return yield* Effect.die('mktemp accepted newline root')
        const canonical = yield* fs.realPath(file)
        if (!(yield* fs.exists(canonical))) return yield* Effect.die('realPath missing')
        const nested = `${directory}/nested`
        yield* fs.makeDirectory(nested, { mode: 0o700 })
        if (((yield* fs.stat(nested)).mode & 0o777) !== 0o700) return yield* Effect.die('Directory mode mismatch')
        yield* fs.copyFile(file, `${nested}/copy.txt`)
        if ((yield* fs.readFileString(`${nested}/copy.txt`)) !== 'synthetic こんにちは')
          return yield* Effect.die('Copy mismatch')
        const entries = yield* fs.readDirectoryEntries(nested)
        if (entries.length !== 1 || entries[0]?.type !== 'File') return yield* Effect.die('Directory entries mismatch')
        const stdout = `${directory}/stdout.txt`
        const stderr = `${directory}/stderr.txt`
        yield* fs.writeFileString(stdout, '', { flag: 'wx' })
        yield* fs.writeFileString(stderr, '', { flag: 'wx' })
        yield* Effect.gen(function* () {
          const io = yield* Stdio.Stdio
          if (yield* io.stdoutIsTerminal) return yield* Effect.die('Redirected capture reported a terminal')
          yield* Stream.run(Stream.make('first ', 'こんにちは\n'), io.stdout())
          yield* Stream.run(Stream.make('diagnostic'), io.stderr())
        }).pipe(Effect.provide(NshStdio.capture({ args: ['synthetic'], stdout, stderr, stdoutIsTerminal: false })))
        yield* Effect.gen(function* () {
          const io = yield* Stdio.Stdio
          if (!(yield* io.stdoutIsTerminal)) return yield* Effect.die('Explicit terminal capture lost TTY status')
        }).pipe(Effect.provide(NshStdio.capture({ args: [], stdout, stderr, stdoutIsTerminal: true })))
        if ((yield* fs.readFileString(stdout)) !== 'first こんにちは\n')
          return yield* Effect.die('Capture append mismatch')
        if ((yield* fs.readFileString(stderr)) !== 'diagnostic') return yield* Effect.die('Capture stderr mismatch')
        const scoped = yield* Effect.scoped(fs.makeTempDirectoryScoped({ directory }))
        if (yield* fs.exists(scoped)) return yield* Effect.die('Scoped temporary cleanup failed')
        return directory
      }),
    ).pipe(
      Effect.provide(layer),
      Effect.flatMap((directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          if (yield* fs.exists(directory)) return yield* Effect.die('Root scoped cleanup failed')
          status.set('Secure filesystem and capture acceptance passed')
        }).pipe(Effect.provide(layer)),
      ),
      Effect.catchCause((cause) => Effect.sync(() => status.set(`Secure filesystem probe failed: ${cause}`))),
    ),
  )
  return <Text>{status()}</Text>
})
