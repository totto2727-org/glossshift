import { Effect, Schema, Stream } from 'effect'
import { mount } from 'nsh'

import { Application } from './application'
import { RequestId } from './domain'
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
  capture: Effect.fail({ _tag: 'ActionRequired', message: 'A captured native request must never recapture' }),
  translate: (request) =>
    Stream.make(
      { _tag: 'Started', id: request.id, sourceText: request.text },
      { _tag: 'Delta', id: request.id, text: output },
      { _tag: 'Finished', id: request.id },
    ),
  cancel: () => Effect.void,
  copy: () => Effect.void,
  hide: Effect.void,
  quit: Effect.void,
  reveal: Effect.void,
  shortcuts: Stream.empty,
}

mount(() => (
  <Application
    connect={Effect.succeed({
      ports,
      commands: Stream.make({ _tag: 'Captured', id, text: source, targetLanguage: 'Japanese' }),
    })}
  />
))
