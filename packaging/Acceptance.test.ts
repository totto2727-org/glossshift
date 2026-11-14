import { Array } from 'effect'
import { expect, open, test } from 'nsh/test'

test('production headless entry and shell launcher preserve isolated subprocess contracts', async () => {
  const app = await open('./acceptance.fixture/App.tsx', { width: 180, height: 30 })
  const expected = 'Acceptance passed: 7 production entry cases, 13 launcher cases including real PTY'
  await app.waitUntil(
    () =>
      Array.some(app.texts(), (text) => text.startsWith('Acceptance passed:') || text.startsWith('Acceptance failed:')),
    { timeout: 120_000 },
  )
  expect(app.texts()).toEqual([expected])
}, 130_000)
