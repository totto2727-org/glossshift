import { Effect } from 'effect'
import type { Config, FileSystem, Path, Stdio } from 'effect'

import { cliError } from '#cli/translation-error.ts'

/**
 * Preserve the desktop launcher's private invocation without loading GUI services.
 *
 * @param {ReadonlyArray<string>} args Arguments following the private desktop launcher flag.
 * @returns {Effect.Effect} The selected LaunchAgent operation.
 */
export const runAutostartCommand = (
  args: Readonly<string[]>,
): Effect.Effect<void, Error | Config.ConfigError, FileSystem.FileSystem | Path.Path | Stdio.Stdio> =>
  Effect.gen(function* () {
    const { runAutostart } = yield* Effect.tryPromise({
      catch: () => cliError('The autostart runtime could not be loaded.'),
      try: () => import('@glossshift/runtime/autostart'),
    })
    return yield* runAutostart(args)
  })
