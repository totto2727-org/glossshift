import { Predicate, Effect } from 'effect'
import type { Scope } from 'effect'
import { Window } from 'nsh/desktop'

import type { DesktopConfiguration } from './desktop-settings.ts'
import { FaultSchema } from './ports.ts'
import type { Fault } from './ports.ts'

type MainWindow = Pick<NonNullable<ReturnType<typeof Window.get>>, 'set' | 'setBounds' | 'focus' | 'hide'> &
  Readonly<{
    onClose: (listener: () => void) => () => void
  }>
const currentWindow = (): MainWindow | null => {
  const window = Window.get('main')
  return Predicate.isNullish(window)
    ? window
    : {
        focus: () => window.focus(),
        hide: () => window.hide(),
        onClose: (listener) => window.on('closePress', listener),
        set: (attributes) => window.set(attributes),
        setBounds: (bounds) => window.setBounds(bounds),
      }
}
const unavailable = (): Fault =>
  FaultSchema.make({
    message: 'The translation window could not be initialized.',
  })

/**
 * Configure the retained, initially hidden stock window before its first explicit focus.
 *
 * @param {DesktopConfiguration} configuration Initial and minimum dimensions.
 * @param {boolean} background Keep the window hidden at startup.
 * @param {Function} mainWindow Lookup of the retained main window.
 * @returns {Effect.Effect} Native window configuration and scoped close handling.
 */
export const installDesktopWindow = (
  configuration: DesktopConfiguration,
  background: boolean,
  mainWindow: () => MainWindow | null = currentWindow,
): Effect.Effect<undefined, Fault, Scope.Scope> =>
  Effect.gen(function* () {
    const window = mainWindow()
    if (Predicate.isNullish(window)) {
      return yield* Effect.fail(unavailable())
    }
    yield* Effect.try({
      catch: unavailable,
      try: () => {
        window.set({
          closeOnPress: false,
          minSize: { height: configuration.window.min_height, width: configuration.window.min_width },
        })
        window.setBounds({ size: { height: configuration.window.height, width: configuration.window.width } })
      },
    })
    yield* Effect.acquireRelease(
      Effect.try({ catch: unavailable, try: () => window.onClose(() => window.hide()) }),
      (stop) => Effect.sync(stop),
    )
    if (!background) {
      yield* Effect.try({ catch: unavailable, try: () => window.focus() })
    }
  })
