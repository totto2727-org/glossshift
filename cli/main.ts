import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Cause, Effect, Option, Stdio, Stream } from 'effect'
import { CliError } from 'effect/cli'

import { runProgram } from '../runtime/main.ts'

/** Native Node argv, stdio, filesystem and subprocesses. No NSH platform enters this graph. */
NodeRuntime.runMain(
  Effect.scoped(runProgram).pipe(
    Effect.tapCause((cause) =>
      Effect.gen(function* () {
        const stdio = yield* Stdio.Stdio
        const error = Cause.findErrorOption(cause)
        if (Option.isSome(error) && CliError.isCliError(error.value) && error.value._tag === 'ShowHelp') return
        const message = Option.isSome(error) ? error.value.message : 'The CLI could not complete.'
        yield* Stream.run(Stream.succeed(`gshift failed: ${message}\n`), stdio.stderr({ endOnDone: false }))
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
  { disableErrorReporting: true },
)
