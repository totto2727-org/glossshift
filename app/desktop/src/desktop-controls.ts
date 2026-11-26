import { Data, Predicate, Effect, MutableRef, Option } from 'effect'
import type { Scope } from 'effect'
import { Clipboard } from 'nsh'
import { Application, Tray, Window } from 'nsh/desktop'

import icon from '#desktop/tray-icon.svg'

import { FaultSchema } from './ports.ts'
import type { Fault, NativePorts } from './ports.ts'

class MissingMainWindow extends Data.TaggedError('MissingMainWindow')<{ message: string }> {}

type DesktopBoundary = Readonly<{
  writeText: typeof Clipboard.writeText
  mainWindow: () => Pick<NonNullable<ReturnType<typeof Window.get>>, 'focus' | 'hide'> | null
  quit: typeof Application.quit
  setTray: typeof Tray.set
}>

const boundary: DesktopBoundary = {
  mainWindow: () => Window.get('main'),
  quit: () => Application.quit(),
  setTray: (options) => Tray.set(options),
  writeText: (text) => Clipboard.writeText(text),
}
type Controls = Pick<NativePorts, 'copy' | 'reveal' | 'hide' | 'quit'>

const fault = (message: string): Fault => FaultSchema.make({ message })
const sync = <A>(operation: () => A, message: string): Effect.Effect<A, Fault> =>
  Effect.try({ catch: () => fault(message), try: operation })

/**
 * One app-wide tray. An old scope must never remove its replacement's icon.
 *
 * @param {DesktopBoundary} native Clipboard, window, application, and tray operations.
 * @returns {object} The desktop ports and the scoped tray installation.
 */
export const createDesktopControls = (
  native: DesktopBoundary = boundary,
): Readonly<{ controls: Controls; install: Effect.Effect<Controls, Fault, Scope.Scope> }> => {
  const owner = MutableRef.make(Option.none<object>())
  const windowAction = (action: 'focus' | 'hide', message: string): Effect.Effect<void, Fault> =>
    sync(() => {
      const window = native.mainWindow()
      if (Predicate.isNullish(window)) {
        throw new MissingMainWindow({ message: 'Main window unavailable' })
      }
      window[action]()
    }, message)
  const controls = {
    copy: (text: string) =>
      Effect.tryPromise({
        catch: () => fault('The text could not be copied.'),
        try: () => native.writeText(text),
      }),
    hide: windowAction('hide', 'The translation window could not be hidden.'),
    quit: sync(() => native.quit(), 'GlossShift could not quit.'),
    reveal: windowAction('focus', 'The translation window could not be revealed.'),
  } satisfies Controls
  const install = Effect.acquireRelease(
    sync(() => {
      const lease = {}
      native.setTray({
        icon,
        menu: [{ label: 'Quit GlossShift', onSelect: () => native.quit() }],
        onClick: () => native.mainWindow()?.focus(),
        tooltip: 'GlossShift',
      })
      MutableRef.set(owner, Option.some(lease))
      return lease
    }, 'The GlossShift menu bar icon could not be initialized.'),
    (lease) =>
      sync(() => {
        if (!Option.exists(MutableRef.get(owner), (active) => active === lease)) {
          return
        }
        MutableRef.set(owner, Option.none())
        // oxlint-disable-next-line unicorn/no-null -- NSH Tray.set(null) clears the native menu bar icon.
        native.setTray(null)
      }, 'The GlossShift menu bar icon could not be removed.').pipe(Effect.ignore),
  ).pipe(Effect.as(controls))
  return { controls, install }
}

// Shared across connections so delayed remount cleanup cannot clear a new tray.
export const desktopControls = createDesktopControls()
