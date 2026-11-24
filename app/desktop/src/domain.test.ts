import { Array } from 'effect'
import { expect, test } from 'nsh/test'

import {
  acceptEvent,
  ControllerMessages,
  Directives,
  initialState,
  paneText,
  RequestIdSchema,
  transition,
  TranslationEvents,
} from './domain.ts'
import type { PopupState, TranslationEvent } from './domain.ts'

const first = RequestIdSchema.make('first')
const second = RequestIdSchema.make('second')
const streaming = (): PopupState =>
  transition(initialState('Ready'), ControllerMessages.Request({ id: first, targetLanguage: 'Japanese' })).state

test('popup domain concatenates deltas and rejects all events after completion', () => {
  const state = acceptEvent(
    acceptEvent(streaming(), TranslationEvents.Delta({ id: first, text: 'Hello' })),
    TranslationEvents.Delta({ id: first, text: ' world' }),
  )
  const complete = acceptEvent(state, TranslationEvents.Finished({ id: first }))
  expect(complete).toEqual({
    mode: 'Markdown',
    output: 'Hello world',
    phase: 'Complete',
    sourceText: 'No text captured yet.',
    status: 'Translation complete',
  })
  const late: Readonly<TranslationEvent[]> = [
    TranslationEvents.Started({ id: first, sourceText: 'late' }),
    TranslationEvents.Delta({ id: first, text: 'late' }),
    TranslationEvents.Finished({ id: first }),
    TranslationEvents.Failed({ id: first, message: 'late' }),
  ]
  Array.forEach(late, (event) => expect(acceptEvent(complete, event)).toBe(complete))
})

test('popup domain newer requests invalidate old capture and stream events', () => {
  const next = transition(streaming(), ControllerMessages.Request({ id: second, targetLanguage: 'English' }))
  expect(next.directives).toEqual([Directives.Start({ id: second, targetLanguage: 'English' })])
  expect(acceptEvent(next.state, TranslationEvents.Delta({ id: first, text: 'stale' }))).toBe(next.state)
  expect(transition(next.state, ControllerMessages.Captured({ id: first, sourceText: 'stale' }))).toEqual({
    directives: [],
    state: next.state,
  })
})

test('popup domain failure invalidates the request and exposes actionable text', () => {
  const result = transition(streaming(), TranslationEvents.Failed({ id: first, message: 'Selection denied' }))
  expect(result.state.phase).toBe('Error')
  expect(result.state.output).toBe('Selection denied')
  expect(result.state.status).toBe('Action required')
  expect(result.directives).toEqual([Directives.Reveal()])
  expect(acceptEvent(result.state, TranslationEvents.Delta({ id: first, text: 'late' }))).toBe(result.state)
})

test('popup domain mode changes preserve raw source and translation for copying', () => {
  const captured = transition(streaming(), ControllerMessages.Captured({ id: first, sourceText: '# Raw' })).state
  const translated = acceptEvent(captured, TranslationEvents.Delta({ id: first, text: '**Translation**' }))
  const plain = transition(translated, ControllerMessages.SetMode({ mode: 'Plain' })).state
  expect(paneText(plain, 'Source')).toBe('# Raw')
  expect(paneText(plain, 'Translation')).toBe('**Translation**')
  expect(transition(plain, ControllerMessages.Copy({ pane: 'Translation' })).directives).toEqual([
    Directives.Copy({ text: '**Translation**' }),
  ])
  expect(transition(plain, ControllerMessages.Hide()).state).toBe(plain)
})
