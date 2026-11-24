import { Text, View } from 'nsh'
import type { JSX } from 'nsh'
import { Button, Switch } from 'nsh/base'
import type { SwitchProps } from 'nsh/base'

import type { DisplayMode, Pane, PopupState } from './domain.ts'
import { PaneView } from './pane-view.tsx'

export type PopupViewProps = Readonly<{
  input?: JSX.Element
  terminal?: boolean
  state: PopupState
  copy: (pane: Pane) => void
  setMode: (mode: DisplayMode) => void
  cancel: () => void
  hide: () => void
  quit: () => void
}>

type ModeChange = NonNullable<SwitchProps['onChange']>

const renderHeading = (props: PopupViewProps, onModeChange: ModeChange): JSX.Element => {
  const displayMode = (
    <View class='flex-row items-center gap-2'>
      <Text class='text-sm text-muted-foreground'>Plain text</Text>
      <Switch
        accessibilityLabel='Plain text'
        checked={props.state.mode === 'Plain'}
        onChange={onModeChange}
        trackClass='w-9 h-5 rounded-full bg-muted checked:bg-primary'
        thumbClass='w-4 h-4 rounded-full bg-background'
      />
    </View>
  )
  return (
    <View class='flex-row items-center justify-between gap-3'>
      <Text class='text-base font-semibold text-foreground'>GlossShift</Text>
      {displayMode}
    </View>
  )
}

const commandClass = 'px-2 py-1 rounded bg-muted'

const renderCommands = ({ cancel: onCancel, hide: onHide, quit: onQuit, terminal }: PopupViewProps): JSX.Element => {
  const cancelLabel = <Text class='text-xs'>Cancel</Text>
  const hideLabel = <Text class='text-xs'>Hide</Text>
  const quitLabel = <Text class='text-xs'>Quit</Text>
  return (
    <View class='flex-row gap-2 justify-end'>
      <Button accessibilityLabel='Cancel translation' class={commandClass} onPress={onCancel}>
        {cancelLabel}
      </Button>
      {!terminal && (
        <Button class={commandClass} onPress={onHide}>
          {hideLabel}
        </Button>
      )}
      <Button class={commandClass} onPress={onQuit}>
        {quitLabel}
      </Button>
    </View>
  )
}

// oxlint-disable-next-line eslint/func-style -- The shared JSX component rule requires this function declaration.
export function PopupView(props: PopupViewProps): JSX.Element {
  // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop -- The NSH handler forwards the source pane with this view's native controller.
  const onCopySource = (): void => props.copy('Source')
  // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop -- The NSH handler forwards the translation pane with this view's native controller.
  const onCopyTranslation = (): void => props.copy('Translation')
  const onModeChange: ModeChange = ({ checked }) => props.setMode(checked ? 'Plain' : 'Markdown')
  const heading = renderHeading(props, onModeChange)
  const panes = (
    <View class='flex-1 min-h-0 flex-row gap-2'>
      <PaneView
        title='Source'
        text={props.state.sourceText}
        mode={props.state.mode}
        streaming={false}
        onCopy={onCopySource}
      />
      <PaneView
        title='Translation'
        text={props.state.output}
        mode={props.state.mode}
        streaming={props.state.phase === 'Streaming'}
        onCopy={onCopyTranslation}
      />
    </View>
  )
  const commands = renderCommands(props)

  return (
    <View class='flex-1 min-h-0 flex-col gap-2 p-2 bg-background'>
      {heading}
      {props.input}
      <Text class='text-xs text-muted-foreground'>{props.state.status}</Text>
      {panes}
      {commands}
    </View>
  )
}
