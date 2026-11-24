import { defaultDesktopConfig, parseDesktopConfig } from '@glossshift/runtime/desktop-config'
import { Array, Effect, Result } from 'effect'
import { expect, test } from 'nsh/test'

const runConfig = <A, E>(effect: Effect.Effect<A, E>): A =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- NSH's test callback runs the pure configuration parser synchronously.
  Effect.runSync(effect)
const parse = (source: string): Effect.Success<ReturnType<typeof parseDesktopConfig>> =>
  runConfig(parseDesktopConfig(source))
const rejected = (source: string): boolean => {
  const result = runConfig(Effect.result(parseDesktopConfig(source)))
  return Result.isFailure(result)
}

test('desktop TOML parsing executes directly in the official NSH host', () => {
  expect(parse(defaultDesktopConfig)).toEqual({
    shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'Japanese' }],
    window: { height: 360, min_height: 180, min_width: 320, width: 560 },
  })
  expect(parse(`${defaultDesktopConfig}\n[unused]\nlegacy_limit = 9223372036854775807\n`).window.width).toBe(560)
})

test('desktop TOML duplicate keys and duplicate tables are rejected instead of silently overwritten', () => {
  expect(rejected(`${defaultDesktopConfig}\nwidth = 700\n`)).toBe(true)
  expect(rejected(`${defaultDesktopConfig}\n[window]\nwidth = 700\n`)).toBe(true)
})

test('desktop TOML rejects unsafe window sizes and empty shortcut values in NSH', () => {
  const dimensions = [
    ['width', '560'],
    ['height', '360'],
    ['min_width', '320'],
    ['min_height', '180'],
  ] as const
  const unsafeValues = ['nan', 'inf', '-inf', '2147483648', '0', '-1']
  Array.forEach(dimensions, ([field, original]) => {
    Array.forEach(unsafeValues, (value) => {
      const config = defaultDesktopConfig.replace(`${field} = ${original}`, `${field} = ${value}`)
      expect(rejected(config)).toBe(true)
    })
  })
  expect(rejected(defaultDesktopConfig.replace('width = 560', 'width = 100'))).toBe(true)
  expect(rejected('shortcuts = []\n[window]\nwidth=560\nheight=360\nmin_width=320\nmin_height=180')).toBe(true)
  expect(rejected(defaultDesktopConfig.replace('"Japanese"', '"  "'))).toBe(true)
  expect(rejected(defaultDesktopConfig.replace('"Ctrl+Super+KeyJ"', '""'))).toBe(true)
})
