import process from 'process'

import { Effect, PlatformError, String } from 'effect'

import { failure, unsupported } from './errors.ts'

export type Tool = 'mktemp' | 'chmod' | 'ln' | 'realpath' | 'cp' | 'touch' | 'test' | 'mkdir' | 'stat'

/** The installed launcher sets this immutable package path, never PATH lookup. */
export const runTool = (tool: Tool, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const executable = process.env['GLOSSSHIFT_COREUTILS']
    if (
      typeof executable !== 'string' ||
      (executable !== 'coreutils' && !String.startsWith('/nix/store/')(executable)) ||
      String.includes('..')(executable)
    ) {
      return yield* Effect.fail(unsupported('FileSystem', `packaged ${tool}: GLOSSSHIFT_COREUTILS is unavailable`))
    }
    const result = yield* Effect.tryPromise({
      try: () => process.run(executable, [`--coreutils-prog=${tool}`, ...args], { timeoutMs: 30_000 }),
      catch: (cause) => failure(tool, '', cause),
    })
    if (result.code !== 0)
      return yield* Effect.fail(
        PlatformError.systemError({
          _tag: 'Unknown',
          module: 'FileSystem',
          method: tool,
          description: `Packaged ${tool} failed with status ${result.code ?? 'signal'}`,
        }),
      )
    return result.stdout
  })
