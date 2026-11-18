import { Effect } from 'effect'

import { cliError } from '../translationError.ts'

/** Preserve the desktop launcher's private invocation without loading GUI services. */
export const runAutostartCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { runAutostart } = yield* Effect.tryPromise({
      try: () => import('@glossshift/runtime/autostart'),
      catch: () => cliError('The autostart runtime could not be loaded.'),
    })
    return yield* runAutostart(args)
  })
