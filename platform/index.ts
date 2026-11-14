import process from 'process'

import { Effect, Layer } from 'effect'

import * as NshChildProcess from './NshChildProcess.ts'
import * as NshConfigProvider from './NshConfigProvider.ts'
import * as NshFileSystem from './NshFileSystem.ts'
import * as NshPath from './NshPath.ts'
import * as NshStdio from './NshStdio.ts'

export { NshChildProcess, NshConfigProvider, NshFileSystem, NshPath, NshStdio }

/** One reusable platform for NSH applications. The batch wrapper supplies its original cwd explicitly. */
export const layer = Layer.unwrap(
  Effect.sync(() => {
    const base = process.env['GLOSSSHIFT_BATCH_CWD'] ?? process.dataDir
    if (base === null) throw new Error('NSH platform requires an explicit absolute cwd or app data directory')
    return Layer.mergeAll(
      NshFileSystem.layer,
      NshPath.make(base),
      NshConfigProvider.layer,
      NshStdio.layer,
      NshChildProcess.layer,
    )
  }),
)
