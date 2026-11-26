import { Array } from 'effect'
import { expect, open, test } from 'nsh/test'

const labels = ['GlossShift', 'Source heading', 'Translation heading', 'let safe = true;', 'Alt only']

test('NSH popup renders native safe Markdown, toggles plain text, and dispatches Copy', async () => {
  const app = await open('./ui.test.fixture.tsx')
  await app.waitFor('Translation complete')
  const rendered = app.texts()
  Array.forEach(labels, (label) => expect(rendered).toContain(label))
  await app.press('label:Plain text')
  expect(app.texts()).toContain('# Source heading\n\nSelected **before** activation.')
  await app.press('Copy Translation')
  await app.waitFor('Text copied')
  await app.press('label:Plain text')
  expect(app.texts()).toContain('Translation heading')
})

type OpenPopup = Awaited<ReturnType<typeof open>>

const exerciseRemainingControls = async (app: OpenPopup): Promise<void> => {
  await app.press('label:Copy Translation')
  await app.press('label:Plain text')
  await app.press('label:Plain text')
  await app.press('label:Cancel translation')
  await app.press('Hide')
  await app.press('Quit')
}

test('NSH popup controls remain operable at the supported 320 by 180 minimum', async () => {
  const app = await open('./ui.test.fixture.tsx', { height: 180, platform: 'macos', width: 320 })
  await app.waitFor('Translation complete')
  await app.press('label:Copy Source')
  await app.waitFor('Text copied')
  await exerciseRemainingControls(app)
  expect(app.requests()).toEqual([])
  expect(app.openedUrls()).toEqual([])
})
