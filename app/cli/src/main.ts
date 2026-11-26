import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Predicate, Cause, Effect, Option, Stdio, Stream } from 'effect'
import { CliError } from 'effect/cli'

import { runProgram } from './program.ts'

/** Native Node argv, stdio, filesystem and subprocesses. No NSH platform enters this graph. */
// oxlint-disable-next-line rules/no-effect-runtime-run -- The native CLI entry owns the Effect runtime and process exit status.
NodeRuntime.runMain(
  Effect.scoped(runProgram).pipe(
    Effect.tapCause((cause) =>
      Effect.gen(function* () {
        const stdio = yield* Stdio.Stdio
        const error = Cause.findErrorOption(cause)
        if (Option.isSome(error) && CliError.isCliError(error.value) && Predicate.isTagged('ShowHelp')(error.value)) {
          return
        }
        const message = Option.isSome(error) ? error.value.message : 'The CLI could not complete.'
        yield* Stream.run(Stream.succeed(`gshift failed: ${message}\n`), stdio.stderr({ endOnDone: false }))
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
  { disableErrorReporting: true },
)
