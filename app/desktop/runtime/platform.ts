// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import path from 'path'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import process from 'process'

import * as Platform from '@glossshift/nsh-platform'
import { Data, Predicate, Effect, Layer } from 'effect'

class InvalidWorkingDirectory extends Data.TaggedError('InvalidWorkingDirectory')<{ message: string }> {}

/** GUI environment policy belongs to GlossShift, not the reusable host platform. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const coreutils = process.env['GLOSSSHIFT_COREUTILS']
    const cwd = process.dataDir
    if (Predicate.isNullish(cwd) || !path.isAbsolute(cwd)) {
      return yield* Effect.die(
        new InvalidWorkingDirectory({ message: 'An absolute application working directory is required' }),
      )
    }
    return Platform.layer({ coreutils, cwd, temporaryDirectory: cwd })
  }).pipe(Effect.orDie),
)
