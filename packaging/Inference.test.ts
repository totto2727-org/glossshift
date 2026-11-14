import { execFile } from 'node:child_process'
import { lstat, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  createSandbox,
  installedCommand,
  installedExecutable,
  sourceCommand,
  type Sandbox,
} from './e2e.test/support.test.ts'

const configPath = process.env['GLOSSSHIFT_TEST_MODEL_CONFIG']
const serverPath = process.env['GLOSSSHIFT_TEST_LLAMA_SERVER']
const ModelFixture = Schema.Struct({
  sourceLanguage: Schema.optional(Schema.String),
  contextSize: Schema.optional(Schema.Int),
  maxTokens: Schema.optional(Schema.Int),
  model: Schema.Struct({
    uri: Schema.String,
    sha256: Schema.String,
    prompt: Schema.Literals(['plamo', 'chat']),
    supportedLanguages: Schema.optional(Schema.Array(Schema.String)),
  }),
})

// Explicit opt-in only. A file: URI is required, so this suite cannot download weights.
for (const [name, command, enabled] of [
  ['native Node cached GGUF', sourceCommand, configPath !== undefined && serverPath !== undefined],
  ['installed gshift cached GGUF', installedCommand, configPath !== undefined && installedExecutable !== undefined],
] as const) {
  describe.runIf(enabled)(name, () => {
    let sandbox: Sandbox
    let environment: NodeJS.ProcessEnv
    let expectedContext: number
    let modelPath: string
    beforeEach(async () => {
      sandbox = await createSandbox()
      if (configPath === undefined || !isAbsolute(configPath))
        throw new Error('GLOSSSHIFT_TEST_MODEL_CONFIG must be absolute')
      const fixture = Schema.decodeUnknownSync(Schema.fromJsonString(ModelFixture))(await readFile(configPath, 'utf8'))
      expectedContext = fixture.contextSize ?? 262144
      const uri = new URL(fixture.model.uri)
      if (uri.protocol !== 'file:')
        throw new Error('Inference tests require an existing file: model URI, never a download URL')
      modelPath = fileURLToPath(uri)
      expect((await stat(modelPath)).isFile()).toBe(true)
      expect(fixture.model.sha256).toMatch(/^[a-f0-9]{64}$/)
      await sandbox.write('real-inference.json', JSON.stringify({ ...fixture, cacheDirectory: sandbox.cache }))
      environment = {
        GLOSSSHIFT_CONFIG: join(sandbox.directory, 'real-inference.json'),
        ...(serverPath === undefined ? {} : { GLOSSSHIFT_LLAMA_SERVER: serverPath }),
        ...(process.env['GLOSSSHIFT_COREUTILS'] === undefined
          ? {}
          : { GLOSSSHIFT_COREUTILS: process.env['GLOSSSHIFT_COREUTILS'] }),
      }
    })
    afterEach(async () => {
      await sandbox.dispose()
    })

    test.skipIf(command !== sourceCommand || serverPath === undefined)(
      'official server uses Metal GPU offload with production startup arguments',
      async () => {
        if (serverPath === undefined) throw new Error('GLOSSSHIFT_TEST_LLAMA_SERVER is required')
        const auth = join(sandbox.directory, 'synthetic-auth')
        await writeFile(auth, 'synthetic-test-authentication-key\n', { mode: 0o600 })
        const running = sandbox.start(
          { executable: serverPath, prefix: [] },
          [
            '--model',
            modelPath,
            '--host',
            '127.0.0.1',
            '--port',
            '0',
            '--api-key-file',
            auth,
            '--ctx-size',
            String(expectedContext),
            '--parallel',
            '1',
            '--no-webui',
            '--no-context-shift',
            '--jinja',
            // Runtime behavior stays identical. Verbosity exposes backend selection for this check only.
            '-lv',
            '5',
          ],
          {},
          180_000,
        )
        try {
          await expect
            .poll(
              () => {
                const output = running.output()
                return (
                  running.child.exitCode !== null ||
                  /listening on http:\/\/127\.0\.0\.1:\d+/.test(output.stdout + output.stderr)
                )
              },
              { timeout: 150_000 },
            )
            .toBe(true)
          const output = running.output()
          const diagnostics = output.stdout + output.stderr
          expect(running.child.exitCode, diagnostics).toBeNull()
          expect(diagnostics).toMatch(/Metal|MTL|ggml_metal/)
          expect(diagnostics).toMatch(/offloaded [1-9]\d*\/\d+ layers to GPU/)
        } finally {
          running.child.kill('SIGTERM')
          await running.result
        }
      },
      190_000,
    )

    test.each([
      { source: 'Hello, world.', language: 'ja', pattern: /[\u3040-\u30ff\u4e00-\u9fff]/u },
      { source: 'こんにちは、世界。', language: 'en', pattern: /hello|world/iu },
    ])(
      'translates real cached weights to $language with clean redirected stdout',
      async ({ source, language, pattern }) => {
        await sandbox.write('synthetic.md', source)
        const result = await sandbox.start(
          command,
          ['synthetic.md', '--lang', language, '--stdout'],
          environment,
          180_000,
        ).result
        expect(result, result.stderr).toMatchObject({ code: 0, signal: null })
        expect(result.stdout).toMatch(pattern)
        expect(result.stdout).not.toContain('\u001b')
        expect(result.stdout).not.toMatch(/<\|(?:plamo|im_start|im_end)|llama_|listening on|Built with/)
        expect(result.stderr).not.toMatch(/gshift failed|listening on/)
        expect(await sandbox.read('synthetic.md')).toBe(source)
        expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
      },
      190_000,
    )

    test('forced file output replaces a symlink without modifying its target', async () => {
      await sandbox.write('synthetic.md', 'Hello, world.')
      await sandbox.write('protected.md', 'Do not modify this target')
      const output = join(sandbox.directory, 'synthetic.ja.md')
      await symlink('protected.md', output)
      const result = await sandbox.start(command, ['synthetic.md', '--lang', 'ja', '--force'], environment, 180_000)
        .result
      expect(result, result.stderr).toMatchObject({ code: 0, signal: null, stdout: '' })
      expect(result.stderr).toContain('Written to ')
      expect((await lstat(output)).isFile()).toBe(true)
      expect(await sandbox.read('synthetic.ja.md')).toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/u)
      expect(await sandbox.read('synthetic.ja.md')).not.toContain('\u001b')
      expect(await sandbox.read('protected.md')).toBe('Do not modify this target')
      expect(await sandbox.read('synthetic.md')).toBe('Hello, world.')
      expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
    }, 190_000)

    test('SIGTERM releases the owned inference server and private authentication directory', async () => {
      await sandbox.write('synthetic.md', 'Hello, world.')
      const running = sandbox.start(command, ['synthetic.md', '--lang', 'ja', '--stdout'], environment, 180_000)
      await expect
        .poll(
          async () =>
            running.child.exitCode !== null ||
            (await readdir(sandbox.temporary)).some((name) => name.startsWith('glossshift-server-')),
          { timeout: 150_000 },
        )
        .toBe(true)
      expect(running.child.exitCode).toBeNull()
      const ps = promisify(execFile)
      await expect
        .poll(
          async () =>
            (await ps('/bin/ps', ['-axo', 'pid=,command='])).stdout.includes(`${sandbox.temporary}/glossshift-server-`),
          { timeout: 10_000 },
        )
        .toBe(true)
      const processes = (await ps('/bin/ps', ['-axo', 'pid=,command='])).stdout
      const server = processes.split('\n').find((line) => line.includes(`${sandbox.temporary}/glossshift-server-`))
      expect(server).toContain(`--ctx-size ${expectedContext}`)
      expect(server).toContain('--host 127.0.0.1 --port 0')
      expect(server).toContain('--api-key-file ')
      expect(server).not.toMatch(/--api-key\s/)
      expect(running.child.kill('SIGTERM')).toBe(true)
      const result = await running.result
      // NodeRuntime represents scoped interruption with exit 130.
      expect(result, JSON.stringify(result)).toMatchObject({ code: 130, signal: null, stdout: '', stderr: '' })
      await expect
        .poll(
          async () =>
            (await ps('/bin/ps', ['-axo', 'pid=,command='])).stdout.includes(`${sandbox.temporary}/glossshift-server-`),
          { timeout: 10_000 },
        )
        .toBe(false)
      expect(await sandbox.artifacts()).toEqual({ cache: [], temporary: [] })
    }, 190_000)
  })
}
