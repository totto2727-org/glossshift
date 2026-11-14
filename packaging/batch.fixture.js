import * as fs from 'fs/promises'
import process from 'process'

const env = process.env
const args = JSON.parse(env.GLOSSSHIFT_BATCH_ARGS)
const mode = args[0]
const finish = async () => {
  console.log('Host diagnostics must not leak into batch stdout.')
  if (mode === 'missing-status') {
    process.exit(0)
    return
  }
  if (mode === 'tty') {
    await fs.writeFile(env.GLOSSSHIFT_BATCH_STDOUT, env.GLOSSSHIFT_BATCH_STDOUT_IS_TTY)
    await fs.writeFile(env.GLOSSSHIFT_BATCH_STATUS, '0')
    process.exit(0)
    return
  }
  if (mode === 'capabilities' || mode === '--autostart') {
    const directory = env.GLOSSSHIFT_BATCH_STATUS.slice(0, env.GLOSSSHIFT_BATCH_STATUS.lastIndexOf('/'))
    const capabilities = JSON.parse(await fs.readFile(`${directory}/capabilities.json`, 'utf8'))
    await fs.writeFile(env.GLOSSSHIFT_BATCH_STDOUT, JSON.stringify(capabilities.fs))
    await fs.writeFile(env.GLOSSSHIFT_BATCH_STATUS, '0')
    process.exit(0)
    return
  }
  await fs.writeFile(env.GLOSSSHIFT_BATCH_STDOUT, JSON.stringify({ args, cwd: env.GLOSSSHIFT_BATCH_CWD }))
  await fs.writeFile(env.GLOSSSHIFT_BATCH_STDERR, 'synthetic diagnostic\n')
  if (mode === 'interrupted') return
  await fs.writeFile(env.GLOSSSHIFT_BATCH_STATUS, mode === 'invalid-status' ? '256' : mode === 'failure' ? '7' : '0')
  process.exit(83)
}
finish().catch((error) => {
  console.error(String(error))
  process.exit(1)
})
