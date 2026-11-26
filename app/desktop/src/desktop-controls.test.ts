import { Data, Predicate, Effect, Exit, MutableRef, Option, Scope } from 'effect'
import { expect, test } from 'nsh/test'

import { createDesktopControls } from './desktop-controls.ts'
import { FaultSchema } from './ports.ts'

class MockNativeFailure extends Data.TaggedError('MockNativeFailure')<{ message: string }> {}

type Boundary = NonNullable<Parameters<typeof createDesktopControls>[0]>
type TraySetting = Parameters<Boundary['setTray']>[0]

interface ControlFixture {
  boundary: Boundary
  events: Readonly<string[]>
  tray: () => TraySetting | undefined
}

const fixture = (): ControlFixture => {
  const events: string[] = []
  const tray = MutableRef.make(Option.none<TraySetting>())
  const boundary: Boundary = {
    mainWindow: () => ({ focus: () => events.push('focus'), hide: () => events.push('hide') }),
    quit: () => {
      events.push('quit')
    },
    setTray: (options) => {
      MutableRef.set(tray, Option.some(options))
      events.push(Predicate.isNullish(options) ? 'tray:remove' : 'tray:install')
    },
    writeText: (text) => {
      events.push(`copy:${text}`)
      // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
      return Effect.runPromise(Effect.void)
    },
  }
  return { boundary, events, tray: () => Option.getOrUndefined(MutableRef.get(tray)) }
}
// oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

test('desktop ports copy raw text and focus or hide the retained main window only on demand', async () => {
  const testContext = fixture()
  const desktop = createDesktopControls(testContext.boundary)
  expect(testContext.events).toEqual([])
  await run(
    Effect.gen(function* () {
      yield* desktop.controls.copy('# raw\n<literal>\u001B[0m')
      yield* desktop.controls.reveal
      yield* desktop.controls.hide
      yield* desktop.controls.quit
    }),
  )
  expect(testContext.events).toEqual(['copy:# raw\n<literal>\u001B[0m', 'focus', 'hide', 'quit'])
})

const exerciseTray = (tray: TraySetting | undefined): void => {
  if (Predicate.isNullish(tray)) {
    throw new MockNativeFailure({ message: 'Missing tray' })
  }
  expect(tray.tooltip).toBe('GlossShift')
  // oxlint-disable-next-line unicorn/no-null -- The click event reports null when NSH cannot locate the icon.
  tray.onClick?.({ bounds: null })
  const item = tray.menu?.[0]
  if (!item || !('label' in item)) {
    throw new MockNativeFailure({ message: 'Missing Quit item' })
  }
  expect(item.label).toBe('Quit GlossShift')
  item.onSelect?.()
}

test('tray offers reopen and quit actions and is removed when its scope ends', async () => {
  const testContext = fixture()
  const desktop = createDesktopControls(testContext.boundary)
  const runTray = Effect.andThen(
    desktop.install,
    Effect.sync(() => exerciseTray(testContext.tray())),
  )
  await run(Effect.scoped(runTray))
  expect(testContext.events).toEqual(['tray:install', 'focus', 'quit', 'tray:remove'])
})

test('closing an old desktop scope cannot remove a replacement tray', async () => {
  const testContext = fixture()
  const desktop = createDesktopControls(testContext.boundary)
  await run(
    Effect.gen(function* () {
      const previous = yield* Scope.make()
      const replacement = yield* Scope.make()
      yield* desktop.install.pipe(Effect.provideService(Scope.Scope, previous))
      yield* desktop.install.pipe(Effect.provideService(Scope.Scope, replacement))
      yield* Scope.close(previous, Exit.void)
      expect(testContext.events).toEqual(['tray:install', 'tray:install'])
      yield* Scope.close(replacement, Exit.void)
    }),
  )
  expect(testContext.events).toEqual(['tray:install', 'tray:install', 'tray:remove'])
})

const failingRemoval =
  (setTray: Boundary['setTray'], state: { removed: boolean }): Boundary['setTray'] =>
  (options) => {
    if (Predicate.isNullish(options)) {
      state.removed = true
      throw new MockNativeFailure({ message: 'private teardown details' })
    }
    setTray(options)
  }

test('tray initialization failure is public and teardown errors do not prevent scope closure', async () => {
  const testContext = fixture()
  const unavailable = createDesktopControls({
    ...testContext.boundary,
    setTray: () => {
      throw new MockNativeFailure({ message: 'private native details' })
    },
  })
  expect(await run(Effect.scoped(unavailable.install).pipe(Effect.flip))).toEqual(
    FaultSchema.make({
      message: 'The GlossShift menu bar icon could not be initialized.',
    }),
  )
  const teardown = { removed: false }
  const desktop = createDesktopControls({
    ...testContext.boundary,
    setTray: failingRemoval(testContext.boundary.setTray, teardown),
  })
  await run(Effect.scoped(desktop.install))
  expect(teardown.removed).toBe(true)
  expect(testContext.events).toEqual(['tray:install'])
})

test('missing windows and clipboard failures expose public action-required messages', async () => {
  const testContext = fixture()
  const desktop = createDesktopControls({
    ...testContext.boundary,
    // oxlint-disable-next-line unicorn/no-null -- A missing window is represented by the null result of NSH Window.get.
    mainWindow: () => null,
    // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
    writeText: () => Effect.runPromise(Effect.fail('private native details')),
  })
  const reveal = await run(desktop.controls.reveal.pipe(Effect.flip))
  const copy = await run(desktop.controls.copy('private source').pipe(Effect.flip))
  expect(reveal).toEqual(FaultSchema.make({ message: 'The translation window could not be revealed.' }))
  expect(copy).toEqual(FaultSchema.make({ message: 'The text could not be copied.' }))
  expect(testContext.events).toEqual([])
})
