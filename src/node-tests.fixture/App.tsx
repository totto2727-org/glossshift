import process, { run } from 'process'

import { Effect, Fiber, String } from 'effect'
import { cleanup, mount, signal, Text } from 'nsh'

mount(() => {
  const status = signal('Running Node regressions')
  const fiber = Effect.runFork(
    Effect.tryPromise({
      try: () => {
        const root = process.env['PWD']
        if (typeof root !== 'string' || !String.startsWith('/')(root)) throw new Error('Repository PWD is unavailable')
        return run(
          'node',
          [
            '--test',
            '--test-reporter=tap',
            `${root}/node/local.test.ts`,
            `${root}/node/desktop.test.ts`,
            `${root}/node/server.test.ts`,
          ],
          {
            timeoutMs: 45_000,
          },
        )
      },
      catch: () => 'Node regression process could not run',
    }).pipe(
      Effect.flatMap((output) =>
        Effect.sync(() => {
          status.set(
            output.code === 0 && String.includes('# fail 0')(output.stdout)
              ? 'Node regressions passed'
              : `Node regressions failed: ${output.stderr}\n${String.slice(-6000)(output.stdout)}`,
          )
        }),
      ),
      Effect.catch((message) => Effect.sync(() => status.set(message))),
    ),
  )
  cleanup(() => {
    Effect.runFork(Fiber.interrupt(fiber))
  })
  return <Text>{status()}</Text>
})
