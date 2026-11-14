import path from 'path'
import process from 'process'

import { Cause, Effect, FileSystem, Option, Stdio, Stream } from 'effect'

import { runProgram } from '../runtime/main.ts'
import { layer } from '../runtime/platform.ts'

/** The wrapper owns capture paths and publishes output only after this process finishes. */
const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const status = process.env['GLOSSSHIFT_BATCH_STATUS']
  if (status === undefined || !path.isAbsolute(status)) {
    return yield* Effect.die(new Error('Batch status requires an absolute capture path'))
  }
  const code = yield* Effect.scoped(runProgram).pipe(
    Effect.matchCauseEffect({
      onSuccess: () => Effect.succeed(0),
      onFailure: (cause) =>
        Effect.gen(function* () {
          const stdio = yield* Stdio.Stdio
          const error = Cause.findErrorOption(cause)
          const message = Option.isSome(error) ? error.value.message : 'The batch runtime could not complete.'
          yield* Stream.run(Stream.succeed(`gshift failed: ${message}\n`), stdio.stderr({ endOnDone: false }))
          return 1
        }),
    }),
  )
  // Publish completion only after the translation scope has released all owned resources.
  yield* fs.writeFileString(status, `${code}\n`)
  yield* Effect.sync(() => process.exit(code))
})

Effect.runFork(
  program.pipe(
    Effect.provide(layer),
    // A failed bridge must never publish success. The wrapper detects missing status.
    Effect.catchCause(() => Effect.sync(() => process.exit(1))),
  ),
)
