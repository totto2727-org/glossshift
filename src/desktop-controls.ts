import { Effect } from 'effect'
import { Clipboard } from 'nsh'
import { Application, Tray, Window } from 'nsh/desktop'

import icon from '../packaging/tray-icon.svg'
import type { Fault, NativePorts } from './ports'

type DesktopBoundary = {
  readonly writeText: typeof Clipboard.writeText
  readonly mainWindow: () => Pick<NonNullable<ReturnType<typeof Window.get>>, 'focus' | 'hide'> | null
  readonly quit: typeof Application.quit
  readonly setTray: typeof Tray.set
}

const boundary: DesktopBoundary = {
  writeText: (text) => Clipboard.writeText(text),
  mainWindow: () => Window.get('main'),
  quit: () => Application.quit(),
  setTray: (options) => Tray.set(options),
}
const fault = (message: string): Fault => ({ _tag: 'ActionRequired', message })

/** One app-wide tray. An old scope must never remove its replacement's icon. */
export const createDesktopControls = (native: DesktopBoundary = boundary) => {
  let owner: object | undefined
  const sync = <A>(operation: () => A, message: string) => Effect.try({ try: operation, catch: () => fault(message) })
  const windowAction = (action: 'focus' | 'hide', message: string) =>
    sync(() => {
      const window = native.mainWindow()
      if (window === null) throw new Error('Main window unavailable')
      window[action]()
    }, message)
  const controls = {
    copy: (text: string) =>
      Effect.tryPromise({
        try: () => native.writeText(text),
        catch: () => fault('The text could not be copied.'),
      }),
    reveal: windowAction('focus', 'The translation window could not be revealed.'),
    hide: windowAction('hide', 'The translation window could not be hidden.'),
    quit: sync(() => native.quit(), 'GlossShift could not quit.'),
  } satisfies Pick<NativePorts, 'copy' | 'reveal' | 'hide' | 'quit'>
  const install = Effect.acquireRelease(
    sync(() => {
      const lease = {}
      native.setTray({
        icon,
        tooltip: 'GlossShift',
        onClick: () => native.mainWindow()?.focus(),
        menu: [{ label: 'Quit GlossShift', onSelect: () => native.quit() }],
      })
      owner = lease
      return lease
    }, 'The GlossShift menu bar icon could not be initialized.'),
    (lease) =>
      sync(() => {
        if (owner !== lease) return
        owner = undefined
        native.setTray(null)
      }, 'The GlossShift menu bar icon could not be removed.').pipe(Effect.ignore),
  ).pipe(Effect.as(controls))
  return { controls, install }
}

// Shared across connections so delayed remount cleanup cannot clear a new tray.
export const desktopControls = createDesktopControls()
