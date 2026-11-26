import { Effect, Fiber, Match, Option, Stream } from 'effect'
import type { Scope } from 'effect'
import { cleanup, signal } from 'nsh'
import type { JSX, Signal } from 'nsh'
import { Menu } from 'nsh/desktop'

import { createController } from './controller.ts'
import type { PopupController } from './controller.ts'
import { fail, initialState } from './domain.ts'
import type { NativeCommand, PopupState } from './domain.ts'
import type { Fault, NativePorts } from './ports.ts'
import { PopupView } from './ui.tsx'
import type { PopupViewProps } from './ui.tsx'

export type NativeConnection = Readonly<{
  ports: NativePorts
  /** Independent control transport, never blocked behind provider deltas. */
  commands: Stream.Stream<NativeCommand, Fault>
}>

type Dispatch = (action: (controller: PopupController) => Effect.Effect<void>) => void

const handleCommands = (controller: PopupController): ((command: NativeCommand) => Effect.Effect<void>) =>
  Match.type<NativeCommand>().pipe(
    Match.tagsExhaustive({
      CaptureFailed: (command) => controller.captureFailed(command.message),
      Captured: controller.requestCaptured,
      Reopened: () => Effect.void,
    }),
  )

/**
 * The component lifetime owns exactly one Effect scope and native connection.
 *
 * @param {Effect.Effect} connect Allocation of the native ports and shortcut stream.
 * @param {string} guidance Optional message shown before the first request.
 * @returns {object} The current popup state and its action dispatcher.
 */
const usePopupConnection = (
  connect: Effect.Effect<NativeConnection, Fault, Scope.Scope>,
  guidance?: string,
): Readonly<{
  dispatch: Dispatch
  state: Signal<PopupState>
}> => {
  const state = signal(initialState('Starting GlossShift', guidance))
  const controller = signal(Option.none<PopupController>())
  const program = Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* connect
      const instance = yield* createController(connection.ports, guidance)
      controller.set(Option.some(instance))
      yield* instance.snapshots.pipe(
        Stream.runForEach((snapshot) => Effect.sync(() => state.set(snapshot))),
        Effect.forkScoped,
      )
      yield* Stream.runForEach(connection.commands, handleCommands(instance))
      yield* Effect.never
    }),
  ).pipe(
    Effect.catchTag('ActionRequired', (fault) =>
      Effect.sync(() => state.update((previous) => fail(previous, fault.message))),
    ),
    Effect.catchDefect(() =>
      Effect.sync(() => state.update((previous) => fail(previous, 'GlossShift could not start its native service.'))),
    ),
  )
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The NSH component starts its scoped workflow when the view mounts.
  const fiber = Effect.runFork(program)
  cleanup(() => {
    // oxlint-disable-next-line rules/no-effect-runtime-run -- NSH cleanup must interrupt the mounted workflow through this callback.
    Effect.runFork(Fiber.interrupt(fiber))
  })

  const dispatch = (action: (instance: PopupController) => Effect.Effect<void>): void => {
    const current = controller()
    if (Option.isSome(current)) {
      // oxlint-disable-next-line rules/no-effect-runtime-run -- The NSH event callback starts an independent UI action.
      Effect.runFork(action(current.value))
    }
  }
  return { dispatch, state }
}

const createPopupActions = (
  dispatch: Dispatch,
): Pick<PopupViewProps, 'cancel' | 'copy' | 'hide' | 'quit' | 'setMode'> => ({
  cancel: () => dispatch((controller) => controller.cancel),
  copy: (pane) => dispatch((controller) => controller.copy(pane)),
  hide: () => dispatch((controller) => controller.hide),
  quit: () => dispatch((controller) => controller.quit),
  setMode: (mode) => dispatch((controller) => controller.setMode(mode)),
})

export const Application = (
  props: Readonly<{ connect: Effect.Effect<NativeConnection, Fault, Scope.Scope> }>,
): JSX.Element => {
  const { state, dispatch } = usePopupConnection(props.connect)
  const actions = createPopupActions(dispatch)

  Menu.setApplicationMenu([
    {
      label: 'GlossShift',
      submenu: [{ label: 'Quit GlossShift', onSelect: actions.quit, role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Copy translation',
          onSelect: () => actions.copy('Translation'),
          shortcut: 'mod+c',
        },
        {
          label: 'Copy source',
          onSelect: () => actions.copy('Source'),
          shortcut: 'mod+shift+c',
        },
      ],
    },
    {
      label: 'Window',
      submenu: [{ label: 'Close window', onSelect: actions.hide, shortcut: 'mod+w' }],
    },
  ])
  // oxlint-disable-next-line unicorn/no-null -- NSH Menu.setApplicationMenu(null) removes the native application menu.
  cleanup(() => Menu.setApplicationMenu(null))

  return (
    <PopupView
      state={state()}
      copy={actions.copy}
      setMode={actions.setMode}
      cancel={actions.cancel}
      hide={actions.hide}
      quit={actions.quit}
    />
  )
}
