import {
  Array,
  Effect,
  HashSet,
  MutableHashMap,
  Option,
  pipe,
  Queue,
  Record as Records,
  Schema,
  Stream,
  String,
} from 'effect'
import { GlobalShortcut } from 'nsh/desktop'

import type { NativeCommand } from './application'
import type { DesktopConfiguration } from './desktop-settings'
import { RequestId } from './domain'
import type { Fault } from './ports'

const owners = MutableHashMap.empty<string, object>()
let session = 0
const fault = (): Fault => ({
  _tag: 'ActionRequired',
  message: 'A translation shortcut could not be registered. Check config.toml and other applications.',
})
type ShortcutBoundary = Pick<typeof GlobalShortcut, 'register' | 'unregister'>

const modifiers: Readonly<Record<string, string>> = {
  control: 'ctrl',
  option: 'alt',
  command: 'cmd',
  meta: 'cmd',
  super: 'cmd',
  win: 'cmd',
  mod: 'cmd',
  cmdorctrl: 'cmd',
  commandorcontrol: 'cmd',
}
const keys: Readonly<Record<string, string>> = {
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  bracketleft: '[',
  bracketright: ']',
  backquote: '`',
  equal: '=',
  minus: '-',
}

/** Preserve the existing global-hotkey configuration spelling at the NSH boundary. */
export const normalizeShortcut = (configured: string) => {
  const parts = pipe(String.split(String.toLowerCase(configured), '+'), Array.map(String.trim))
  const key = Option.getOrElse(Array.last(parts), () => '')
  const normalized = Option.getOrElse(Records.get(keys, key), () =>
    pipe(key, String.replace(/^key([a-z])$/u, '$1'), String.replace(/^digit([0-9])$/u, '$1')),
  )
  return pipe(
    parts,
    Array.dropRight(1),
    Array.map((part) => Option.getOrElse(Records.get(modifiers, part), () => part)),
    Array.sort(String.Order),
    Array.append(normalized),
    Array.join('+'),
  )
}

/** A separate latest-request capture stream cannot wait behind translation deltas. */
export const connectDesktopShortcuts = (
  configuration: DesktopConfiguration,
  capture: Effect.Effect<string, Fault>,
  boundary: ShortcutBoundary = GlobalShortcut,
) =>
  Effect.gen(function* () {
    const queue = yield* Queue.sliding<string>(1)
    yield* Effect.addFinalizer(() => Queue.shutdown(queue))
    const generation = ++session
    let sequence = 0
    let configured = HashSet.empty<string>()
    for (const shortcut of configuration.shortcuts) {
      const key = normalizeShortcut(shortcut.keys)
      if (HashSet.has(configured, key)) return yield* Effect.fail(fault())
      configured = HashSet.add(configured, key)
      const lease = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const lease = {}
          MutableHashMap.set(owners, key, lease)
          return lease
        }),
        (lease) =>
          Effect.sync(() => {
            if (!Option.exists(MutableHashMap.get(owners, key), (owner) => owner === lease)) return
            MutableHashMap.remove(owners, key)
            boundary.unregister(key)
          }).pipe(Effect.ignore),
      )
      const registered = yield* Effect.tryPromise({
        try: () =>
          boundary.register(key, () => {
            if (Option.exists(MutableHashMap.get(owners, key), (owner) => owner === lease))
              Queue.offerUnsafe(queue, shortcut.target_language)
          }),
        catch: fault,
      })
      if (!registered) return yield* Effect.fail(fault())
    }
    return Stream.fromQueue(queue).pipe(
      Stream.switchMap((targetLanguage) =>
        Stream.fromEffect(
          capture.pipe(
            Effect.map((text): NativeCommand => ({
              _tag: 'Captured',
              id: Schema.decodeUnknownSync(RequestId)(`desktop-${generation}-${++sequence}`),
              text,
              targetLanguage,
            })),
            Effect.catchTag('ActionRequired', (error) =>
              Effect.succeed<NativeCommand>({ _tag: 'CaptureFailed', message: error.message }),
            ),
          ),
        ),
      ),
    )
  })
