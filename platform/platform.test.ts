import { expect, open, test } from 'nsh/test'

test('NSH Effect platform uses real official TUI APIs and rejects unsupported streaming', async () => {
  const app = await open('./probe.test.fixture.tsx', { width: 160, height: 30 })
  const expected =
    'Platform probe passed\nfs:default,exists,lstat,mkdir,readFile,readdir,readlink,rename,rmdir,stat,unlink,writeFile\nprocess:arch,dataDir,env,exit,nextTick,platform,run,spawn'
  await app.waitFor(expected)
  expect(app.shows(expected)).toBe(true)
})
