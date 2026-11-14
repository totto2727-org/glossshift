import { Array } from 'effect'
import { expect, open, test } from 'nsh/test'

// Opt in explicitly with isolated settings. This uses the real GGUF and may download model weights.
test('the production prebuilt terminal app translates directly through Effect and its local model', async () => {
  const app = await open('./App.tsx', { width: 800, height: 640, network: 'live' })
  await app.waitUntil(() => app.shows('Ready') || app.shows('Created application configuration'), { timeout: 10_000 })
  await app.type('label:Source text', 'Hello, world.')
  await app.clear('label:Target language')
  await app.type('label:Target language', 'ja')
  await app.press('Translate')
  await app.waitFor('Translation complete', { timeout: 600_000 })
  await app.press('label:Plain text')
  expect(app.texts()).toContain('Hello, world.')
  expect(/[\u3040-\u30ff\u4e00-\u9fff]/u.test(Array.join(app.texts(), '\n'))).toBe(true)
  expect(/<\|plamo:/u.test(Array.join(app.texts(), '\n'))).toBe(false)
  await app.clear('label:Source text')
  await app.type('label:Source text', 'こんにちは、世界。')
  await app.clear('label:Target language')
  await app.type('label:Target language', 'en')
  await app.press('Translate')
  await app.waitFor('Translation complete', { timeout: 60_000 })
  expect(/hello|world/iu.test(Array.join(app.texts(), '\n'))).toBe(true)
  app.dispose()
}, 720_000)
