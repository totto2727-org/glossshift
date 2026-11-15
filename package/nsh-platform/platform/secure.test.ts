import { expect, open, test } from 'nsh/test'

test('NSH packaged tools support isolated secure filesystem and capture output', async () => {
  const app = await open('./secure.test.fixture.tsx', { width: 160, height: 30 })
  await app.waitFor('Secure filesystem and capture acceptance passed', { timeout: 20_000 })
  expect(app.shows('Secure filesystem and capture acceptance passed')).toBe(true)
})
