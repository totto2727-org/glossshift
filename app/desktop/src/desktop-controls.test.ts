import { Effect, Exit, Scope } from 'effect'
import { expect, test } from 'nsh/test'

import { createDesktopControls } from './desktop-controls'

type Boundary = NonNullable<Parameters<typeof createDesktopControls>[0]>
const fixture = () => {
  const events: string[] = []
  let tray: Parameters<Boundary['setTray']>[0] = null
  const boundary: Boundary = {
    writeText: (text) => {
      events.push(`copy:${text}`)
      return Effect.runPromise(Effect.void)
    },
    mainWindow: () => ({ focus: () => events.push('focus'), hide: () => events.push('hide') }),
    quit: () => {
      events.push('quit')
    },
    setTray: (options) => {
      tray = options
      events.push(options === null ? 'tray:remove' : 'tray:install')
    },
  }
  return { events, boundary, tray: () => tray }
}
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

test('desktop ports copy raw text and focus or hide the retained main window only on demand', async () => {
  const f = fixture()
  const desktop = createDesktopControls(f.boundary)
  expect(f.events).toEqual([])
  await run(
    Effect.gen(function* () {
      yield* desktop.controls.copy('# raw\n<literal>\u001b[0m')
      yield* desktop.controls.reveal
      yield* desktop.controls.hide
      yield* desktop.controls.quit
    }),
  )
  expect(f.events).toEqual(['copy:# raw\n<literal>\u001b[0m', 'focus', 'hide', 'quit'])
})

test('tray offers reopen and quit actions and is removed when its scope ends', async () => {
  const f = fixture()
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        yield* createDesktopControls(f.boundary).install
        const tray = f.tray()
        if (tray === null) return yield* Effect.die('Missing tray')
        expect(tray.tooltip).toBe('GlossShift')
        tray.onClick?.({ bounds: null })
        const item = tray.menu?.[0]
        if (!item || !('label' in item)) return yield* Effect.die('Missing Quit item')
        expect(item.label).toBe('Quit GlossShift')
        item.onSelect?.()
      }),
    ),
  )
  expect(f.events).toEqual(['tray:install', 'focus', 'quit', 'tray:remove'])
})

test('closing an old desktop scope cannot remove a replacement tray', async () => {
  const f = fixture()
  const desktop = createDesktopControls(f.boundary)
  await run(
    Effect.gen(function* () {
      const previous = yield* Scope.make()
      const replacement = yield* Scope.make()
      yield* desktop.install.pipe(Effect.provideService(Scope.Scope, previous))
      yield* desktop.install.pipe(Effect.provideService(Scope.Scope, replacement))
      yield* Scope.close(previous, Exit.void)
      expect(f.events).toEqual(['tray:install', 'tray:install'])
      yield* Scope.close(replacement, Exit.void)
    }),
  )
  expect(f.events).toEqual(['tray:install', 'tray:install', 'tray:remove'])
})

test('tray initialization failure is public and teardown errors do not prevent scope closure', async () => {
  const f = fixture()
  const unavailable = createDesktopControls({
    ...f.boundary,
    setTray: () => {
      throw new Error('private native details')
    },
  })
  expect(await run(Effect.scoped(unavailable.install).pipe(Effect.flip))).toEqual({
    _tag: 'ActionRequired',
    message: 'The GlossShift menu bar icon could not be initialized.',
  })
  let removed = false
  const desktop = createDesktopControls({
    ...f.boundary,
    setTray: (options) => {
      if (options === null) {
        removed = true
        throw new Error('private teardown details')
      }
      f.boundary.setTray(options)
    },
  })
  await run(Effect.scoped(desktop.install))
  expect(removed).toBe(true)
  expect(f.events).toEqual(['tray:install'])
})

test('missing windows and clipboard failures expose public action-required messages', async () => {
  const f = fixture()
  const desktop = createDesktopControls({
    ...f.boundary,
    mainWindow: () => null,
    writeText: () => Effect.runPromise(Effect.fail('private native details')),
  })
  const reveal = await run(desktop.controls.reveal.pipe(Effect.flip))
  const copy = await run(desktop.controls.copy('private source').pipe(Effect.flip))
  expect(reveal).toEqual({ _tag: 'ActionRequired', message: 'The translation window could not be revealed.' })
  expect(copy).toEqual({ _tag: 'ActionRequired', message: 'The text could not be copied.' })
  expect(f.events).toEqual([])
})
