import { Effect, Fiber, Option, Stream } from 'effect'
import type { Scope } from 'effect'
import { cleanup, signal } from 'nsh'
import { Menu } from 'nsh/desktop'

import { createController } from './controller'
import type { PopupController } from './controller'
import { fail, initialState } from './domain'
import type { RequestId } from './domain'
import type { Fault, NativePorts } from './ports'
import { PopupView } from './ui'

export type NativeCommand =
  | { readonly _tag: 'Captured'; readonly id: RequestId; readonly targetLanguage: string; readonly text: string }
  | { readonly _tag: 'CaptureFailed'; readonly message: string }
  | { readonly _tag: 'Reopened' }

export interface NativeConnection {
  readonly ports: NativePorts
  /** Independent control transport, never blocked behind provider deltas. */
  readonly commands: Stream.Stream<NativeCommand, Fault>
}

/** The component lifetime owns exactly one Effect scope and native connection. */
export const usePopupConnection = (connect: Effect.Effect<NativeConnection, Fault, Scope.Scope>, guidance?: string) => {
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
      yield* connection.commands.pipe(
        Stream.runForEach((command) => {
          switch (command._tag) {
            case 'Captured':
              return instance.requestCaptured(command)
            case 'CaptureFailed':
              return instance.captureFailed(command.message)
            case 'Reopened':
              return Effect.void
          }
        }),
      )
      yield* Effect.never
    }),
  ).pipe(
    Effect.catchTag('ActionRequired', (error) =>
      Effect.sync(() => state.update((previous) => fail(previous, error.message))),
    ),
    Effect.catchDefect(() =>
      Effect.sync(() => state.update((previous) => fail(previous, 'GlossShift could not start its native service.'))),
    ),
  )
  const fiber = Effect.runFork(program)
  cleanup(() => {
    Effect.runFork(Fiber.interrupt(fiber))
  })

  const dispatch = (action: (instance: PopupController) => Effect.Effect<void>) => {
    const current = controller()
    if (Option.isSome(current)) Effect.runFork(action(current.value))
  }
  return { state, dispatch }
}

export const Application = (props: { readonly connect: Effect.Effect<NativeConnection, Fault, Scope.Scope> }) => {
  const { state, dispatch } = usePopupConnection(props.connect)

  Menu.setApplicationMenu([
    {
      label: 'GlossShift',
      submenu: [{ label: 'Quit GlossShift', role: 'quit', onSelect: () => dispatch((instance) => instance.quit) }],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Copy translation',
          shortcut: 'mod+c',
          onSelect: () => dispatch((instance) => instance.copy('Translation')),
        },
        {
          label: 'Copy source',
          shortcut: 'mod+shift+c',
          onSelect: () => dispatch((instance) => instance.copy('Source')),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [{ label: 'Close window', shortcut: 'mod+w', onSelect: () => dispatch((instance) => instance.hide) }],
    },
  ])
  cleanup(() => Menu.setApplicationMenu(null))

  return (
    <PopupView
      state={state()}
      copy={(pane) => dispatch((instance) => instance.copy(pane))}
      setMode={(mode) => dispatch((instance) => instance.setMode(mode))}
      cancel={() => dispatch((instance) => instance.cancel)}
      hide={() => dispatch((instance) => instance.hide)}
      quit={() => dispatch((instance) => instance.quit)}
    />
  )
}
