import { expect, open, test } from 'nsh/test'

test('platform adapters isolate services and reject unsupported operations', async () => {
  const app = await open('./probe.test.fixture.tsx', { height: 30, width: 160 })
  const expected = 'Platform probe passed'
  await app.waitFor(expected)
  expect(app.shows(expected)).toBe(true)
})
