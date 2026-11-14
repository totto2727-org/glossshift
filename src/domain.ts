import { Schema, String } from 'effect'

export const RequestId = Schema.NonEmptyString.pipe(Schema.brand('GlossShift/RequestId'))
export type RequestId = typeof RequestId.Type
export type DisplayMode = 'Markdown' | 'Plain'
export type Pane = 'Source' | 'Translation'

export const TranslationEvent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Started'), id: RequestId, sourceText: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Delta'), id: RequestId, text: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Finished'), id: RequestId }),
  Schema.Struct({ _tag: Schema.Literal('Failed'), id: RequestId, message: Schema.String }),
])
export type TranslationEvent = typeof TranslationEvent.Type

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
  | { readonly _tag: 'Request'; readonly id: RequestId; readonly targetLanguage: string }
  | { readonly _tag: 'RequestCaptured'; readonly id: RequestId; readonly targetLanguage: string; readonly text: string }
  | { readonly _tag: 'Captured'; readonly id: RequestId; readonly sourceText: string }
  | { readonly _tag: 'Cancel' }
  | { readonly _tag: 'SetMode'; readonly mode: DisplayMode }
  | { readonly _tag: 'Copy'; readonly pane: Pane }
  | { readonly _tag: 'Copied' }
  | { readonly _tag: 'Hide' }
  | { readonly _tag: 'Quit' }
  | { readonly _tag: 'ActionFailed'; readonly message: string }
  | { readonly _tag: 'RevealFailed'; readonly message: string }

export type Directive =
  | { readonly _tag: 'Start'; readonly id: RequestId; readonly targetLanguage: string }
  | { readonly _tag: 'StartCaptured'; readonly id: RequestId; readonly targetLanguage: string; readonly text: string }
  | { readonly _tag: 'Stop' }
  | { readonly _tag: 'Copy'; readonly text: string }
  | { readonly _tag: 'Reveal' }
  | { readonly _tag: 'Hide' }
  | { readonly _tag: 'Quit' }

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
        directives: [{ _tag: 'Start', id: message.id, targetLanguage: message.targetLanguage }],
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
          { _tag: 'StartCaptured', id: message.id, targetLanguage: message.targetLanguage, text: message.text },
        ],
      }
    case 'Captured':
      return state.phase === 'Streaming' && state.requestId === message.id
        ? { state: { ...state, sourceText: message.sourceText }, directives: [{ _tag: 'Reveal' }] }
        : { state, directives: [] }
    case 'Cancel':
      return {
        state:
          state.phase === 'Streaming' ? { ...content(state), phase: 'Ready', status: 'Translation cancelled' } : state,
        directives: [{ _tag: 'Stop' }],
      }
    case 'SetMode':
      return { state: { ...state, mode: message.mode }, directives: [] }
    case 'Copy':
      return { state, directives: [{ _tag: 'Copy', text: paneText(state, message.pane) }] }
    case 'Copied':
      return { state: { ...state, status: 'Text copied' }, directives: [] }
    case 'Hide':
      return { state, directives: [{ _tag: 'Hide' }] }
    case 'Quit':
      return { state, directives: [{ _tag: 'Quit' }] }
    case 'ActionFailed':
      return {
        state: fail(state, message.message),
        directives: [{ _tag: 'Stop' }, { _tag: 'Reveal' }],
      }
    case 'RevealFailed':
      return { state: fail(state, message.message), directives: [{ _tag: 'Stop' }] }
    case 'Started':
    case 'Delta':
    case 'Finished':
    case 'Failed': {
      const next = acceptEvent(state, message)
      return {
        state: next,
        directives: next !== state && message._tag === 'Failed' ? [{ _tag: 'Reveal' }] : [],
      }
    }
  }
}
