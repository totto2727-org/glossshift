import { Effect, Fiber } from 'effect'
import { cleanup, mount, signal, Text } from 'nsh'

import { layer } from '../../platform/index.ts'
import { verifyDesktopFiles } from '../desktop-fs.fixture.ts'

mount(() => {
  const status = signal('Running desktop filesystem acceptance')
  const fiber = Effect.runFork(
    verifyDesktopFiles.pipe(
      Effect.provide(layer),
      Effect.tap(() => Effect.sync(() => status.set('Desktop filesystem acceptance passed'))),
      Effect.catchCause((cause) => Effect.sync(() => status.set(`Desktop filesystem acceptance failed: ${cause}`))),
    ),
  )
  cleanup(() => {
    Effect.runFork(Fiber.interrupt(fiber))
  })
  return <Text>{status()}</Text>
})
