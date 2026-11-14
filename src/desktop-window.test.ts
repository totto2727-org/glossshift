import { Effect, Option } from 'effect'
import { expect, test } from 'nsh/test'

import type { DesktopConfiguration } from './desktop-settings'
import { installDesktopWindow } from './desktop-window'

const configuration: DesktopConfiguration = {
  shortcuts: [],
  directory: '/synthetic',
  created_files: false,
  window: { width: 700, height: 420, min_width: 320, min_height: 180 },
}
const fixture = () => {
  const events: string[] = []
  let close = Option.none<() => void>()
  const window: NonNullable<ReturnType<NonNullable<Parameters<typeof installDesktopWindow>[2]>>> = {
    set: (attributes) => {
      events.push(`attributes:${JSON.stringify(attributes)}`)
    },
    setBounds: (bounds) => {
      events.push(`bounds:${JSON.stringify(bounds)}`)
    },
    focus: () => {
      events.push('focus')
    },
    hide: () => {
      events.push('hide')
    },
    onClose: (listener) => {
      close = Option.some(listener)
      events.push('listen')
      return () => {
        close = Option.none()
        events.push('unlisten')
      }
    },
  }
  return { events, window, close: () => Option.getOrThrow(close)() }
}

test('normal desktop startup sets bounds and retained-close policy before focusing', async () => {
  const f = fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* installDesktopWindow(configuration, false, () => f.window)
        expect(f.events).toEqual([
          'attributes:{"closeOnPress":false,"minSize":{"width":320,"height":180}}',
          'bounds:{"size":{"width":700,"height":420}}',
          'listen',
          'focus',
        ])
        f.close()
        expect(f.events[f.events.length - 1]).toBe('hide')
      }),
    ),
  )
  expect(f.events[f.events.length - 1]).toBe('unlisten')
})

test('background desktop setup never focuses or briefly shows the window', async () => {
  const f = fixture()
  await Effect.runPromise(Effect.scoped(installDesktopWindow(configuration, true, () => f.window)))
  expect(f.events).toEqual([
    'attributes:{"closeOnPress":false,"minSize":{"width":320,"height":180}}',
    'bounds:{"size":{"width":700,"height":420}}',
    'listen',
    'unlisten',
  ])
})

test('missing retained window produces a public initialization fault', async () => {
  expect(
    await Effect.runPromise(Effect.scoped(installDesktopWindow(configuration, false, () => null)).pipe(Effect.flip)),
  ).toEqual({
    _tag: 'ActionRequired',
    message: 'The translation window could not be initialized.',
  })
})
