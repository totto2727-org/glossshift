import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type CliCommand = { readonly executable: string; readonly prefix: readonly string[] }
export const sourceCommand: CliCommand = {
  executable: process.execPath,
  prefix: [fileURLToPath(new URL('../../cli/main.ts', import.meta.url))],
}
export const installedExecutable = process.env['GLOSSSHIFT_TEST_INSTALLED']
export const installedCommand: CliCommand = { executable: installedExecutable ?? '', prefix: [] }

export const createSandbox = async () => {
  const root = fileURLToPath(new URL('../../tmp/', import.meta.url))
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'glossshift-cli-test-'))
  const home = join(directory, 'home')
  const cache = join(directory, 'cache')
  const temporary = join(directory, 'temporary')
  for (const path of [home, cache, temporary]) await mkdir(path, { mode: 0o700 })
  const config = join(directory, 'invalid-local.json')
  // Any accidental model initialization fails locally, before a download is possible.
  await writeFile(config, '{this is intentionally invalid JSON')
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    HOME: home,
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_CACHE_HOME: cache,
    TMPDIR: temporary,
    GLOSSSHIFT_CONFIG: config,
    GLOSSSHIFT_LLAMA_SERVER: join(directory, 'must-not-start'),
    NO_COLOR: '1',
    TERM: 'dumb',
  }
  const active = new Set<{ readonly child: ReturnType<typeof spawn>; readonly result: Promise<unknown> }>()
  const start = (command: CliCommand, args: readonly string[], extra: NodeJS.ProcessEnv = {}, timeout = 30_000) => {
    const child = spawn(command.executable, [...command.prefix, ...args], {
      cwd: directory,
      env: { ...env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => {
          clearTimeout(timer)
          resolve({ code, signal, stdout, stderr })
        })
      },
    )
    const running = { child, result, output: () => ({ stdout, stderr }) }
    active.add(running)
    void result.finally(() => active.delete(running)).catch(() => undefined)
    return running
  }
  return {
    directory,
    home,
    cache,
    temporary,
    config,
    env,
    start,
    invoke: (command: CliCommand, args: readonly string[], extra: NodeJS.ProcessEnv = {}) =>
      start(command, args, extra).result,
    write: (name: string, text: string) => writeFile(join(directory, name), text),
    read: (name: string) => readFile(join(directory, name), 'utf8'),
    artifacts: async () => ({ cache: await readdir(cache), temporary: await readdir(temporary) }),
    dispose: async () => {
      for (const running of active) {
        running.child.kill('SIGTERM')
        await running.result
      }
      await rm(directory, { recursive: true, force: true })
    },
  }
}
export type Sandbox = Awaited<ReturnType<typeof createSandbox>>
