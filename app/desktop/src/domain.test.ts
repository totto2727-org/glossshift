import { Schema } from 'effect'
import { expect, test } from 'nsh/test'

import { acceptEvent, initialState, paneText, RequestId, transition } from './domain'
import type { TranslationEvent } from './domain'

const first = Schema.decodeUnknownSync(RequestId)('first')
const second = Schema.decodeUnknownSync(RequestId)('second')
const streaming = () =>
  transition(initialState('Ready'), {
    _tag: 'Request',
    id: first,
    targetLanguage: 'Japanese',
  }).state

test('popup domain concatenates deltas and rejects all events after completion', () => {
  const state = acceptEvent(acceptEvent(streaming(), { _tag: 'Delta', id: first, text: 'Hello' }), {
    _tag: 'Delta',
    id: first,
    text: ' world',
  })
  const complete = acceptEvent(state, { _tag: 'Finished', id: first })
  expect(complete).toEqual({
    phase: 'Complete',
    mode: 'Markdown',
    sourceText: 'No text captured yet.',
    output: 'Hello world',
    status: 'Translation complete',
  })
  const late: ReadonlyArray<TranslationEvent> = [
    { _tag: 'Started', id: first, sourceText: 'late' },
    { _tag: 'Delta', id: first, text: 'late' },
    { _tag: 'Finished', id: first },
    { _tag: 'Failed', id: first, message: 'late' },
  ]
  for (const event of late) expect(acceptEvent(complete, event)).toBe(complete)
})

test('popup domain newer requests invalidate old capture and stream events', () => {
  const next = transition(streaming(), { _tag: 'Request', id: second, targetLanguage: 'English' })
  expect(next.directives).toEqual([{ _tag: 'Start', id: second, targetLanguage: 'English' }])
  expect(acceptEvent(next.state, { _tag: 'Delta', id: first, text: 'stale' })).toBe(next.state)
  expect(transition(next.state, { _tag: 'Captured', id: first, sourceText: 'stale' })).toEqual({
    state: next.state,
    directives: [],
  })
})

test('popup domain failure invalidates the request and exposes actionable text', () => {
  const result = transition(streaming(), { _tag: 'Failed', id: first, message: 'Selection denied' })
  expect(result.state.phase).toBe('Error')
  expect(result.state.output).toBe('Selection denied')
  expect(result.state.status).toBe('Action required')
  expect(result.directives).toEqual([{ _tag: 'Reveal' }])
  expect(acceptEvent(result.state, { _tag: 'Delta', id: first, text: 'late' })).toBe(result.state)
})

test('popup domain mode changes preserve raw source and translation for copying', () => {
  const captured = transition(streaming(), { _tag: 'Captured', id: first, sourceText: '# Raw' }).state
  const translated = acceptEvent(captured, { _tag: 'Delta', id: first, text: '**Translation**' })
  const plain = transition(translated, { _tag: 'SetMode', mode: 'Plain' }).state
  expect(paneText(plain, 'Source')).toBe('# Raw')
  expect(paneText(plain, 'Translation')).toBe('**Translation**')
  expect(transition(plain, { _tag: 'Copy', pane: 'Translation' }).directives).toEqual([
    { _tag: 'Copy', text: '**Translation**' },
  ])
  expect(transition(plain, { _tag: 'Hide' }).state).toBe(plain)
})
