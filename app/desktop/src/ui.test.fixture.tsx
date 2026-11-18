import { Effect, Schema, Stream } from 'effect'
import { mount } from 'nsh'
import { Window } from 'nsh/desktop'

import { Application } from './application'
import { NativeCommand, RequestId, TranslationEvent } from './domain'
import { Fault } from './ports'
import type { NativePorts } from './ports'

const id = Schema.decodeUnknownSync(RequestId)('fixture-capture-1')
const source = '# Source heading\n\nSelected **before** activation.'
const output = '# Translation heading\n\n```rust\nlet safe = true;\n```\n\n![Alt only](https://invalid.test/no-image)'
const ports: NativePorts = {
  settings: Effect.succeed({
    sourceLanguage: 'auto',
    initialStatus: 'Synthetic offline',
    window: { width: 700, height: 480, minWidth: 320, minHeight: 180 },
  }),
  capture: Effect.fail(Fault.make({ message: 'A captured native request must never recapture' })),
  translate: (request) =>
    Stream.make(
      TranslationEvent.Started({ id: request.id, sourceText: request.text }),
      TranslationEvent.Delta({ id: request.id, text: output }),
      TranslationEvent.Finished({ id: request.id }),
    ),
  cancel: () => Effect.void,
  copy: () => Effect.void,
  hide: Effect.void,
  quit: Effect.void,
  reveal: Effect.sync(() => Window.get('main')?.show()),
  shortcuts: Stream.empty,
}

mount(() => (
  <Application
    connect={Effect.succeed({
      ports,
      commands: Stream.make(NativeCommand.Captured({ id, text: source, targetLanguage: 'Japanese' })),
    })}
  />
))
