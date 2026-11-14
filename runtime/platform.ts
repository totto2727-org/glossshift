import path from 'path'
import process from 'process'

import { Effect, Layer, Schema, String } from 'effect'

import * as Platform from '../platform.ts'

/** Installed-launcher policy belongs to GlossShift, not the reusable host platform. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const env = process.env
    const coreutils = env['GLOSSSHIFT_COREUTILS']
    if (
      coreutils !== undefined &&
      ((coreutils !== 'coreutils' && !String.startsWith('/nix/store/')(coreutils)) ||
        String.includes('..')(coreutils) ||
        String.includes('\0')(coreutils))
    )
      return yield* Effect.die(new Error('Invalid packaged coreutils executable'))
    const cwd = env['GLOSSSHIFT_BATCH_CWD'] ?? process.dataDir
    if (cwd === undefined || cwd === null || !path.isAbsolute(cwd))
      return yield* Effect.die(new Error('An absolute application working directory is required'))
    const stdout = env['GLOSSSHIFT_BATCH_STDOUT']
    const stderr = env['GLOSSSHIFT_BATCH_STDERR']
    const encodedArgs = env['GLOSSSHIFT_BATCH_ARGS']
    const base = { cwd, coreutils, temporaryDirectory: process.dataDir ?? undefined }
    if (stdout === undefined && stderr === undefined && encodedArgs === undefined) return Platform.layer(base)
    if (
      stdout === undefined ||
      stderr === undefined ||
      encodedArgs === undefined ||
      !path.isAbsolute(stdout) ||
      !path.isAbsolute(stderr)
    )
      return yield* Effect.die(new Error('Incomplete NSH capture environment'))
    const args = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(encodedArgs)
    const stdin = env['GLOSSSHIFT_BATCH_STDIN']
    if (stdin !== undefined && !path.isAbsolute(stdin))
      return yield* Effect.die(new Error('Capture stdin requires an absolute path'))
    const terminal = env['GLOSSSHIFT_BATCH_STDOUT_IS_TTY']
    if (terminal !== undefined && terminal !== '0' && terminal !== '1')
      return yield* Effect.die(new Error('Invalid explicit batch stdout terminal flag'))
    return Platform.layer({
      ...base,
      stdio: Platform.NshStdio.capture({ args, stdout, stderr, stdin, stdoutIsTerminal: terminal === '1', coreutils }),
    })
  }).pipe(Effect.orDie),
)
