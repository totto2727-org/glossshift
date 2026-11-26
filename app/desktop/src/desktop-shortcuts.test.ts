import { Predicate, Deferred, Effect, Exit, Fiber, MutableHashMap, MutableRef, Option, Scope, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import type { DesktopConfiguration } from './desktop-settings.ts'
import { connectDesktopShortcuts, normalizeShortcut } from './desktop-shortcuts.ts'
import type { ShortcutBoundary } from './desktop-shortcuts.ts'
import type { NativeCommand, NativeCommands } from './domain.ts'
import type { Fault } from './ports.ts'

const configuration: DesktopConfiguration = {
  created_files: false,
  directory: '/synthetic',
  shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'ja' }],
  window: { height: 360, min_height: 180, min_width: 320, width: 560 },
}
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
  Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))
interface ShortcutFixture {
  boundary: ShortcutBoundary
  events: Readonly<string[]>
  press: () => void
}

const fixture = (): ShortcutFixture => {
  const callbacks = MutableHashMap.empty<string, () => void>()
  const events: string[] = []
  return {
    boundary: {
      register: async (key, onPress) => {
        events.push(`register:${key}`)
        MutableHashMap.set(callbacks, key, onPress)
        return true
      },
      unregister: (key) => {
        events.push(`unregister:${key}`)
        MutableHashMap.remove(callbacks, key)
      },
    },
    events,
    press: () => Option.getOrThrow(MutableHashMap.get(callbacks, 'cmd+ctrl+j'))(),
  }
}

type Captured = ReturnType<typeof NativeCommands.Captured>

const capturedCommand = (result: Option.Option<NativeCommand>): Captured => {
  const captured = Option.filter(result, (value) => Predicate.isTagged('Captured')(value))
  return Option.getOrThrow(captured)
}

const pressAndCapture = (
  stream: Stream.Stream<NativeCommand>,
  press: () => void,
): Effect.Effect<Captured, never, Scope.Scope> =>
  Effect.gen(function* () {
    const next = yield* stream.pipe(Stream.runHead, Effect.forkScoped)
    press()
    const result = yield* Fiber.join(next)
    return capturedCommand(result)
  })

test('legacy key codes and equivalent modifier spellings normalize to one NSH shortcut', () => {
  expect(normalizeShortcut('Ctrl+Super+KeyJ')).toBe('cmd+ctrl+j')
  expect(normalizeShortcut(' Command + Control + j ')).toBe('cmd+ctrl+j')
  expect(normalizeShortcut('Alt+Digit2')).toBe('alt+2')
  expect(normalizeShortcut('Ctrl+BracketLeft')).toBe('ctrl+[')
})

test('standard shortcut captures only on demand and preserves the source in a namespaced command', async () => {
  const testContext = fixture()
  const captures = MutableRef.make(0)
  const source = '# synthetic\n'
  const capture = Effect.sync(() => {
    MutableRef.increment(captures)
    return source
  })
  const verify = Effect.scoped(
    Effect.gen(function* () {
      const stream = yield* connectDesktopShortcuts(configuration, capture, testContext.boundary)
      expect(MutableRef.get(captures)).toBe(0)
      const result = yield* pressAndCapture(stream, testContext.press)
      expect(result.text).toBe(source)
      expect(result.targetLanguage).toBe('ja')
      expect(result.id.startsWith('desktop-')).toBe(true)
      expect(MutableRef.get(captures)).toBe(1)
    }),
  )
  await run(verify)
  expect(testContext.events).toEqual(['register:cmd+ctrl+j', 'unregister:cmd+ctrl+j'])
})

const replacementCapture = (
  started: Deferred.Deferred<true>,
  interrupted: Deferred.Deferred<true>,
): Effect.Effect<string> => {
  const count = MutableRef.make(0)
  const pending = Deferred.succeed(started, true).pipe(
    Effect.andThen(Effect.never),
    Effect.ensuring(Deferred.succeed(interrupted, true)),
  )
  return Effect.suspend(() =>
    MutableRef.incrementAndGet(count) === 1 ? pending : Effect.succeed('replacement source'),
  )
}

const verifyReplacement = (context: ShortcutFixture): Effect.Effect<Captured, Fault, Scope.Scope> =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<true>()
    const interrupted = yield* Deferred.make<true>()
    const capture = replacementCapture(started, interrupted)
    const stream = yield* connectDesktopShortcuts(configuration, capture, context.boundary)
    const command = yield* stream.pipe(Stream.runHead, Effect.forkScoped)
    context.press()
    yield* Deferred.await(started)
    context.press()
    const result = yield* Fiber.join(command).pipe(Effect.tap(() => Deferred.await(interrupted)))
    return capturedCommand(result)
  })

test('replacement shortcut capture interrupts the pending capture rather than revealing stale selection', async () => {
  const verify = Effect.scoped(verifyReplacement(fixture()))
  const result = await run(verify)
  expect(result.text).toBe('replacement source')
})

const openShortcut =
  (boundary: ShortcutBoundary) =>
  (scope: Scope.Scope, source: string): Effect.Effect<Stream.Stream<NativeCommand>, Fault> =>
    connectDesktopShortcuts(configuration, Effect.succeed(source), boundary).pipe(
      Effect.provideService(Scope.Scope, scope),
    )

test('old desktop scope cannot unregister a newly replaced shortcut', async () => {
  const testContext = fixture()
  const open = openShortcut(testContext.boundary)
  const verify = Effect.scoped(
    Effect.gen(function* () {
      const old = yield* Scope.make()
      const fresh = yield* Scope.make()
      yield* open(old, 'old')
      const stream = yield* open(fresh, 'fresh')
      yield* Scope.close(old, Exit.void)
      expect(testContext.events).toEqual(['register:cmd+ctrl+j', 'register:cmd+ctrl+j'])
      const result = yield* pressAndCapture(stream, testContext.press)
      expect(result.text).toBe('fresh')
      yield* Scope.close(fresh, Exit.void)
    }),
  )
  await run(verify)
  expect(testContext.events).toEqual(['register:cmd+ctrl+j', 'register:cmd+ctrl+j', 'unregister:cmd+ctrl+j'])
})

test('duplicate shortcut aliases fail publicly and roll back registered resources', async () => {
  const testContext = fixture()
  const duplicate = {
    ...configuration,
    shortcuts: [...configuration.shortcuts, { keys: 'Command+Control+j', target_language: 'en' }],
  }
  const scoped = Effect.scoped(connectDesktopShortcuts(duplicate, Effect.succeed('synthetic'), testContext.boundary))
  const result = await run(Effect.flip(scoped))
  expect(Predicate.isTagged('ActionRequired')(result)).toBe(true)
  expect(testContext.events).toEqual(['register:cmd+ctrl+j', 'unregister:cmd+ctrl+j'])
})
