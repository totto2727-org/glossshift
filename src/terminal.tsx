import type { Effect, Scope } from 'effect'
import { signal, Text, View } from 'nsh'
import { Button, Input } from 'nsh/base'

import { usePopupConnection } from './application'
import type { NativeConnection } from './application'
import type { Fault } from './ports'
import { PopupView } from './ui'

/** Official NSH inputs and the same scoped actor used by the desktop popup. */
export const TerminalApplication = (props: {
  readonly connect: Effect.Effect<NativeConnection, Fault, Scope.Scope>
}) => {
  const { state, dispatch } = usePopupConnection(
    props.connect,
    'Enter source text and a target language, then choose Translate.',
  )
  const source = signal('')
  const target = signal('ja')
  const submit = () => dispatch((controller) => controller.submit({ text: source(), targetLanguage: target() }))
  return (
    <PopupView
      terminal
      state={state()}
      input={
        <View class='flex-col gap-2'>
          <View class='flex-row items-center gap-2'>
            <Text>Target</Text>
            <Input
              accessibilityLabel='Target language'
              class='w-24 border border-border rounded px-2'
              value={target()}
              onChange={({ value }) => target.set(value)}
              onSubmit={submit}
            />
            <Button class='px-2 py-1 rounded bg-primary' onPress={submit}>
              <Text>Translate</Text>
            </Button>
          </View>
          <Input
            accessibilityLabel='Source text'
            class='h-24 border border-border rounded p-2'
            value={source()}
            multiline
            placeholder='Enter text to translate'
            onChange={({ value }) => source.set(value)}
          />
        </View>
      }
      copy={(pane) => dispatch((controller) => controller.copy(pane))}
      setMode={(mode) => dispatch((controller) => controller.setMode(mode))}
      cancel={() => dispatch((controller) => controller.cancel)}
      hide={() => {}}
      quit={() => dispatch((controller) => controller.quit)}
    />
  )
}
