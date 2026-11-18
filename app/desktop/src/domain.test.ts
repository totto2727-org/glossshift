import { Schema } from 'effect'
import { expect, test } from 'nsh/test'

import {
  acceptEvent,
  ControllerMessage,
  Directive,
  initialState,
  paneText,
  RequestId,
  transition,
  TranslationEvent,
} from './domain'

const first = Schema.decodeUnknownSync(RequestId)('first')
const second = Schema.decodeUnknownSync(RequestId)('second')
const streaming = () =>
  transition(initialState('Ready'), ControllerMessage.Request({ id: first, targetLanguage: 'Japanese' })).state

test('popup domain concatenates deltas and rejects all events after completion', () => {
  const state = acceptEvent(
    acceptEvent(streaming(), TranslationEvent.Delta({ id: first, text: 'Hello' })),
    TranslationEvent.Delta({ id: first, text: ' world' }),
  )
  const complete = acceptEvent(state, TranslationEvent.Finished({ id: first }))
  expect(complete).toEqual({
    phase: 'Complete',
    mode: 'Markdown',
    sourceText: 'No text captured yet.',
    output: 'Hello world',
    status: 'Translation complete',
  })
  const late: ReadonlyArray<TranslationEvent> = [
    TranslationEvent.Started({ id: first, sourceText: 'late' }),
    TranslationEvent.Delta({ id: first, text: 'late' }),
    TranslationEvent.Finished({ id: first }),
    TranslationEvent.Failed({ id: first, message: 'late' }),
  ]
  for (const event of late) expect(acceptEvent(complete, event)).toBe(complete)
})

test('popup domain newer requests invalidate old capture and stream events', () => {
  const next = transition(streaming(), ControllerMessage.Request({ id: second, targetLanguage: 'English' }))
  expect(next.directives).toEqual([Directive.Start({ id: second, targetLanguage: 'English' })])
  expect(acceptEvent(next.state, TranslationEvent.Delta({ id: first, text: 'stale' }))).toBe(next.state)
  expect(transition(next.state, ControllerMessage.Captured({ id: first, sourceText: 'stale' }))).toEqual({
    state: next.state,
    directives: [],
  })
})

test('popup domain failure invalidates the request and exposes actionable text', () => {
  const result = transition(streaming(), TranslationEvent.Failed({ id: first, message: 'Selection denied' }))
  expect(result.state.phase).toBe('Error')
  expect(result.state.output).toBe('Selection denied')
  expect(result.state.status).toBe('Action required')
  expect(result.directives).toEqual([Directive.Reveal()])
  expect(acceptEvent(result.state, TranslationEvent.Delta({ id: first, text: 'late' }))).toBe(result.state)
})

test('popup domain mode changes preserve raw source and translation for copying', () => {
  const captured = transition(streaming(), ControllerMessage.Captured({ id: first, sourceText: '# Raw' })).state
  const translated = acceptEvent(captured, TranslationEvent.Delta({ id: first, text: '**Translation**' }))
  const plain = transition(translated, ControllerMessage.SetMode({ mode: 'Plain' })).state
  expect(paneText(plain, 'Source')).toBe('# Raw')
  expect(paneText(plain, 'Translation')).toBe('**Translation**')
  expect(transition(plain, ControllerMessage.Copy({ pane: 'Translation' })).directives).toEqual([
    Directive.Copy({ text: '**Translation**' }),
  ])
  expect(transition(plain, ControllerMessage.Hide()).state).toBe(plain)
})
