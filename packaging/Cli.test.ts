import { link, lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  createSandbox,
  installedCommand,
  installedExecutable,
  sourceCommand,
  type Sandbox,
} from './e2e.test/support.test.ts'

for (const [name, command, enabled] of [
  ['native Node entry', sourceCommand, true],
  ['installed gshift', installedCommand, installedExecutable !== undefined],
] as const) {
  describe.runIf(enabled)(name, () => {
    let sandbox: Sandbox
    beforeEach(async () => {
      sandbox = await createSandbox()
    })
    afterEach(async () => {
      await sandbox.dispose()
    })
    const invoke = (args: readonly string[]) => sandbox.invoke(command, args)
    const failure = async (args: readonly string[], message: RegExp) => {
      const result = await invoke(args)
      expect(result.code).toBe(1)
      expect(result.signal).toBeNull()
      expect(result.stdout).toBe('')
      expect(result.stderr).toMatch(message)
      expect(result.stderr).not.toContain('\u001b')
      expect(result.stderr).not.toMatch(
        /InvalidConfig|configuration is invalid|must-not-start|ERR_MODULE|node:internal/,
      )
      expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
    }

    test.each(['--help', '-h', ''])('%s prints public help without initializing a model', async (flag) => {
      const result = await invoke(flag === '' ? [] : [flag])
      expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
      expect(result.stdout).toMatch(/gshift/)
      expect(result.stdout).toMatch(/--lang/)
      expect(result.stdout).not.toMatch(/terminal UI|--tui/)
      expect(result.stdout).not.toContain('\u001b')
      expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
    })
    test.each(['--version', '-V'])('%s prints only the version', async (flag) => {
      expect(await invoke([flag])).toEqual({ code: 0, signal: null, stdout: 'gshift v0.2.0\n', stderr: '' })
      expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
    })
    test.each([
      { args: ['--tui'], message: /tui|unrecognized|unknown|unexpected/i },
      { args: ['--not-an-option'], message: /not-an-option|unrecognized|unknown|unexpected/i },
      { args: ['guide.md'], message: /lang/i },
      { args: ['guide.md', '--lang'], message: /lang|value/i },
      { args: ['guide.md', '--lang', 'ja', '--force', '--stdout'], message: /force|stdout/i },
      { args: ['guide.md', '--lang', 'ja', '--color', 'always'], message: /color|stdout/i },
      { args: ['guide.md', '--lang', 'ja', '--stdout', '--color', 'invalid'], message: /color|invalid/i },
    ])('rejects invalid arguments $args before model initialization', async ({ args, message }) => {
      await failure(args, message)
    })
    test('rejects a missing relative input before configuration or inference', async () => {
      await failure(['missing.md', '--lang', 'ja', '--stdout'], /missing\.md|not found|ENOENT/i)
    })
    test('rejects a directory input before loading model configuration', async () => {
      await mkdir(join(sandbox.directory, 'directory.md'))
      await failure(['directory.md', '--lang', 'ja', '--stdout'], /directory\.md|regular file|directory/i)
    })
    test('preflights every input before starting inference', async () => {
      await sandbox.write('guide.md', 'Synthetic source')
      await failure(['guide.md', 'missing.md', '--lang', 'ja'], /missing\.md|not found|ENOENT/i)
      expect(await readdir(sandbox.directory)).not.toContain('guide.ja.md')
    })
    test('preserves an existing output without --force', async () => {
      await sandbox.write('guide.md', 'Synthetic source')
      await sandbox.write('guide.ja.md', 'Preserve output')
      await failure(['guide.md', '--lang', 'ja'], /already exists|overwrite/i)
      expect(await sandbox.read('guide.ja.md')).toBe('Preserve output')
    })
    test.each([false, true])('preserves an output symlink, dangling=%s', async (dangling) => {
      await sandbox.write('guide.md', 'Synthetic source')
      if (!dangling) await sandbox.write('target.md', 'Preserve target')
      const output = join(sandbox.directory, 'guide.ja.md')
      await symlink('target.md', output)
      await failure(['guide.md', '--lang', 'ja'], /symbolic link/i)
      expect((await lstat(output)).isSymbolicLink()).toBe(true)
      if (!dangling) expect(await sandbox.read('target.md')).toBe('Preserve target')
    })
    test('rejects an output that is another input even with --force', async () => {
      await sandbox.write('guide.md', 'Synthetic source')
      await sandbox.write('guide.ja.md', 'Protected input')
      await failure(['guide.md', 'guide.ja.md', '--lang', 'ja', '--force'], /also an input/i)
      expect(await sandbox.read('guide.ja.md')).toBe('Protected input')
    })
    test('rejects a hard-linked input/output collision', async () => {
      await sandbox.write('guide.md', 'Protected inode')
      await link(join(sandbox.directory, 'guide.md'), join(sandbox.directory, 'guide.ja.md'))
      await failure(['guide.md', '--lang', 'ja', '--force'], /also an input/i)
      expect(await sandbox.read('guide.md')).toBe('Protected inode')
    })
    test('rejects duplicate sibling destinations before any output is written', async () => {
      await sandbox.write('guide.en.md', 'First input')
      await sandbox.write('guide.md', 'Second input')
      await failure(['guide.en.md', 'guide.md', '--lang', 'ja'], /same output/i)
      expect(await readdir(sandbox.directory)).not.toContain('guide.ja.md')
    })
    test('passes quoted and shell-like filenames literally without executing a shell', async () => {
      const input = 'spaces "quotes" $(touch injected).md'
      await sandbox.write(input, 'Synthetic source')
      await sandbox.write('spaces "quotes" $(touch injected).ja.md', 'Preserve output')
      await failure([input, '--lang', 'ja'], /already exists|overwrite/i)
      expect(await readdir(sandbox.directory)).not.toContain('injected')
    })
    test('autostart enable/status/disable changes only isolated next-login registration', async () => {
      const app = join(sandbox.directory, 'Synthetic App.app')
      await mkdir(join(app, 'Contents/MacOS'), { recursive: true })
      await writeFile(
        join(app, 'Contents/Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.totto2727.glossshift</string><key>CFBundleExecutable</key><string>GlossShift</string></dict></plist>',
      )
      await writeFile(join(app, 'Contents/MacOS/GlossShift'), '#!/bin/sh\nexit 99\n', { mode: 0o700 })
      const enabled = await invoke(['--autostart', 'enable', '--app', app])
      expect(enabled).toMatchObject({ code: 0, stderr: '' })
      expect(enabled.stdout).toContain('No application was launched')
      const destination = join(sandbox.home, 'Library/LaunchAgents/com.totto2727.glossshift.plist')
      expect((await lstat(destination)).mode & 0o777).toBe(0o600)
      expect(await readFile(destination, 'utf8')).toContain(app)
      expect(await invoke(['--autostart', 'status'])).toMatchObject({
        code: 0,
        stderr: '',
        stdout: expect.stringContaining(app),
      })
      expect(await invoke(['--autostart', 'disable'])).toMatchObject({ code: 0, stderr: '' })
      expect(await readdir(join(sandbox.home, 'Library/LaunchAgents'))).toEqual([])
      expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
    })
    test('autostart refuses a registration-directory symlink without changing its target', async () => {
      await mkdir(join(sandbox.home, 'Library'))
      const outside = join(sandbox.directory, 'outside')
      await mkdir(outside)
      await symlink(outside, join(sandbox.home, 'Library/LaunchAgents'))
      await failure(['--autostart', 'disable'], /unsafe registration directory/i)
      expect(await readdir(outside)).toEqual([])
    })
  })
}
