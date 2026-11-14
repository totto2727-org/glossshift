import { Effect } from 'effect'
import { Window } from 'nsh/desktop'

import type { DesktopConfiguration } from './desktop-settings'
import type { Fault } from './ports'

type MainWindow = Pick<NonNullable<ReturnType<typeof Window.get>>, 'set' | 'setBounds' | 'focus' | 'hide'> & {
  readonly onClose: (listener: () => void) => () => void
}
const currentWindow = (): MainWindow | null => {
  const window = Window.get('main')
  return window === null
    ? null
    : {
        set: (attributes) => window.set(attributes),
        setBounds: (bounds) => window.setBounds(bounds),
        focus: () => window.focus(),
        hide: () => window.hide(),
        onClose: (listener) => window.on('closePress', listener),
      }
}
const unavailable = (): Fault => ({
  _tag: 'ActionRequired',
  message: 'The translation window could not be initialized.',
})

/** Configure the retained, initially hidden stock window before its first explicit focus. */
export const installDesktopWindow = (
  configuration: DesktopConfiguration,
  background: boolean,
  mainWindow: () => MainWindow | null = currentWindow,
) =>
  Effect.gen(function* () {
    const window = mainWindow()
    if (window === null) return yield* Effect.fail(unavailable())
    yield* Effect.try({
      try: () => {
        window.set({
          closeOnPress: false,
          minSize: { width: configuration.window.min_width, height: configuration.window.min_height },
        })
        window.setBounds({ size: { width: configuration.window.width, height: configuration.window.height } })
      },
      catch: unavailable,
    })
    yield* Effect.acquireRelease(
      Effect.try({ try: () => window.onClose(() => window.hide()), catch: unavailable }),
      (stop) => Effect.sync(stop),
    )
    if (!background) yield* Effect.try({ try: () => window.focus(), catch: unavailable })
  })
