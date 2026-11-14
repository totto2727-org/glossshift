import * as fs from 'fs/promises'

import { Array, Schema } from 'effect'

import { check, type Context, equal, quote } from './acceptance-support.fixture.ts'

const payload = Schema.fromJsonString(Schema.Struct({ args: Schema.Array(Schema.String), cwd: Schema.String }))
const rootsSchema = Schema.fromJsonString(
  Schema.Struct({ read: Schema.Array(Schema.String), write: Schema.Array(Schema.String) }),
)
const decodePayload = Schema.decodeUnknownSync(payload)
const decodeRoots = Schema.decodeUnknownSync(rootsSchema)

export const launcherAcceptance = async (ctx: Context) => {
  const { directory, invoke, clean } = ctx
  const args = [
    'success',
    'spaces and "quotes".md',
    'new\nline.md',
    '$(touch never-created)',
    '--lang',
    'ja',
    '--stdout',
  ]
  const success = await invoke(args)
  equal(success.code, 0)
  equal(decodePayload(success.stdout), { args, cwd: directory })
  equal(success.stderr, 'synthetic diagnostic\n')
  check(!`${success.stdout}${success.stderr}`.includes('\x1b'), 'Terminal escape leaked')
  equal((await ctx.run(`${ctx.tool('test')} ! -e never-created`)).code, 0)
  await clean()
  const failure = await invoke(['failure'])
  equal(failure.code, 7)
  equal(decodePayload(failure.stdout).args, ['failure'])
  equal(failure.stderr, 'synthetic diagnostic\n')
  await clean()
  for (const [mode, message] of [
    ['missing-status', 'did not report completion'],
    ['invalid-status', 'invalid status'],
  ] satisfies [string, string][]) {
    const result = await invoke([mode])
    equal(result.code, 1)
    if (mode === 'missing-status') equal(result.stdout, '')
    check(result.stderr.includes(message), 'Invalid completion accepted')
    await clean()
  }
  const newline = `${directory}/cwd\n`
  await fs.mkdir(newline)
  const changed = await invoke(['success'], {}, newline)
  equal(changed.code, 0)
  equal(decodePayload(changed.stdout).cwd, newline)
  await clean()
  const outside = `${directory}/must-not-be-written`
  const inherited = await invoke(['success'], {
    PATH: '/does-not-exist',
    GLOSSSHIFT_BATCH_ARGS: '["injected"]',
    GLOSSSHIFT_BATCH_CWD: '/injected',
    GLOSSSHIFT_BATCH_STDOUT: outside,
    GLOSSSHIFT_BATCH_STDERR: outside,
    GLOSSSHIFT_BATCH_STATUS: outside,
  })
  equal(inherited.code, 0)
  equal(decodePayload(inherited.stdout).args, ['success'])
  equal(inherited.stderr, 'synthetic diagnostic\n')
  equal((await ctx.run(`${ctx.tool('test')} ! -e ${quote(outside)}`)).code, 0)
  await clean()
  const interrupted = await ctx.run(`${quote(`${directory}/gshift`)} interrupted > interrupted.out 2> interrupted.err &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null || :' EXIT
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  for output in ${quote(`${directory}/private runs`)}/*/stdout; do
    if [ -s "$output" ]; then ready=1; break; fi
  done
  [ "$ready" = 0 ] || break
  ${ctx.tool('sleep')} 0.1
done
[ "$ready" = 1 ] || exit 99
kill -TERM "$pid"
wait "$pid"
code=$?
trap - EXIT
exit "$code"`)
  equal(interrupted.code, 143)
  equal(await fs.readFile(`${directory}/interrupted.out`, 'utf8'), '')
  equal(await fs.readFile(`${directory}/interrupted.err`, 'utf8'), '')
  await clean()
  const capability = await invoke(['capabilities'])
  equal([capability.code, capability.stderr], [0, ''])
  const roots = decodeRoots(capability.stdout)
  for (const path of [...roots.read, ...roots.write])
    check(path === directory || path.startsWith(`${directory}/`), `Unscoped grant: ${path}`)
  check(!Array.contains(roots.write, `${directory}/settings/absent.json`), 'Configuration writable')
  await clean()
  const app = `${directory}/Approved App.app`
  const enabled = await invoke(['--autostart', 'enable', '--app', app])
  equal([enabled.code, enabled.stderr], [0, ''])
  const autostart = decodeRoots(enabled.stdout)
  check(
    Array.contains(autostart.read, app) && Array.contains(autostart.read, `${directory}/settings`),
    'Autostart read grants missing',
  )
  check(
    Array.contains(autostart.write, `${directory}/settings/Library/LaunchAgents`),
    'Registration write grant missing',
  )
  for (const forbidden of [app, `${directory}/settings`, directory])
    check(!Array.contains(autostart.write, forbidden), `Autostart broad write: ${forbidden}`)
  check(
    !Array.some(
      [...autostart.read, ...autostart.write],
      (path) => path.includes('/.cache/') || path.endsWith('/enable'),
    ),
    'Autostart parsed as files',
  )
  await clean()
  const registration = `${directory}/settings/Library/LaunchAgents`
  await fs.mkdir(registration, { recursive: true })
  const stored = `${directory}/Stored App.app`
  await fs.writeFile(
    `${registration}/com.totto2727.glossshift.plist`,
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>${stored}</string></array></dict></plist>`,
  )
  const status = await invoke(['--autostart', 'status'])
  equal([status.code, status.stderr], [0, ''])
  const statusRoots = decodeRoots(status.stdout)
  check(Array.contains(statusRoots.read, stored), 'Stored application read grant missing')
  check(
    !Array.contains(statusRoots.write, stored) && !Array.contains(statusRoots.write, directory),
    'Stored app writable',
  )
  await clean()
  equal((await ctx.run(`${ctx.tool('rm')} -rf ${quote(`${directory}/settings/Library`)}`)).code, 0)
  await ctx.modelFree()
  const redirected = await invoke(['tty'], { GLOSSSHIFT_BATCH_STDOUT_IS_TTY: '1' })
  equal([redirected.code, redirected.stdout, redirected.stderr], [0, '0', ''])
  await clean()
  // macOS script echoes its injected EOF unless stdin stays open until the short-lived command exits.
  const tty = await ctx.run(`${ctx.tool('sleep')} 1 | /usr/bin/script -q /dev/null ${quote(`${directory}/gshift`)} tty`)
  equal([tty.code, tty.stdout, tty.stderr], [0, '1', ''])
  await clean()
  await ctx.install(true)
  for (const [argument, code, message] of [
    ['--help', 0, 'Usage: gshift'],
    ['--version', 0, 'gshift 0.2.0'],
    ['--invalid-option', 1, 'gshift failed:'],
  ] satisfies [string, number, string][]) {
    const result = await invoke([argument])
    equal(result.code, code)
    check((code === 0 ? result.stdout : result.stderr).includes(message), 'Production launcher message missing')
    equal(code === 0 ? result.stderr : result.stdout, '')
    check(!`${result.stdout}${result.stderr}`.includes('\x1b'), 'Production terminal escape leaked')
    await clean()
    await ctx.modelFree()
  }
}
