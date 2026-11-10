import { Scroll, Text, View } from 'nsh'
import type { JSX } from 'nsh'
import { Button, Switch, TextView } from 'nsh/base'

import type { DisplayMode, Pane, PopupState } from './domain'

export interface PopupViewProps {
  readonly input?: JSX.Element
  readonly terminal?: boolean
  readonly state: PopupState
  readonly copy: (pane: Pane) => void
  readonly setMode: (mode: DisplayMode) => void
  readonly cancel: () => void
  readonly hide: () => void
  readonly quit: () => void
}

export const PopupView = (props: PopupViewProps) => (
  <View class='flex-1 min-h-0 flex-col gap-2 p-2 bg-background'>
    <View class='flex-row items-center justify-between gap-3'>
      <Text class='text-base font-semibold text-foreground'>GlossShift</Text>
      <View class='flex-row items-center gap-2'>
        <Text class='text-sm text-muted-foreground'>Plain text</Text>
        <Switch
          accessibilityLabel='Plain text'
          checked={props.state.mode === 'Plain'}
          onChange={({ checked }) => props.setMode(checked ? 'Plain' : 'Markdown')}
          trackClass='w-9 h-5 rounded-full bg-muted checked:bg-primary'
          thumbClass='w-4 h-4 rounded-full bg-background'
        />
      </View>
    </View>
    {props.input}
    <Text class='text-xs text-muted-foreground'>{props.state.status}</Text>
    <View class='flex-1 min-h-0 flex-row gap-2'>
      <PaneView
        title='Source'
        text={props.state.sourceText}
        mode={props.state.mode}
        streaming={false}
        copy={() => props.copy('Source')}
      />
      <PaneView
        title='Translation'
        text={props.state.output}
        mode={props.state.mode}
        streaming={props.state.phase === 'Streaming'}
        copy={() => props.copy('Translation')}
      />
    </View>
    <View class='flex-row gap-2 justify-end'>
      <Button accessibilityLabel='Cancel translation' class='px-2 py-1 rounded bg-muted' onPress={props.cancel}>
        <Text class='text-xs'>Cancel</Text>
      </Button>
      {!props.terminal && (
        <Button class='px-2 py-1 rounded bg-muted' onPress={props.hide}>
          <Text class='text-xs'>Hide</Text>
        </Button>
      )}
      <Button class='px-2 py-1 rounded bg-muted' onPress={props.quit}>
        <Text class='text-xs'>Quit</Text>
      </Button>
    </View>
  </View>
)

const PaneView = (props: {
  readonly title: Pane
  readonly text: string
  readonly mode: DisplayMode
  readonly streaming: boolean
  readonly copy: () => void
}) => (
  <View class='flex-1 min-w-0 min-h-0 flex-col gap-1 rounded-lg border border-border p-2'>
    <View class='flex-row items-center justify-between gap-1'>
      <Text class='text-xs font-semibold text-foreground'>{props.title}</Text>
      <Button accessibilityLabel={`Copy ${props.title}`} class='px-1 py-1 rounded bg-muted' onPress={props.copy}>
        <Text class='text-xs'>Copy</Text>
      </Button>
    </View>
    <Scroll class='flex-1 min-h-0'>
      {props.mode === 'Plain' ? (
        <Text class='text-foreground select-text'>{props.text}</Text>
      ) : (
        <TextView
          markdown={props.text}
          selectable
          links='report'
          options={{ html: false, math: false, streaming: props.streaming }}
          renderCodeBlock={(block) => <Text class='font-mono select-text'>{block.code}</Text>}
          renderImage={(image) => <Text>{image.alt ?? ''}</Text>}
        />
      )}
    </Scroll>
  </View>
)
