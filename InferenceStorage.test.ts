import { Array } from 'effect'
import { expect, open, test } from 'nsh/test'

test('official NSH filesystem preserves verified cache, resumable retries, and scoped cancellation', async () => {
  const app = await open('./src/inference-storage.test.fixture.tsx', { width: 800, height: 640 })
  try {
    await app.waitUntil(
      () =>
        app.shows('Model storage acceptance passed') ||
        Array.some(app.texts(), (text) => text.startsWith('Model storage acceptance failed')),
      { timeout: 30_000 },
    )
    if (!app.shows('Model storage acceptance passed')) throw new Error(Array.join(app.texts(), '\n'))
    expect(app.shows('Model storage acceptance passed')).toBe(true)
  } finally {
    app.dispose()
  }
}, 40_000)
