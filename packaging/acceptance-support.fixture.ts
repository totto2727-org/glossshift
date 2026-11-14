import * as fs from 'fs/promises'
import process from 'process'

import { Array, Record, String } from 'effect'

export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
export const check = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}
export const equal = (actual: unknown, expected: unknown) =>
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
const required = (name: string) => {
  const value = process.env[name]
  if (value === undefined || !String.startsWith('/')(value)) throw new Error(`Missing absolute ${name}`)
  return value
}

export const create = async (root = required('GLOSSSHIFT_TEST_ROOT')) => {
  const bundle = required('GLOSSSHIFT_TEST_BATCH_BUNDLE')
  const host = required('GLOSSSHIFT_TEST_TUI_HOST')
  const tools = required('GLOSSSHIFT_TEST_COREUTILS')
  const jq = required('GLOSSSHIFT_TEST_JQ')
  const directory = `${process.dataDir}/acceptance-${Date.now()}`
  const tool = (name: string) => `${quote(tools)} --coreutils-prog=${name}`
  const shell = async (source: string, cwd = directory) =>
    process.run('/bin/sh', ['-c', `cd ${quote(cwd)}\n${source}`], { cwd: process.dataDir, timeoutMs: 30_000 })
  const dispose = async () => {
    equal((await shell(`${tool('rm')} -rf -- ${quote(directory)}`, process.dataDir ?? directory)).code, 0)
    equal((await shell(`${tool('test')} ! -e ${quote(directory)}`, process.dataDir ?? directory)).code, 0)
  }
  await fs.mkdir(directory)
  try {
    equal((await shell(`${tool('chmod')} 700 ${quote(directory)}`)).code, 0)
    await fs.mkdir(`${directory}/private runs`)
    await fs.mkdir(`${directory}/settings`)
    const environment = {
      HOME: `${directory}/settings`,
      TMPDIR: `${directory}/private runs`,
      XDG_CONFIG_HOME: `${directory}/settings`,
      XDG_CACHE_HOME: `${directory}/settings`,
      GLOSSSHIFT_CONFIG: `${directory}/settings/absent.json`,
      GLOSSSHIFT_COREUTILS: tools,
    }
    const exports = (values: Record<string, string>) =>
      Array.join(
        Array.map(Record.toEntries(values), ([key, value]) => `export ${key}=${quote(value)}`),
        '\n',
      )
    const run = (command: string, extra: Record<string, string> = {}, cwd = directory) =>
      shell(`${exports({ ...environment, ...extra })}\n${command}`, cwd)
    const install = async (production: boolean) => {
      await fs.writeFile(
        `${directory}/bundle.js`,
        await fs.readFile(production ? bundle : `${root}/packaging/batch.fixture.js`, 'utf8'),
      )
      const result = await shell(
        `${quote(jq)} --arg dir ${quote(directory)} '.capabilities | .process.execute = [${JSON.stringify(tools)}] | .fs = {read:[$dir],write:[$dir]}' ${quote(`${root}/batch/nsh.json`)} > capabilities.json`,
      )
      equal(result.code, 0)
    }
    await install(false)
    let launcher = await fs.readFile(`${root}/packaging/gshift-launcher.sh`, 'utf8')
    const replacements = {
      '@shell@': '/bin/sh',
      '@runtimeEnvironment@': '',
      '@host@': quote(host),
      '@tuiBundle@': quote(`${directory}/bundle.js`),
      '@batchBundle@': quote(`${directory}/bundle.js`),
      '@mktemp@': tool('mktemp'),
      '@rm@': tool('rm'),
      '@cat@': tool('cat'),
      '@jq@': quote(jq),
      '@cp@': tool('cp'),
      '@realpath@': tool('realpath'),
      '@capabilities@': quote(`${directory}/capabilities.json`),
    }
    for (const [key, value] of Record.toEntries(replacements)) launcher = launcher.replaceAll(key, value)
    await fs.writeFile(`${directory}/gshift`, launcher)
    equal((await shell(`${tool('chmod')} 700 ${quote(`${directory}/gshift`)}`)).code, 0)
    const invoke = (args: string[], extra: Record<string, string> = {}, cwd = directory) =>
      run(`${quote(`${directory}/gshift`)} ${Array.join(Array.map(args, quote), ' ')}`, extra, cwd)
    const clean = async () => equal(await fs.readdir(`${directory}/private runs`), [])
    const modelFree = async () => equal(await fs.readdir(`${directory}/settings`), [])
    return {
      root,
      bundle,
      host,
      tools,
      directory,
      tool,
      run,
      invoke,
      clean,
      modelFree,
      install,
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
export type Context = Awaited<ReturnType<typeof create>>
