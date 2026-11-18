import { Data, Schema, String } from 'effect'

export const RequestId = Schema.NonEmptyString.pipe(Schema.brand('GlossShift/RequestId'))
export type RequestId = typeof RequestId.Type
export type DisplayMode = 'Markdown' | 'Plain'
export type Pane = 'Source' | 'Translation'

export type TranslationEvent = Data.TaggedEnum<{
  Started: { readonly id: RequestId; readonly sourceText: string }
  Delta: { readonly id: RequestId; readonly text: string }
  Finished: { readonly id: RequestId }
  Failed: { readonly id: RequestId; readonly message: string }
}>
export const TranslationEvent = Data.taggedEnum<TranslationEvent>()

export type NativeCommand = Data.TaggedEnum<{
  Captured: { readonly id: RequestId; readonly targetLanguage: string; readonly text: string }
  CaptureFailed: { readonly message: string }
  Reopened: {}
}>
export const NativeCommand = Data.taggedEnum<NativeCommand>()

interface Content {
  readonly sourceText: string
  readonly output: string
  readonly status: string
  readonly mode: DisplayMode
}

export type PopupState = Content &
  ({ readonly phase: 'Ready' | 'Complete' | 'Error' } | { readonly phase: 'Streaming'; readonly requestId: RequestId })

export type ControllerMessage =
  | TranslationEvent
  | Data.TaggedEnum<{
      Request: { readonly id: RequestId; readonly targetLanguage: string }
      RequestCaptured: { readonly id: RequestId; readonly targetLanguage: string; readonly text: string }
      Captured: { readonly id: RequestId; readonly sourceText: string }
      Cancel: {}
      SetMode: { readonly mode: DisplayMode }
      Copy: { readonly pane: Pane }
      Copied: {}
      Hide: {}
      Quit: {}
      ActionFailed: { readonly message: string }
      RevealFailed: { readonly message: string }
    }>
export const ControllerMessage = Data.taggedEnum<ControllerMessage>()

export type Directive = Data.TaggedEnum<{
  Start: { readonly id: RequestId; readonly targetLanguage: string }
  StartCaptured: { readonly id: RequestId; readonly targetLanguage: string; readonly text: string }
  Stop: {}
  Copy: { readonly text: string }
  Reveal: {}
  Hide: {}
  Quit: {}
}>
export const Directive = Data.taggedEnum<Directive>()

export interface Transition {
  readonly state: PopupState
  readonly directives: ReadonlyArray<Directive>
}

export const initialState = (
  status: string,
  guidance = 'Select text in any application, then press a configured shortcut.',
): PopupState => ({
  phase: 'Ready',
  sourceText: 'No text captured yet.',
  output: guidance,
  status,
  mode: 'Markdown',
})

export const content = (state: PopupState): Content => ({
  sourceText: state.sourceText,
  output: state.output,
  status: state.status,
  mode: state.mode,
})

export const fail = (state: PopupState, message: string): PopupState => ({
  ...content(state),
  phase: 'Error',
  output: message,
  status: 'Action required',
})

export const acceptEvent = (state: PopupState, event: TranslationEvent): PopupState => {
  if (state.phase !== 'Streaming' || state.requestId !== event.id) return state
  switch (event._tag) {
    case 'Started':
      return { ...state, sourceText: event.sourceText, output: '' }
    case 'Delta':
      return { ...state, output: String.concat(state.output, event.text) }
    case 'Finished':
      return { ...content(state), phase: 'Complete', status: 'Translation complete' }
    case 'Failed':
      return fail(state, event.message)
  }
}

export const paneText = (state: PopupState, pane: Pane): string => (pane === 'Source' ? state.sourceText : state.output)

export const transition = (state: PopupState, message: ControllerMessage): Transition => {
  switch (message._tag) {
    case 'Request':
      return {
        state: {
          ...content(state),
          phase: 'Streaming',
          requestId: message.id,
          output: '',
          status: `Translating to ${message.targetLanguage}`,
        },
        directives: [Directive.Start({ id: message.id, targetLanguage: message.targetLanguage })],
      }
    case 'RequestCaptured':
      return {
        state: {
          ...content(state),
          phase: 'Streaming',
          requestId: message.id,
          sourceText: message.text,
          output: '',
          status: `Translating to ${message.targetLanguage}`,
        },
        directives: [
          Directive.StartCaptured({ id: message.id, targetLanguage: message.targetLanguage, text: message.text }),
        ],
      }
    case 'Captured':
      return state.phase === 'Streaming' && state.requestId === message.id
        ? { state: { ...state, sourceText: message.sourceText }, directives: [Directive.Reveal()] }
        : { state, directives: [] }
    case 'Cancel':
      return {
        state:
          state.phase === 'Streaming' ? { ...content(state), phase: 'Ready', status: 'Translation cancelled' } : state,
        directives: [Directive.Stop()],
      }
    case 'SetMode':
      return { state: { ...state, mode: message.mode }, directives: [] }
    case 'Copy':
      return { state, directives: [Directive.Copy({ text: paneText(state, message.pane) })] }
    case 'Copied':
      return { state: { ...state, status: 'Text copied' }, directives: [] }
    case 'Hide':
      return { state, directives: [Directive.Hide()] }
    case 'Quit':
      return { state, directives: [Directive.Quit()] }
    case 'ActionFailed':
      return {
        state: fail(state, message.message),
        directives: [Directive.Stop(), Directive.Reveal()],
      }
    case 'RevealFailed':
      return { state: fail(state, message.message), directives: [Directive.Stop()] }
    case 'Started':
    case 'Delta':
    case 'Finished':
    case 'Failed': {
      const next = acceptEvent(state, message)
      return {
        state: next,
        directives: next !== state && message._tag === 'Failed' ? [Directive.Reveal()] : [],
      }
    }
  }
}
