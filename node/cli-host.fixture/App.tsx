import process, { run } from 'process'

import { Effect, Fiber, String } from 'effect'
import { cleanup, mount, signal, Text } from 'nsh'

mount(() => {
  const status = signal('Running CLI filesystem acceptance')
  const program = Effect.tryPromise({
    try: () => {
      const root = process.env['PWD']
      if (typeof root !== 'string' || !String.startsWith('/')(root)) throw new Error('Repository PWD is unavailable')
      return run('node', [`${root}/node/cli-fs.fixture.mjs`], { timeoutMs: 30_000 })
    },
    catch: (error) => (error instanceof Error ? error.message : 'The CLI fixture process could not start.'),
  }).pipe(
    Effect.map((output) =>
      output.code === 0 &&
      output.stderr === '' &&
      output.stdout === '<raw># FIRST\n</raw><raw># SECOND\n</raw>CLI filesystem acceptance passed\n'
        ? 'CLI filesystem acceptance passed'
        : `CLI filesystem acceptance failed: ${output.stderr}${output.stdout}`,
    ),
    Effect.catch((message) => Effect.succeed(`CLI filesystem acceptance failed: ${message}`)),
    Effect.tap((message) => Effect.sync(() => status.set(message))),
  )
  const fiber = Effect.runFork(program)
  cleanup(() => {
    Effect.runFork(Fiber.interrupt(fiber))
  })
  return <Text>{status()}</Text>
})
