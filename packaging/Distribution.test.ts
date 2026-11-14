import { execFile } from 'node:child_process'
import { readdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, test } from 'vite-plus/test'

import { createSandbox, installedExecutable } from './e2e.test/support.test.ts'

const guiPackage = process.env['GLOSSSHIFT_TEST_GUI_PACKAGE']
const helperExecutable = process.env['GLOSSSHIFT_TEST_MACOS_HELPER']

const files = async (directory: string, prefix = ''): Promise<ReadonlyArray<string>> => {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...(await files(join(directory, entry.name), name)))
    else result.push(name)
  }
  return result
}

for (const [name, source] of [
  ['GUI', process.env['GLOSSSHIFT_TEST_GUI_SOURCE']],
  ['CLI', process.env['GLOSSSHIFT_TEST_CLI_SOURCE']],
] as const) {
  test.runIf(source !== undefined)(`${name} distribution source contains no tests, fixtures, or Ruby`, async () => {
    if (source === undefined) throw new Error('An evaluated Nix source path is required')
    const included = await files(source)
    expect(included).not.toEqual([])
    expect(included).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.test(?:[./-]|$)|\.fixture|\.rb$/)]))
    expect(included).not.toEqual(expect.arrayContaining([expect.stringMatching(/(^|\/)index\.tsx?$/)]))
    if (name === 'CLI') {
      expect(included).toContain('cli/main.ts')
      expect(included).not.toContain('runtime/platform.ts')
      expect(included).not.toContain('nsh.json')
    }
  })
}

describe.runIf(installedExecutable !== undefined)('installed standalone CLI distribution', () => {
  test('ships only production application modules and dependencies', async () => {
    if (installedExecutable === undefined) throw new Error('GLOSSSHIFT_TEST_INSTALLED is required')
    const root = dirname(dirname(await realpath(installedExecutable)))
    const application = join(root, 'share/gshift')
    expect(await files(join(application, 'cli'))).toEqual(['main.ts'])
    const runtime = await files(join(application, 'runtime'))
    expect(runtime).not.toContain('platform.ts')
    expect(runtime).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.test|\.fixture|\.rb$/)]))
    const dependencies = await readdir(join(application, 'node_modules/.pnpm'))
    expect(dependencies).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(?:vite-plus|vitest|typescript|@voidzero-dev\+vite-plus)/)]),
    )
    expect(await readdir(root)).not.toContain('Applications')
  })

  test('has no NSH host or project Swift helper in its recursive Nix runtime closure', async () => {
    if (installedExecutable === undefined) throw new Error('GLOSSSHIFT_TEST_INSTALLED is required')
    const root = dirname(dirname(await realpath(installedExecutable)))
    const { stdout } = await promisify(execFile)('nix', ['path-info', '--recursive', root], {
      maxBuffer: 4 * 1024 * 1024,
    })
    expect(stdout).toContain(root)
    expect(stdout).toMatch(/-nodejs-26\./)
    expect(stdout).not.toMatch(/\/nix\/store\/[^\n/]+-(?:nsh(?:-|$)|glossshift-macos-helper(?:-|$))/m)
  }, 30_000)
})

describe.runIf(guiPackage !== undefined)('installed macOS application distribution', () => {
  test('has a valid sealed application signature', async () => {
    if (guiPackage === undefined) throw new Error('GLOSSSHIFT_TEST_GUI_PACKAGE is required')
    await promisify(execFile)('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      join(guiPackage, 'Applications/GlossShift.app'),
    ])
  }, 30_000)

  test('keeps desktop help separate and links the independently packaged CLI', async () => {
    if (guiPackage === undefined) throw new Error('GLOSSSHIFT_TEST_GUI_PACKAGE is required')
    const sandbox = await createSandbox()
    try {
      const command = { executable: join(guiPackage, 'bin/glossshift'), prefix: [] }
      const help = await sandbox.invoke(command, ['--help'])
      expect(help, help.stderr).toMatchObject({ code: 0, signal: null, stderr: '' })
      expect(help.stdout).toContain('Usage: glossshift [--background | --help | --version]')
      const rejected = await sandbox.invoke(command, ['--tui'])
      expect(rejected).toMatchObject({ code: 2, signal: null, stdout: '' })
      expect(rejected.stderr).toContain('Unknown GlossShift option')
      if (installedExecutable !== undefined)
        expect(await realpath(join(guiPackage, 'bin/gshift'))).toBe(await realpath(installedExecutable))
      expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
    } finally {
      await sandbox.dispose()
    }
  })
})

test.runIf(helperExecutable !== undefined)(
  'packaged helper checks permission without capturing selected text',
  async () => {
    if (helperExecutable === undefined) throw new Error('GLOSSSHIFT_TEST_MACOS_HELPER is required')
    const { stdout, stderr } = await promisify(execFile)(helperExecutable, ['--permission'])
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({ kind: 'permission', schemaVersion: 1, granted: expect.any(Boolean) })
  },
)
