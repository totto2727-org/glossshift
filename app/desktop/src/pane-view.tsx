import { Scroll, Text, View } from 'nsh'
import type { JSX } from 'nsh'
import { Button, TextView } from 'nsh/base'
import type { TextViewProps } from 'nsh/base'

import type { DisplayMode, Pane } from './domain.ts'

type PaneProps = Readonly<{
  title: Pane
  text: string
  mode: DisplayMode
  streaming: boolean
  onCopy: () => void
}>

const renderCode: NonNullable<TextViewProps['renderCodeBlock']> = (block) => (
  <Text class='font-mono select-text'>{block.code}</Text>
)
const renderImage: NonNullable<TextViewProps['renderImage']> = (image) => <Text>{image.alt ?? ''}</Text>

const liveMarkdown = { html: false, math: false, streaming: true } as const
const completeMarkdown = { html: false, math: false, streaming: false } as const

export const PaneView = (props: PaneProps): JSX.Element => {
  const copyLabel = <Text class='text-xs'>Copy</Text>
  const copyButton = (
    <Button accessibilityLabel={`Copy ${props.title}`} class='px-1 py-1 rounded bg-muted' onPress={props.onCopy}>
      {copyLabel}
    </Button>
  )
  const heading = (
    <View class='flex-row items-center justify-between gap-1'>
      <Text class='text-xs font-semibold text-foreground'>{props.title}</Text>
      {copyButton}
    </View>
  )
  const content = (
    <Scroll class='flex-1 min-h-0'>
      {props.mode === 'Plain' ? (
        <Text class='text-foreground select-text'>{props.text}</Text>
      ) : (
        <TextView
          markdown={props.text}
          selectable
          links='report'
          options={props.streaming ? liveMarkdown : completeMarkdown}
          renderCodeBlock={renderCode}
          renderImage={renderImage}
        />
      )}
    </Scroll>
  )

  return (
    <View class='flex-1 min-w-0 min-h-0 flex-col gap-1 rounded-lg border border-border p-2'>
      {heading}
      {content}
    </View>
  )
}
