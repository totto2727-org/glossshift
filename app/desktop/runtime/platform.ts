import path from 'path'
import process from 'process'

import * as Platform from '@glossshift/nsh-platform'
import { Effect, Layer } from 'effect'

/** GUI environment policy belongs to GlossShift, not the reusable host platform. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const coreutils = process.env['GLOSSSHIFT_COREUTILS']
    const cwd = process.dataDir
    if (cwd === undefined || cwd === null || !path.isAbsolute(cwd))
      return yield* Effect.die(new Error('An absolute application working directory is required'))
    return Platform.layer({ cwd, coreutils, temporaryDirectory: cwd })
  }).pipe(Effect.orDie),
)
