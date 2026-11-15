import { Deferred, Effect, Exit, Fiber, MutableHashMap, Option, Scope, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import type { DesktopConfiguration } from './desktop-settings'
import { connectDesktopShortcuts, normalizeShortcut } from './desktop-shortcuts'

const configuration: DesktopConfiguration = {
  shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'ja' }],
  directory: '/synthetic',
  created_files: false,
  window: { width: 560, height: 360, min_width: 320, min_height: 180 },
}
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))
const fixture = () => {
  const callbacks = MutableHashMap.empty<string, () => void>()
  const events: string[] = []
  return {
    events,
    press: () => Option.getOrThrow(MutableHashMap.get(callbacks, 'cmd+ctrl+j'))(),
    boundary: {
      register: (key: string, callback: () => void) =>
        Effect.runPromise(
          Effect.sync(() => {
            events.push(`register:${key}`)
            MutableHashMap.set(callbacks, key, callback)
            return true
          }),
        ),
      unregister: (key: string) => {
        events.push(`unregister:${key}`)
        MutableHashMap.remove(callbacks, key)
      },
    },
  }
}

test('legacy key codes and equivalent modifier spellings normalize to one NSH shortcut', () => {
  expect(normalizeShortcut('Ctrl+Super+KeyJ')).toBe('cmd+ctrl+j')
  expect(normalizeShortcut(' Command + Control + j ')).toBe('cmd+ctrl+j')
  expect(normalizeShortcut('Alt+Digit2')).toBe('alt+2')
  expect(normalizeShortcut('Ctrl+BracketLeft')).toBe('ctrl+[')
})

test('standard shortcut captures only on demand and preserves the source in a namespaced command', async () => {
  const f = fixture()
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        let captures = 0
        const stream = yield* connectDesktopShortcuts(
          configuration,
          Effect.sync(() => {
            captures += 1
            return '# synthetic\n'
          }),
          f.boundary,
        )
        expect(captures).toBe(0)
        const command = yield* stream.pipe(Stream.runHead, Effect.forkScoped)
        f.press()
        const result = Option.getOrThrow(yield* Fiber.join(command))
        expect(result._tag).toBe('Captured')
        if (result._tag !== 'Captured') return yield* Effect.die('Expected captured command')
        expect(result.text).toBe('# synthetic\n')
        expect(result.targetLanguage).toBe('ja')
        expect(result.id.startsWith('desktop-')).toBe(true)
        expect(captures).toBe(1)
      }),
    ),
  )
  expect(f.events).toEqual(['register:cmd+ctrl+j', 'unregister:cmd+ctrl+j'])
})

test('replacement shortcut capture interrupts the pending capture rather than revealing stale selection', async () => {
  const f = fixture()
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        let count = 0
        const capture = Effect.suspend(() =>
          ++count === 1
            ? Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(interrupted, undefined)),
              )
            : Effect.succeed('replacement source'),
        )
        const stream = yield* connectDesktopShortcuts(configuration, capture, f.boundary)
        const command = yield* stream.pipe(Stream.runHead, Effect.forkScoped)
        f.press()
        yield* Deferred.await(started)
        f.press()
        const result = Option.getOrThrow(yield* Fiber.join(command))
        yield* Deferred.await(interrupted)
        if (result._tag !== 'Captured') return yield* Effect.die('Expected replacement capture')
        expect(result.text).toBe('replacement source')
      }),
    ),
  )
})

test('old desktop scope cannot unregister a newly replaced shortcut', async () => {
  const f = fixture()
  await run(
    Effect.gen(function* () {
      const old = yield* Scope.make()
      const fresh = yield* Scope.make()
      yield* connectDesktopShortcuts(configuration, Effect.succeed('old'), f.boundary).pipe(
        Effect.provideService(Scope.Scope, old),
      )
      const stream = yield* connectDesktopShortcuts(configuration, Effect.succeed('fresh'), f.boundary).pipe(
        Effect.provideService(Scope.Scope, fresh),
      )
      yield* Scope.close(old, Exit.void)
      expect(f.events).toEqual(['register:cmd+ctrl+j', 'register:cmd+ctrl+j'])
      const command = yield* stream.pipe(Stream.runHead, Effect.forkChild)
      f.press()
      const result = Option.getOrThrow(yield* Fiber.join(command))
      if (result._tag !== 'Captured') return yield* Effect.die('Expected fresh capture')
      expect(result.text).toBe('fresh')
      yield* Scope.close(fresh, Exit.void)
    }),
  )
  expect(f.events).toEqual(['register:cmd+ctrl+j', 'register:cmd+ctrl+j', 'unregister:cmd+ctrl+j'])
})

test('duplicate shortcut aliases fail publicly and roll back registered resources', async () => {
  const f = fixture()
  const result = await run(
    Effect.scoped(
      connectDesktopShortcuts(
        {
          ...configuration,
          shortcuts: [...configuration.shortcuts, { keys: 'Command+Control+j', target_language: 'en' }],
        },
        Effect.succeed('synthetic'),
        f.boundary,
      ),
    ).pipe(Effect.flip),
  )
  expect(result._tag).toBe('ActionRequired')
  expect(f.events).toEqual(['register:cmd+ctrl+j', 'unregister:cmd+ctrl+j'])
})
