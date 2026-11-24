import { Effect, Stream } from 'effect'
import { mount } from 'nsh'
import { Window } from 'nsh/desktop'

import { Application } from './application.tsx'
import { NativeCommands, RequestIdSchema, TranslationEvents } from './domain.ts'
import { FaultSchema } from './ports.ts'
import type { NativePorts } from './ports.ts'

const id = RequestIdSchema.make('fixture-capture-1')
const source = '# Source heading\n\nSelected **before** activation.'
const output = '# Translation heading\n\n```rust\nlet safe = true;\n```\n\n![Alt only](https://invalid.test/no-image)'
const ports: NativePorts = {
  cancel: () => Effect.void,
  capture: Effect.fail(FaultSchema.make({ message: 'A captured native request must never recapture' })),
  copy: () => Effect.void,
  hide: Effect.void,
  quit: Effect.void,
  reveal: Effect.sync(() => Window.get('main')?.show()),
  settings: Effect.succeed({
    initialStatus: 'Synthetic offline',
    sourceLanguage: 'auto',
    window: { height: 480, minHeight: 180, minWidth: 320, width: 700 },
  }),
  shortcuts: Stream.empty,
  translate: (request) =>
    Stream.make(
      TranslationEvents.Started({ id: request.id, sourceText: request.text }),
      TranslationEvents.Delta({ id: request.id, text: output }),
      TranslationEvents.Finished({ id: request.id }),
    ),
}

mount(() => (
  <Application
    connect={Effect.succeed({
      commands: Stream.make(NativeCommands.Captured({ id, targetLanguage: 'Japanese', text: source })),
      ports,
    })}
  />
))
