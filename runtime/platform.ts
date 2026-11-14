import path from 'path'
import process from 'process'

import { Effect, Layer, String } from 'effect'

import * as Platform from '../platform.ts'

/** GUI environment policy belongs to GlossShift, not the reusable host platform. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const coreutils = process.env['GLOSSSHIFT_COREUTILS']
    if (
      coreutils !== undefined &&
      ((coreutils !== 'coreutils' && !String.startsWith('/nix/store/')(coreutils)) ||
        String.includes('..')(coreutils) ||
        String.includes('\0')(coreutils))
    )
      return yield* Effect.die(new Error('Invalid packaged coreutils executable'))
    const cwd = process.dataDir
    if (cwd === undefined || cwd === null || !path.isAbsolute(cwd))
      return yield* Effect.die(new Error('An absolute application working directory is required'))
    return Platform.layer({ cwd, coreutils, temporaryDirectory: cwd })
  }).pipe(Effect.orDie),
)
