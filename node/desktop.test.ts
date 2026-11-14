import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { NodeServices } from '@effect/platform-node'
import { Array, ConfigProvider, Effect, FileSystem, Option, Path, Result, Schema, Sink, Stdio, String } from 'effect'
import * as ChildProcess from 'effect/process/ChildProcess'
import { ChildProcessSpawner } from 'effect/process/ChildProcessSpawner'
import * as plist from 'plist'

import { DesktopConfigurationJson } from '../src/desktop-settings.ts'
import { runAutostart } from './autostart.ts'
import { defaultDesktopConfig, loadDesktopConfig, parseDesktopConfig } from './desktop-config.ts'

const run = <A, E>(
  program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Stdio.Stdio | ChildProcessSpawner>,
) => Effect.runPromise(Effect.provide(program, NodeServices.layer))

const environment = (home: string, xdg = `${home}/config`) =>
  ConfigProvider.fromUnknown({ HOME: home, XDG_CONFIG_HOME: xdg }, { preserveEmptyStrings: true })

void test('actual private desktop commands emit only their contract and never load a model', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const spawner = yield* ChildProcessSpawner
        const home = yield* fs.makeTempDirectoryScoped()
        const entry = fileURLToPath(new URL('./main.ts', import.meta.url))
        const command = (args: ReadonlyArray<string>) =>
          ChildProcess.make(process.execPath, [entry, ...args], {
            env: { HOME: home, XDG_CONFIG_HOME: `${home}/config` },
            extendEnv: false,
          })
        const json = yield* spawner.string(command(['--desktop-config']))
        const loaded = yield* Schema.decodeUnknownEffect(DesktopConfigurationJson)(json)
        assert.equal(loaded.created_files, true)
        assert.equal(loaded.window.width, 560)
        assert.equal(
          yield* spawner.string(command(['--autostart', 'status'])),
          'Autostart not configured for next login.\n',
        )
        assert.equal(yield* fs.exists(`${home}/Library`), false)
        assert.equal(yield* fs.exists(`${home}/.cache`), false)
      }),
    ),
  )
})

void test('desktop config retains exact defaults and ignores unrelated TOML sections', async () => {
  const config = await run(
    parseDesktopConfig(
      `${defaultDesktopConfig}\n[providers.old]\nsecret = "unused"\nlegacy_limit = 9223372036854775807\n`,
    ),
  )
  assert.deepEqual(config, {
    shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'Japanese' }],
    window: { width: 560, height: 360, min_width: 320, min_height: 180 },
  })
})

void test('desktop config rejects invalid dimensions and empty targets', async () => {
  for (const [field, original] of [
    ['width', '560'],
    ['height', '360'],
    ['min_width', '320'],
    ['min_height', '180'],
  ]) {
    for (const value of ['nan', 'inf', '-inf', '2147483648', '0', '-1']) {
      await assert.rejects(
        run(parseDesktopConfig(defaultDesktopConfig.replace(`${field} = ${original}`, `${field} = ${value}`))),
      )
    }
  }
  await assert.rejects(run(parseDesktopConfig(defaultDesktopConfig.replace('width = 560', 'width = 100'))))
  await assert.rejects(run(parseDesktopConfig(defaultDesktopConfig.replace('"Ctrl+Super+KeyJ"', '""'))))
  await assert.rejects(run(parseDesktopConfig(defaultDesktopConfig.replace('"Japanese"', '"  "'))))
  await assert.rejects(
    run(parseDesktopConfig('shortcuts = []\n[window]\nwidth=560\nheight=360\nmin_width=320\nmin_height=180')),
  )
})

void test('desktop config publishes only complete application defaults and never overwrites', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const home = yield* fs.makeTempDirectoryScoped()
        const load = loadDesktopConfig.pipe(Effect.provideService(ConfigProvider.ConfigProvider, environment(home)))
        const first = yield* load
        assert.equal(first.created_files, true)
        const file = `${first.directory}/config.toml`
        assert.equal(yield* fs.readFileString(file), defaultDesktopConfig)
        assert.equal((yield* fs.stat(file)).mode & 0o777, 0o644)
        assert.deepEqual(yield* fs.readDirectory(first.directory), ['config.toml'])
        yield* fs.writeFileString(file, defaultDesktopConfig.replace('width = 560', 'width = 700'))
        const second = yield* load
        assert.equal(second.created_files, false)
        assert.equal(second.window.width, 700)
      }),
    ),
  )
})

void test('desktop config leaves destination symlinks and their targets unchanged', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const home = yield* fs.makeTempDirectoryScoped()
        const directory = `${home}/config/glossshift`
        yield* fs.makeDirectory(directory, { recursive: true })
        const target = `${home}/synthetic-settings`
        yield* fs.writeFileString(target, defaultDesktopConfig)
        yield* fs.symlink(target, `${directory}/config.toml`)
        const loaded = yield* loadDesktopConfig.pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, environment(home)),
        )
        assert.equal(loaded.created_files, false)
        assert.equal((yield* fs.lstat(`${directory}/config.toml`)).type, 'SymbolicLink')
        assert.equal(yield* fs.readFileString(target), defaultDesktopConfig)
      }),
    ),
  )
})

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const home = yield* fs.makeTempDirectoryScoped()
  const app = `${home}/日本語 & <bundle>.app`
  yield* fs.makeDirectory(`${app}/Contents/MacOS`, { recursive: true })
  yield* fs.writeFileString(
    `${app}/Contents/Info.plist`,
    plist.build({
      CFBundleIdentifier: 'com.totto2727.glossshift',
      CFBundleExecutable: 'GlossShift',
    }),
  )
  yield* fs.writeFileString(`${app}/Contents/MacOS/GlossShift`, 'synthetic, never execute')
  yield* fs.chmod(`${app}/Contents/MacOS/GlossShift`, 0o755)
  const directory = `${home}/Library/LaunchAgents`
  const destination = `${directory}/com.totto2727.glossshift.plist`
  let output = ''
  const command = (args: ReadonlyArray<string>, xdg = `${home}/config`) =>
    runAutostart(args).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, environment(home, xdg)),
      Effect.provide(
        Stdio.layerTest({
          stdout: () =>
            Sink.forEach((chunk: string | Uint8Array) =>
              Effect.sync(() => {
                output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
              }),
            ),
        }),
      ),
    )
  return { fs, home, app, directory, destination, command, output: () => output }
})

void test('actual autostart entry rejects explicitly empty XDG before creating registration', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, home, app, directory } = yield* fixture
        const spawner = yield* ChildProcessSpawner
        const entry = fileURLToPath(new URL('./main.ts', import.meta.url))
        const command = ChildProcess.make(process.execPath, [entry, '--autostart', 'enable', '--app', app], {
          env: { HOME: home, XDG_CONFIG_HOME: '' },
          extendEnv: false,
        })
        assert.notEqual(yield* spawner.exitCode(command), 0)
        assert.equal(yield* fs.exists(directory), false)
      }),
    ),
  )
})

void test('autostart is next-login-only, idempotent, escaped and removable after bundle deletion', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, home, app, directory, destination, command, output } = yield* fixture
        yield* command(['status'])
        yield* command(['disable'])
        assert.equal(yield* fs.exists(directory), false)
        yield* command(['enable', '--app', app])
        const text = yield* fs.readFileString(destination)
        assert.match(text, /&amp;/)
        assert.match(text, /&lt;/)
        assert.doesNotMatch(text, /KeepAlive/)
        assert.equal((yield* fs.stat(destination)).mode & 0o777, 0o600)
        assert.equal((yield* fs.stat(directory)).mode & 0o777, 0o700)
        yield* command(['enable', '--app', app], `${home}/new-config`)
        assert.match(yield* fs.readFileString(destination), /new-config/)
        assert.deepEqual(yield* fs.readDirectory(directory), ['com.totto2727.glossshift.plist'])
        yield* command(['status'])
        yield* fs.remove(app, { recursive: true })
        yield* command(['disable'])
        yield* command(['disable'])
        assert.equal(yield* fs.exists(destination), false)
        assert.equal(Array.contains(String.split(output(), '\n'), `Autostart configured for next login: ${app}`), true)
        assert.match(output(), /No application was launched\. macOS may require background-item approval\./)
        assert.match(output(), /Any running application is unchanged\./)
        assert.match(output(), /macOS authorization and running state are not checked\./)
      }),
    ),
  )
})

void test('autostart refuses duplicate XML and binary dictionary keys without changing registration', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, home, app, destination, command } = yield* fixture
        yield* command(['enable', '--app', app])
        const xml = yield* fs.readFileString(destination)
        const identifier = 'com.totto2727.glossshift'
        const duplicateXml = xml.replace(
          '<key>Label</key>',
          `<key>Label</key><string>${identifier}</string><key>Label</key>`,
        )
        const binary = Buffer.from(
          plist.buildBinary({
            Label: identifier,
            Other: identifier,
            ProgramArguments: ['/usr/bin/open', '-g', app, '--args', '--background'],
            RunAtLoad: true,
            LimitLoadToSessionType: 'Aqua',
            AssociatedBundleIdentifiers: [identifier],
            EnvironmentVariables: { XDG_CONFIG_HOME: `${home}/config` },
          }),
        )
        // Replace a same-length key in the encoded fixture to create a genuine duplicate.
        const key = binary.indexOf(Buffer.from('Other'))
        assert.ok(key >= 0)
        binary.set(Buffer.from('Label'), key)
        for (const data of [new TextEncoder().encode(duplicateXml), binary]) {
          yield* fs.writeFile(destination, data)
          for (const args of [['status'], ['disable'], ['enable', '--app', app]]) {
            assert.equal(Result.isFailure(yield* Effect.result(command(args))), true)
            assert.deepEqual(new Uint8Array(yield* fs.readFile(destination)), new Uint8Array(data))
          }
        }
      }),
    ),
  )
})

void test('autostart preserves stable bundle and executable symlinks', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, home, app, destination, command } = yield* fixture
        const stable = `${home}/Stable.app`
        yield* fs.symlink(app, stable)
        yield* fs.rename(`${app}/Contents/MacOS/GlossShift`, `${home}/executable`)
        yield* fs.symlink(`${home}/executable`, `${app}/Contents/MacOS/GlossShift`)
        yield* command(['enable', '--app', stable])
        const text = yield* fs.readFileString(destination)
        assert.match(text, /Stable.app/)
        yield* command(['status'])
        assert.equal(yield* fs.readFileString(destination), text)
      }),
    ),
  )
})

void test('autostart accepts binary bundle metadata and existing binary registrations', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, app, destination, command } = yield* fixture
        yield* fs.writeFile(
          `${app}/Contents/Info.plist`,
          plist.buildBinary({
            CFBundleIdentifier: 'com.totto2727.glossshift',
            CFBundleExecutable: 'GlossShift',
          }),
        )
        yield* command(['enable', '--app', app])
        const agent = plist.parse(yield* fs.readFileString(destination))
        yield* fs.writeFile(destination, plist.buildBinary(agent))
        yield* command(['status'])
        yield* command(['enable', '--app', app])
        yield* command(['disable'])
        assert.equal(yield* fs.exists(destination), false)
      }),
    ),
  )
})

void test('autostart rejects unsafe destinations and never modifies their targets', async () => {
  for (const unsafe of ['symlink', 'unrelated', 'permissions', 'command', 'environment', 'prototype', 'unknown']) {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, home, app, destination, command } = yield* fixture
          yield* command(['enable', '--app', app])
          const target = `${home}/unrelated`
          yield* fs.writeFileString(target, 'do not change')
          if (unsafe === 'symlink') {
            yield* fs.remove(destination)
            yield* fs.symlink(target, destination)
          } else if (unsafe === 'unrelated') yield* fs.writeFileString(destination, 'not a plist')
          else if (unsafe === 'permissions') yield* fs.chmod(destination, 0o666)
          else {
            const text = yield* fs.readFileString(destination)
            const modified =
              unsafe === 'command'
                ? text.replace('/usr/bin/open', '/bin/sh')
                : unsafe === 'environment'
                  ? text.replace('<key>XDG_CONFIG_HOME</key>', '<key>UNEXPECTED</key>')
                  : unsafe === 'prototype'
                    ? text.replace('<key>XDG_CONFIG_HOME</key>', '<key>__proto__</key>')
                    : text.replace('<key>RunAtLoad</key>', '<key>KeepAlive</key>')
            yield* fs.writeFileString(destination, modified)
          }
          const before = yield* fs.readFileString(destination)
          for (const args of [['status'], ['disable'], ['enable', '--app', app]]) {
            assert.equal(Result.isFailure(yield* Effect.result(command(args))), true, unsafe)
          }
          assert.equal(yield* fs.readFileString(destination), before)
          assert.equal(yield* fs.readFileString(target), 'do not change')
        }),
      ),
    )
  }
})

void test('autostart rejects relative paths, wrong bundles and unsafe directories before registration', async () => {
  for (const unsafe of [
    'relative-app',
    'relative-xdg',
    'empty-xdg',
    'nonexecutable',
    'identity',
    'symlink-directory',
    'directory-mode',
  ]) {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, home, app, directory, destination, command } = yield* fixture
          if (unsafe === 'nonexecutable') yield* fs.chmod(`${app}/Contents/MacOS/GlossShift`, 0o644)
          if (unsafe === 'identity')
            yield* fs.writeFileString(
              `${app}/Contents/Info.plist`,
              plist.build({
                CFBundleIdentifier: 'com.example.other',
                CFBundleExecutable: 'GlossShift',
              }),
            )
          if (unsafe === 'symlink-directory') {
            yield* fs.makeDirectory(`${home}/outside`)
            yield* fs.symlink(`${home}/outside`, `${home}/Library`)
          }
          if (unsafe === 'directory-mode') {
            yield* fs.makeDirectory(`${home}/Library`)
            yield* fs.chmod(`${home}/Library`, 0o777)
          }
          const args = ['enable', '--app', unsafe === 'relative-app' ? 'relative.app' : app]
          const xdg = unsafe === 'relative-xdg' ? 'relative' : unsafe === 'empty-xdg' ? '' : `${home}/config`
          assert.equal(Result.isFailure(yield* Effect.result(command(args, xdg))), true, unsafe)
          assert.equal(yield* fs.exists(destination), false)
          assert.equal(yield* fs.exists(directory), false)
        }),
      ),
    )
  }
})

void test('autostart refuses foreign-owned registration files and directories', async () => {
  for (const foreign of ['file', 'directory']) {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, home, app, directory, destination, command } = yield* fixture
          yield* command(['enable', '--app', app])
          const owner = Option.getOrThrow((yield* fs.stat(home)).uid)
          const before = yield* fs.readFileString(destination)
          const foreignPath = foreign === 'file' ? destination : directory
          // Changing actual ownership requires elevated privileges. Keep every operation real except this metadata field.
          const filesystem = {
            ...fs,
            lstat: (name: string) =>
              fs
                .lstat(name)
                .pipe(Effect.map((info) => (name === foreignPath ? { ...info, uid: Option.some(owner + 1) } : info))),
          }
          for (const args of [['status'], ['disable'], ['enable', '--app', app]]) {
            assert.equal(
              Result.isFailure(
                yield* Effect.result(command(args).pipe(Effect.provideService(FileSystem.FileSystem, filesystem))),
              ),
              true,
            )
          }
          assert.equal(yield* fs.readFileString(destination), before)
        }),
      ),
    )
  }
})

void test('desktop default publication never clobbers a concurrent creator', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const home = yield* fs.makeTempDirectoryScoped()
        const concurrent = defaultDesktopConfig.replace('width = 560', 'width = 720')
        const filesystem = {
          ...fs,
          link: (from: string, to: string) =>
            Effect.gen(function* () {
              yield* fs.writeFileString(to, concurrent)
              yield* fs.link(from, to)
            }),
        }
        const loaded = yield* loadDesktopConfig.pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, environment(home)),
          Effect.provideService(FileSystem.FileSystem, filesystem),
        )
        assert.equal(loaded.created_files, false)
        assert.equal(loaded.window.width, 720)
        assert.equal(yield* fs.readFileString(`${loaded.directory}/config.toml`), concurrent)
        assert.deepEqual(yield* fs.readDirectory(loaded.directory), ['config.toml'])
      }),
    ),
  )
})
