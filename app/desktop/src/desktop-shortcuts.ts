import { Array, Effect, HashSet, MutableHashMap, MutableRef, Option, pipe, Queue, Record, Stream, String } from 'effect'
import type { Scope } from 'effect'
import { GlobalShortcut } from 'nsh/desktop'

import type { DesktopConfiguration } from './desktop-settings.ts'
import { NativeCommands, RequestIdSchema } from './domain.ts'
import type { NativeCommand } from './domain.ts'
import { FaultSchema } from './ports.ts'
import type { Fault } from './ports.ts'

const owners = MutableHashMap.empty<string, object>()
const initialRequestSequence = 0
const session = MutableRef.make(initialRequestSequence)
const fault = (): Fault =>
  FaultSchema.make({
    message: 'A translation shortcut could not be registered. Check config.toml and other applications.',
  })
export type ShortcutBoundary = Pick<typeof GlobalShortcut, 'register' | 'unregister'>

const modifiers: Readonly<Record<string, string>> = {
  cmdorctrl: 'cmd',
  command: 'cmd',
  commandorcontrol: 'cmd',
  control: 'ctrl',
  meta: 'cmd',
  mod: 'cmd',
  option: 'alt',
  super: 'cmd',
  win: 'cmd',
}
const keys: Readonly<Record<string, string>> = {
  backquote: '`',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  comma: ',',
  equal: '=',
  minus: '-',
  period: '.',
  quote: "'",
  semicolon: ';',
  slash: '/',
}

/**
 * Preserve the existing global-hotkey configuration spelling at the NSH boundary.
 *
 * @param {string} configured Shortcut spelling from the desktop configuration.
 * @returns {string} Shortcut spelling accepted by NSH.
 */
export const normalizeShortcut = (configured: string): string => {
  const parts = pipe(String.split(String.toLowerCase(configured), '+'), Array.map(String.trim))
  const key = Option.getOrElse(Array.last(parts), () => '')
  const normalized = Option.getOrElse(Record.get(keys, key), () =>
    pipe(key, String.replace(/^key(?<key>[a-z])$/u, '$<key>'), String.replace(/^digit(?<key>[0-9])$/u, '$<key>')),
  )
  const keyPartCount = 1
  const prefix = Array.dropRight(parts, keyPartCount)
  const typed = Array.map(prefix, (part) => Option.getOrElse(Record.get(modifiers, part), () => part))
  return Array.join([...typed.toSorted(String.Order), normalized], '+')
}

const captureQueueCapacity = 1

const ownsShortcut = (key: string, lease: object): boolean =>
  Option.exists(MutableHashMap.get(owners, key), (owner) => owner === lease)

const leaseShortcut = (key: string, boundary: ShortcutBoundary): Effect.Effect<object, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const marker = {}
      MutableHashMap.set(owners, key, marker)
      return marker
    }),
    (lease) =>
      Effect.sync(() => {
        if (ownsShortcut(key, lease)) {
          MutableHashMap.remove(owners, key)
          boundary.unregister(key)
        }
      }).pipe(Effect.ignore),
  )

const registerShortcut = (
  key: string,
  activate: () => void,
  boundary: ShortcutBoundary,
): Effect.Effect<void, Fault, Scope.Scope> =>
  Effect.gen(function* () {
    const lease = yield* leaseShortcut(key, boundary)
    const registered = yield* Effect.tryPromise({
      catch: fault,
      try: () =>
        boundary.register(key, () => {
          if (ownsShortcut(key, lease)) {
            activate()
          }
        }),
    })
    if (!registered) {
      return yield* Effect.fail(fault())
    }
  })

type NextRequest = () => typeof RequestIdSchema.Type

const failedCapture = (error: Fault): Effect.Effect<NativeCommand> =>
  Effect.succeed(NativeCommands.CaptureFailed({ message: error.message }))

const requestFromCapture = (
  capture: Effect.Effect<string, Fault>,
  targetLanguage: string,
  nextId: NextRequest,
): Stream.Stream<NativeCommand> => {
  const command = capture.pipe(
    Effect.map((text): NativeCommand => NativeCommands.Captured({ id: nextId(), targetLanguage, text })),
    Effect.catchTag('ActionRequired', failedCapture),
  )
  return Stream.fromEffect(command)
}

/**
 * A separate latest-request capture stream cannot wait behind translation deltas.
 *
 * @param {DesktopConfiguration} configuration Configured key bindings and target languages.
 * @param {Effect.Effect} capture Capture of the currently selected source text.
 * @param {ShortcutBoundary} boundary Native registration operations.
 * @returns {Effect.Effect} The scoped stream of captured requests and actionable failures.
 */
export const connectDesktopShortcuts = (
  configuration: DesktopConfiguration,
  capture: Effect.Effect<string, Fault>,
  boundary: ShortcutBoundary = GlobalShortcut,
): Effect.Effect<Stream.Stream<NativeCommand>, Fault, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.sliding<string>(captureQueueCapacity)
    yield* Effect.addFinalizer(() => Queue.shutdown(queue))
    const generation = MutableRef.incrementAndGet(session)
    const sequence = MutableRef.make(initialRequestSequence)
    const nextId: NextRequest = () =>
      RequestIdSchema.make(`desktop-${generation}-${MutableRef.incrementAndGet(sequence)}`)
    yield* Effect.reduce(configuration.shortcuts, HashSet.empty<string>, (configured, shortcut) =>
      Effect.gen(function* () {
        const key = normalizeShortcut(shortcut.keys)
        if (HashSet.has(configured, key)) {
          return yield* Effect.fail(fault())
        }
        yield* registerShortcut(
          key,
          () => {
            Queue.offerUnsafe(queue, shortcut.target_language)
          },
          boundary,
        )
        return HashSet.add(configured, key)
      }),
    )
    return Stream.fromQueue(queue).pipe(
      Stream.switchMap((targetLanguage) => requestFromCapture(capture, targetLanguage, nextId)),
    )
  })
