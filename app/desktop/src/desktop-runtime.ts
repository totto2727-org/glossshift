// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import process from 'process'

import { Effect, Predicate } from 'effect'

import { loadApplicationServices } from './application-services.ts'
import { desktopControls } from './desktop-controls.ts'
import { connectDesktop } from './native-adapter.ts'
import { FaultSchema } from './ports.ts'
import { readSelectionClient } from './selection-client.ts'

export const connectDesktopRuntime = Effect.gen(function* () {
  const services = yield* loadApplicationServices
  const selection = yield* readSelectionClient()
  const background = process.env['GLOSSSHIFT_BACKGROUND']
  if (Predicate.isNotNullish(background) && background !== '0' && background !== '1') {
    return yield* Effect.fail(FaultSchema.make({ message: 'The desktop startup mode is invalid.' }))
  }
  return yield* connectDesktop({ ...services, background: background === '1', selection })
}).pipe(Effect.tapError(() => desktopControls.controls.reveal.pipe(Effect.ignore)))
