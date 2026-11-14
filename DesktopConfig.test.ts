import { Effect, Result } from 'effect'
import { expect, open, test } from 'nsh/test'
import * as plist from 'plist'

import { defaultDesktopConfig, parseDesktopConfig } from './runtime/desktop-config.ts'

const parse = (source: string) => Effect.runSync(parseDesktopConfig(source))
const rejected = (source: string) => Result.isFailure(Effect.runSync(Effect.result(parseDesktopConfig(source))))

test('plist round trips ordinary XML bundle metadata inside NSH', () => {
  const value = { CFBundleIdentifier: 'com.totto2727.glossshift', CFBundleExecutable: 'GlossShift' }
  expect(plist.parse(plist.build(value))).toEqual(value)
  expect(plist.parseBinary(plist.buildBinary(value))).toEqual(value)
})

test('official NSH desktop filesystem preserves configuration and autostart safety', async () => {
  const app = await open('./runtime/cli-host.fixture/Desktop.tsx', { width: 180, height: 30 })
  try {
    await app.waitUntil(() => !app.shows('Running desktop filesystem acceptance'), { timeout: 90_000 })
    expect(app.texts()).toContain('Desktop filesystem acceptance passed')
  } finally {
    app.dispose()
  }
}, 100_000)

test('desktop TOML parsing executes directly in the official NSH host', () => {
  expect(parse(defaultDesktopConfig)).toEqual({
    shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'Japanese' }],
    window: { width: 560, height: 360, min_width: 320, min_height: 180 },
  })
  expect(parse(`${defaultDesktopConfig}\n[unused]\nlegacy_limit = 9223372036854775807\n`).window.width).toBe(560)
})

test('desktop TOML duplicate keys and duplicate tables are rejected instead of silently overwritten', () => {
  expect(rejected(`${defaultDesktopConfig}\nwidth = 700\n`)).toBe(true)
  expect(rejected(`${defaultDesktopConfig}\n[window]\nwidth = 700\n`)).toBe(true)
})

test('desktop TOML rejects unsafe window sizes and empty shortcut values in NSH', () => {
  for (const [field, original] of [
    ['width', '560'],
    ['height', '360'],
    ['min_width', '320'],
    ['min_height', '180'],
  ]) {
    for (const value of ['nan', 'inf', '-inf', '2147483648', '0', '-1']) {
      expect(rejected(defaultDesktopConfig.replace(`${field} = ${original}`, `${field} = ${value}`))).toBe(true)
    }
  }
  expect(rejected(defaultDesktopConfig.replace('width = 560', 'width = 100'))).toBe(true)
  expect(rejected('shortcuts = []\n[window]\nwidth=560\nheight=360\nmin_width=320\nmin_height=180')).toBe(true)
  expect(rejected(defaultDesktopConfig.replace('"Japanese"', '"  "'))).toBe(true)
  expect(rejected(defaultDesktopConfig.replace('"Ctrl+Super+KeyJ"', '""'))).toBe(true)
})
