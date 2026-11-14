import { Effect, Fiber } from 'effect'
import { cleanup, mount, signal, Text } from 'nsh'

import { verifyCliFiles } from '../cli-fs.fixture.ts'
import { layer } from '../platform.ts'

mount(() => {
  const status = signal('Running CLI filesystem acceptance')
  const fiber = Effect.runFork(
    verifyCliFiles.pipe(
      Effect.provide(layer),
      Effect.tap(() => Effect.sync(() => status.set('CLI filesystem acceptance passed'))),
      Effect.catchCause((cause) => Effect.sync(() => status.set(`CLI filesystem acceptance failed: ${cause}`))),
    ),
  )
  cleanup(() => {
    Effect.runFork(Fiber.interrupt(fiber))
  })
  return <Text>{status()}</Text>
})
