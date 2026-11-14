import { expect, open, test } from 'nsh/test'

test('the production Node runtime passes isolated local translation regressions', async () => {
  const app = await open('./src/node-tests.fixture/App.tsx', { width: 800, height: 640 })
  try {
    await app.waitFor('Node regressions passed', { timeout: 50_000 })
    expect(app.texts()).toContain('Node regressions passed')
  } finally {
    app.dispose()
  }
}, 60_000)
