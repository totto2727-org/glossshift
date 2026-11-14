import * as fs from 'fs/promises'

import { check, type Context, equal, quote } from '../packaging/acceptance-support.fixture.ts'

export const productionEntry = async (ctx: Context) => {
  const { directory, run, host } = ctx
  await ctx.install(true)
  const invoke = async (args: string[], cwd = directory) => {
    for (const name of ['stdout', 'stderr']) await fs.writeFile(`${directory}/${name}`, '')
    const result = await run(
      `${ctx.tool('rm')} -f ${quote(`${directory}/status`)}\n${quote(host)} --headless --bundle ${quote(`${directory}/bundle.js`)} --data-dir ${quote(`${directory}/host-data`)} --log-file ${quote(`${directory}/host.log`)}`,
      {
        GLOSSSHIFT_BATCH_ARGS: JSON.stringify(args),
        GLOSSSHIFT_BATCH_CWD: directory,
        GLOSSSHIFT_BATCH_STDOUT: `${directory}/stdout`,
        GLOSSSHIFT_BATCH_STDERR: `${directory}/stderr`,
        GLOSSSHIFT_BATCH_STATUS: `${directory}/status`,
      },
      cwd,
    )
    equal(result.stdout, '')
    equal(result.stderr, '')
    return {
      out: await fs.readFile(`${directory}/stdout`, 'utf8'),
      err: await fs.readFile(`${directory}/stderr`, 'utf8'),
      status: await fs.readFile(`${directory}/status`, 'utf8'),
      code: result.code,
    }
  }
  const help = await invoke(['--help'])
  check(help.out.includes('Usage: gshift <FILES>'), 'Production help missing')
  equal([help.err, help.status, help.code], ['', '0\n', 0])
  await ctx.modelFree()
  equal(await invoke(['--version']), { out: 'gshift 0.2.0\n', err: '', status: '0\n', code: 0 })
  await ctx.modelFree()
  const invalid = await invoke(['missing.md'])
  equal([invalid.out, invalid.err, invalid.status], ['', 'gshift failed: --lang is required\n', '1\n'])
  await ctx.modelFree()
  await fs.writeFile(`${directory}/guide.md`, 'synthetic source')
  await fs.writeFile(`${directory}/guide.ja.md`, 'preserve output')
  const existing = await invoke(['guide.md', '--lang', 'ja'])
  equal([existing.out, existing.status], ['', '1\n'])
  check(existing.err.includes('already exists; pass --force'), 'Existing output was not rejected')
  equal(await fs.readFile(`${directory}/guide.ja.md`, 'utf8'), 'preserve output')
  await ctx.modelFree()
  await fs.unlink(`${directory}/guide.ja.md`)
  for (const dangling of [false, true]) {
    const target = `${directory}/${dangling ? 'missing' : 'target'}.md`
    if (!dangling) await fs.writeFile(target, 'preserve target')
    const linked = await run(`${ctx.tool('ln')} -s ${quote(target)} ${quote(`${directory}/guide.ja.md`)}`)
    equal(linked.code, 0)
    const result = await invoke(['guide.md', '--lang', 'ja'])
    equal([result.out, result.status], ['', '1\n'])
    check(result.err.includes('symbolic link'), 'Output symlink was not rejected')
    check((await fs.lstat(`${directory}/guide.ja.md`)).isSymbolicLink(), 'Symlink replaced')
    if (dangling) equal(await ctx.run(`${ctx.tool('test')} ! -e ${quote(target)}`).then((r) => r.code), 0)
    else equal(await fs.readFile(target, 'utf8'), 'preserve target')
    await fs.unlink(`${directory}/guide.ja.md`)
    await ctx.modelFree()
  }
  await fs.writeFile(`${directory}/guide.ja.md`, 'synthetic other input')
  const collision = await invoke(['guide.md', 'guide.ja.md', '--lang', 'ja', '--force'], ctx.root)
  equal([collision.out, collision.status], ['', '1\n'])
  check(
    collision.err.includes('also an input file') && collision.err.includes(`${directory}/guide.ja.md`),
    'Relative collision did not use original cwd',
  )
  equal(await fs.readFile(`${directory}/guide.md`, 'utf8'), 'synthetic source')
  equal(await fs.readFile(`${directory}/guide.ja.md`, 'utf8'), 'synthetic other input')
  await ctx.modelFree()
}
