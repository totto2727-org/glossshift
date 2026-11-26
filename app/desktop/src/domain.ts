import { Data, Match, Schema, String } from 'effect'

export const RequestIdSchema = Schema.NonEmptyString.pipe(Schema.brand('GlossShift/RequestId'))
export type RequestId = typeof RequestIdSchema.Type
export type DisplayMode = 'Markdown' | 'Plain'
export type Pane = 'Source' | 'Translation'

export type TranslationEvent = Data.TaggedEnum<{
  Started: Readonly<{ id: RequestId; sourceText: string }>
  Delta: Readonly<{ id: RequestId; text: string }>
  Finished: Readonly<{ id: RequestId }>
  Failed: Readonly<{ id: RequestId; message: string }>
}>
export const TranslationEvents = Data.taggedEnum<TranslationEvent>()

export type NativeCommand = Data.TaggedEnum<{
  Captured: Readonly<{ id: RequestId; targetLanguage: string; text: string }>
  CaptureFailed: Readonly<{ message: string }>
  Reopened: Record<never, never>
}>
export const NativeCommands = Data.taggedEnum<NativeCommand>()

type Content = Readonly<{
  sourceText: string
  output: string
  status: string
  mode: DisplayMode
}>

export type PopupState = Content &
  (Readonly<{ phase: 'Ready' | 'Complete' | 'Error' }> | Readonly<{ phase: 'Streaming'; requestId: RequestId }>)

export type ControllerMessage =
  | TranslationEvent
  | Data.TaggedEnum<{
      Request: Readonly<{ id: RequestId; targetLanguage: string }>
      RequestCaptured: Readonly<{ id: RequestId; targetLanguage: string; text: string }>
      Captured: Readonly<{ id: RequestId; sourceText: string }>
      Cancel: Record<never, never>
      SetMode: Readonly<{ mode: DisplayMode }>
      Copy: Readonly<{ pane: Pane }>
      Copied: Record<never, never>
      Hide: Record<never, never>
      Quit: Record<never, never>
      ActionFailed: Readonly<{ message: string }>
      RevealFailed: Readonly<{ message: string }>
    }>
export const ControllerMessages = Data.taggedEnum<ControllerMessage>()

export type Directive = Data.TaggedEnum<{
  Start: Readonly<{ id: RequestId; targetLanguage: string }>
  StartCaptured: Readonly<{ id: RequestId; targetLanguage: string; text: string }>
  Stop: Record<never, never>
  Copy: Readonly<{ text: string }>
  Reveal: Record<never, never>
  Hide: Record<never, never>
  Quit: Record<never, never>
}>
export const Directives = Data.taggedEnum<Directive>()

export type Transition = Readonly<{
  state: PopupState
  directives: Readonly<Directive[]>
}>

export const initialState = (
  status: string,
  guidance = 'Select text in any application, then press a configured shortcut.',
): PopupState => ({
  mode: 'Markdown',
  output: guidance,
  phase: 'Ready',
  sourceText: 'No text captured yet.',
  status,
})

export const content = (state: PopupState): Content => ({
  mode: state.mode,
  output: state.output,
  sourceText: state.sourceText,
  status: state.status,
})

export const fail = (state: PopupState, message: string): PopupState => ({
  ...content(state),
  output: message,
  phase: 'Error',
  status: 'Action required',
})

export const acceptEvent = (state: PopupState, event: TranslationEvent): PopupState => {
  if (state.phase !== 'Streaming' || state.requestId !== event.id) {
    return state
  }
  return Match.value(event).pipe(
    Match.tagsExhaustive({
      Delta: (delta): PopupState => ({ ...state, output: String.concat(state.output, delta.text) }),
      Failed: (failure): PopupState => fail(state, failure.message),
      Finished: (): PopupState => ({ ...content(state), phase: 'Complete', status: 'Translation complete' }),
      Started: (started): PopupState => ({ ...state, output: '', sourceText: started.sourceText }),
    }),
  )
}

export const paneText = (state: PopupState, pane: Pane): string => (pane === 'Source' ? state.sourceText : state.output)

const result = (state: PopupState, ...directives: Readonly<Directive[]>): Transition => ({ directives, state })

const start = (state: PopupState, request: Readonly<{ id: RequestId; targetLanguage: string }>): PopupState => ({
  ...content(state),
  output: '',
  phase: 'Streaming',
  requestId: request.id,
  status: `Translating to ${request.targetLanguage}`,
})

export const transition = (state: PopupState, message: ControllerMessage): Transition => {
  const applyEvent = (event: TranslationEvent): Transition => result(acceptEvent(state, event))
  return Match.value(message).pipe(
    Match.tagsExhaustive({
      ActionFailed: (failure) => result(fail(state, failure.message), Directives.Stop(), Directives.Reveal()),
      Cancel: () => {
        const cancelled: PopupState = { ...content(state), phase: 'Ready', status: 'Translation cancelled' }
        return result(state.phase === 'Streaming' ? cancelled : state, Directives.Stop())
      },
      Captured: (captured) =>
        state.phase === 'Streaming' && state.requestId === captured.id
          ? result({ ...state, sourceText: captured.sourceText }, Directives.Reveal())
          : result(state),
      Copied: () => result({ ...state, status: 'Text copied' }),
      Copy: (copy) => result(state, Directives.Copy({ text: paneText(state, copy.pane) })),
      Delta: applyEvent,
      Failed: (failure) => {
        const next = acceptEvent(state, failure)
        return next === state ? result(state) : result(next, Directives.Reveal())
      },
      Finished: applyEvent,
      Hide: () => result(state, Directives.Hide()),
      Quit: () => result(state, Directives.Quit()),
      Request: (request) =>
        result(start(state, request), Directives.Start({ id: request.id, targetLanguage: request.targetLanguage })),
      RequestCaptured: (request) => {
        const next = { ...start(state, request), sourceText: request.text }
        return result(
          next,
          Directives.StartCaptured({ id: request.id, targetLanguage: request.targetLanguage, text: request.text }),
        )
      },
      RevealFailed: (failure) => result(fail(state, failure.message), Directives.Stop()),
      SetMode: (selection) => result({ ...state, mode: selection.mode }),
      Started: applyEvent,
    }),
  )
}
