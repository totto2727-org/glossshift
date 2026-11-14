import { Array, ConfigProvider, Effect, FileSystem, Option, Path, Result, Sink, Stdio, String } from 'effect'
import * as plist from 'plist'

import { runAutostart } from './autostart.ts'
import { defaultDesktopConfig, loadDesktopConfig } from './desktop-config.ts'

const equal = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Desktop acceptance mismatch: ${actual} !== ${expected}`)
}
const rejects = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    if (Result.isSuccess(yield* Effect.result(program)))
      return yield* Effect.die(new Error('Expected desktop rejection'))
  })
const environment = (home: string, xdg = `${home}/config`) =>
  ConfigProvider.fromUnknown({ HOME: home, XDG_CONFIG_HOME: xdg }, { preserveEmptyStrings: true })

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const home = yield* fs.makeTempDirectoryScoped({ prefix: 'desktop-acceptance-' })
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

const verifyConfiguration = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const home = yield* fs.makeTempDirectoryScoped({ prefix: 'config-acceptance-' })
  const load = loadDesktopConfig.pipe(Effect.provideService(ConfigProvider.ConfigProvider, environment(home)))
  const first = yield* load
  equal(first.created_files, true)
  equal(first.window.width, 560)
  const file = path.join(first.directory, 'config.toml')
  equal(yield* fs.readFileString(file), defaultDesktopConfig)
  equal((yield* fs.stat(file)).mode & 0o777, 0o644)
  equal((yield* fs.readDirectory(first.directory)).join(','), 'config.toml')
  equal(yield* fs.exists(`${home}/Library`), false)
  equal(yield* fs.exists(`${home}/.cache`), false)
  const modified = defaultDesktopConfig.replace('width = 560', 'width = 700')
  yield* fs.writeFileString(file, modified)
  const second = yield* load
  equal(second.created_files, false)
  equal(second.window.width, 700)
  yield* fs.remove(file)
  const target = `${home}/settings-target`
  yield* fs.writeFileString(target, defaultDesktopConfig)
  yield* fs.symlink(target, file)
  equal((yield* load).created_files, false)
  equal((yield* fs.lstat(file)).type, 'SymbolicLink')
  equal(yield* fs.readFileString(target), defaultDesktopConfig)
  yield* fs.remove(file)
  const concurrent = defaultDesktopConfig.replace('width = 560', 'width = 720')
  const filesystem = {
    ...fs,
    link: (from: string, to: string) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(to, concurrent)
        yield* fs.link(from, to)
      }),
  }
  const raced = yield* load.pipe(Effect.provideService(FileSystem.FileSystem, filesystem))
  equal(raced.created_files, false)
  equal(raced.window.width, 720)
  equal(yield* fs.readFileString(file), concurrent)
  equal((yield* fs.readDirectory(first.directory)).join(','), 'config.toml')
})

const verifyLifecycle = Effect.gen(function* () {
  const { fs, home, app, directory, destination, command, output } = yield* fixture
  yield* command(['status'])
  yield* command(['disable'])
  equal(yield* fs.exists(directory), false)
  yield* rejects(command(['enable', '--app', app], ''))
  equal(yield* fs.exists(directory), false)
  yield* command(['enable', '--app', app])
  const text = yield* fs.readFileString(destination)
  equal(text.includes('&amp;') && text.includes('&lt;'), true)
  equal(text.includes('KeepAlive'), false)
  equal((yield* fs.stat(destination)).mode & 0o777, 0o600)
  equal((yield* fs.stat(directory)).mode & 0o777, 0o700)
  yield* command(['enable', '--app', app], `${home}/new-config`)
  equal((yield* fs.readFileString(destination)).includes('new-config'), true)
  equal((yield* fs.readDirectory(directory)).join(','), 'com.totto2727.glossshift.plist')
  yield* fs.writeFile(
    `${app}/Contents/Info.plist`,
    plist.buildBinary({
      CFBundleIdentifier: 'com.totto2727.glossshift',
      CFBundleExecutable: 'GlossShift',
    }),
  )
  yield* fs.writeFile(destination, plist.buildBinary(plist.parse(yield* fs.readFileString(destination))))
  yield* command(['status'])
  yield* command(['enable', '--app', app])
  const stable = `${home}/Stable.app`
  yield* fs.symlink(app, stable)
  yield* fs.rename(`${app}/Contents/MacOS/GlossShift`, `${home}/executable`)
  yield* fs.symlink(`${home}/executable`, `${app}/Contents/MacOS/GlossShift`)
  yield* command(['enable', '--app', stable])
  yield* command(['status'])
  equal((yield* fs.readFileString(destination)).includes('Stable.app'), true)
  yield* fs.remove(app, { recursive: true })
  yield* command(['disable'])
  yield* command(['disable'])
  equal(yield* fs.exists(destination), false)
  equal(Array.contains(String.split(output(), '\n'), `Autostart configured for next login: ${app}`), true)
  equal(output().includes('No application was launched.'), true)
  equal(output().includes('Any running application is unchanged.'), true)
  equal(output().includes('macOS authorization and running state are not checked.'), true)
})

const verifyDuplicates = Effect.gen(function* () {
  const { fs, home, app, destination, command } = yield* fixture
  yield* command(['enable', '--app', app])
  const xml = yield* fs.readFileString(destination)
  const identifier = 'com.totto2727.glossshift'
  const duplicate = xml.replace('<key>Label</key>', `<key>Label</key><string>${identifier}</string><key>Label</key>`)
  const binary = new Uint8Array(
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
  const marker = new TextEncoder().encode('Other')
  const key = Array.findFirstIndex(Array.fromIterable(binary), (_, index) =>
    Array.every(Array.fromIterable(marker), (byte, offset) => binary[index + offset] === byte),
  )
  if (Option.isNone(key)) return yield* Effect.die('Missing duplicate-key fixture marker')
  binary.set(new TextEncoder().encode('Label'), key.value)
  for (const data of [new TextEncoder().encode(duplicate), binary]) {
    yield* fs.writeFile(destination, data)
    for (const args of [['status'], ['disable'], ['enable', '--app', app]]) yield* rejects(command(args))
    const unchanged = yield* fs.readFile(destination)
    equal(unchanged.length, data.length)
    equal(
      Array.every(Array.fromIterable(data), (byte, index) => unchanged[index] === byte),
      true,
    )
  }
})

const verifyUnsafeFiles = Effect.forEach(
  [
    'symlink',
    'unrelated',
    'permissions',
    'command',
    'environment',
    'prototype',
    'unknown',
    'foreign-file',
    'foreign-directory',
  ],
  (unsafe) =>
    Effect.gen(function* () {
      const { fs, home, app, directory, destination, command } = yield* fixture
      yield* command(['enable', '--app', app])
      const target = `${home}/unrelated`
      yield* fs.writeFileString(target, 'do not change')
      if (unsafe === 'symlink') {
        yield* fs.remove(destination)
        yield* fs.symlink(target, destination)
      } else if (unsafe === 'unrelated') yield* fs.writeFileString(destination, 'not a plist')
      else if (unsafe === 'permissions') yield* fs.chmod(destination, 0o666)
      else if (unsafe !== 'foreign-file' && unsafe !== 'foreign-directory') {
        const text = yield* fs.readFileString(destination)
        yield* fs.writeFileString(
          destination,
          unsafe === 'command'
            ? text.replace('/usr/bin/open', '/bin/sh')
            : unsafe === 'environment'
              ? text.replace('<key>XDG_CONFIG_HOME</key>', '<key>UNEXPECTED</key>')
              : unsafe === 'prototype'
                ? text.replace('<key>XDG_CONFIG_HOME</key>', '<key>__proto__</key>')
                : text.replace('<key>RunAtLoad</key>', '<key>KeepAlive</key>'),
        )
      }
      const before = yield* fs.readFileString(destination)
      const foreignPath = unsafe === 'foreign-directory' ? directory : destination
      const owner = Option.getOrThrow((yield* fs.stat(home)).uid)
      const filesystem =
        unsafe === 'foreign-file' || unsafe === 'foreign-directory'
          ? {
              ...fs,
              lstat: (name: string) =>
                fs
                  .lstat(name)
                  .pipe(Effect.map((info) => (name === foreignPath ? { ...info, uid: Option.some(owner + 1) } : info))),
            }
          : fs
      for (const args of [['status'], ['disable'], ['enable', '--app', app]]) {
        yield* rejects(command(args).pipe(Effect.provideService(FileSystem.FileSystem, filesystem)))
      }
      equal(yield* fs.readFileString(destination), before)
      equal(yield* fs.readFileString(target), 'do not change')
    }),
  { discard: true },
)

const verifyUnsafeDirectories = Effect.forEach(
  ['relative-app', 'relative-xdg', 'empty-xdg', 'nonexecutable', 'identity', 'symlink-directory', 'directory-mode'],
  (unsafe) =>
    Effect.gen(function* () {
      const { fs, home, app, directory, destination, command } = yield* fixture
      if (unsafe === 'nonexecutable') yield* fs.chmod(`${app}/Contents/MacOS/GlossShift`, 0o644)
      if (unsafe === 'identity')
        yield* fs.writeFileString(
          `${app}/Contents/Info.plist`,
          plist.build({ CFBundleIdentifier: 'com.example.other', CFBundleExecutable: 'GlossShift' }),
        )
      if (unsafe === 'symlink-directory') {
        yield* fs.makeDirectory(`${home}/outside`)
        yield* fs.symlink(`${home}/outside`, `${home}/Library`)
      }
      if (unsafe === 'directory-mode') {
        yield* fs.makeDirectory(`${home}/Library`)
        yield* fs.chmod(`${home}/Library`, 0o777)
      }
      const xdg = unsafe === 'relative-xdg' ? 'relative' : unsafe === 'empty-xdg' ? '' : `${home}/config`
      yield* rejects(command(['enable', '--app', unsafe === 'relative-app' ? 'relative.app' : app], xdg))
      equal(yield* fs.exists(destination), false)
      equal(yield* fs.exists(directory), false)
    }),
  { discard: true },
)

/** Every filesystem operation runs in NSH with temporary synthetic settings. No selection or private configuration is read. */
export const verifyDesktopFiles = Effect.scoped(
  Effect.gen(function* () {
    yield* verifyConfiguration
    yield* verifyLifecycle
    yield* verifyDuplicates
    yield* verifyUnsafeFiles
    yield* verifyUnsafeDirectories
  }),
)
