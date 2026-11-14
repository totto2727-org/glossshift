import { Array } from 'effect'
import { expect, open, test } from 'nsh/test'

// Run explicitly with isolated file-URI configuration and the already verified local GGUF.
// The production NSH entry executes Effect AI and the official llama-server without Node.
test('the official terminal runtime translates the cached GGUF in both directions without Node', async () => {
  const app = await open('./terminal/App.tsx', { width: 800, height: 640, network: 'live' })
  try {
    await app.waitUntil(() => app.shows('Ready') || app.shows('Created application configuration'), { timeout: 20_000 })
    await app.type('label:Source text', 'Hello, world.')
    await app.clear('label:Target language')
    await app.type('label:Target language', 'ja')
    await app.press('Translate')
    await app.waitUntil(() => app.shows('Translation complete') || app.shows('Action required'), { timeout: 120_000 })
    if (!app.shows('Translation complete')) throw new Error(Array.join(app.texts(), '\n'))
    await app.press('label:Plain text')
    const japanese = Array.join(app.texts(), '\n')
    expect(/[\u3040-\u30ff\u4e00-\u9fff]/u.test(japanese)).toBe(true)
    expect(japanese.includes('<|plamo:')).toBe(false)
    await app.clear('label:Source text')
    await app.type('label:Source text', 'こんにちは、世界。')
    await app.clear('label:Target language')
    await app.type('label:Target language', 'en')
    await app.press('Translate')
    await app.waitUntil(() => app.shows('Translation complete') || app.shows('Action required'), { timeout: 60_000 })
    if (!app.shows('Translation complete')) throw new Error(Array.join(app.texts(), '\n'))
    expect(/hello|world/iu.test(Array.join(app.texts(), '\n'))).toBe(true)
  } finally {
    app.dispose()
  }
}, 240_000)
