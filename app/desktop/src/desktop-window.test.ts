import { Effect, MutableRef, Option } from 'effect'
import { expect, test } from 'nsh/test'

import type { DesktopConfiguration } from './desktop-settings.ts'
import { installDesktopWindow } from './desktop-window.ts'
import { FaultSchema } from './ports.ts'

const configuration: DesktopConfiguration = {
  created_files: false,
  directory: '/synthetic',
  shortcuts: [],
  window: { height: 420, min_height: 180, min_width: 320, width: 700 },
}
type WindowHandle = NonNullable<ReturnType<NonNullable<Parameters<typeof installDesktopWindow>[2]>>>

interface WindowFixture {
  close: () => void
  events: Readonly<string[]>
  window: WindowHandle
}

const fixture = (): WindowFixture => {
  const events: string[] = []
  const close = MutableRef.make(Option.none<() => void>())
  const window: WindowHandle = {
    focus: () => {
      events.push('focus')
    },
    hide: () => {
      events.push('hide')
    },
    onClose: (listener) => {
      MutableRef.set(close, Option.some(listener))
      events.push('listen')
      return () => {
        MutableRef.set(close, Option.none())
        events.push('unlisten')
      }
    },
    set: (attributes) => {
      events.push(`attributes:${JSON.stringify(attributes)}`)
    },
    setBounds: (bounds) => {
      events.push(`bounds:${JSON.stringify(bounds)}`)
    },
  }
  return { close: () => Option.getOrThrow(MutableRef.get(close))(), events, window }
}

test('normal desktop startup sets bounds and retained-close policy before focusing', async () => {
  const testContext = fixture()
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* installDesktopWindow(configuration, false, () => testContext.window)
        expect(testContext.events).toEqual([
          'attributes:{"closeOnPress":false,"minSize":{"height":180,"width":320}}',
          'bounds:{"size":{"height":420,"width":700}}',
          'listen',
          'focus',
        ])
        testContext.close()
        expect(testContext.events.at(-1)).toBe('hide')
      }),
    ),
  )
  expect(testContext.events.at(-1)).toBe('unlisten')
})

test('background desktop setup never focuses or briefly shows the window', async () => {
  const testContext = fixture()
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
  await Effect.runPromise(Effect.scoped(installDesktopWindow(configuration, true, () => testContext.window)))
  expect(testContext.events).toEqual([
    'attributes:{"closeOnPress":false,"minSize":{"height":180,"width":320}}',
    'bounds:{"size":{"height":420,"width":700}}',
    'listen',
    'unlisten',
  ])
})

test('missing retained window produces a public initialization fault', async () => {
  // oxlint-disable-next-line unicorn/no-null -- NSH returns null when the retained window is missing.
  const missing = installDesktopWindow(configuration, false, () => null)
  const invalid = Effect.scoped(missing).pipe(Effect.flip)
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner executes the missing-window case.
  const result = await Effect.runPromise(invalid)
  expect(result).toEqual(
    FaultSchema.make({
      message: 'The translation window could not be initialized.',
    }),
  )
})
