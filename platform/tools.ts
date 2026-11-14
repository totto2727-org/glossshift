import path from 'path'
import process from 'process'

import { Effect, PlatformError } from 'effect'

import { failure, unsupported } from './errors.ts'

export type Tool = 'mktemp' | 'chmod' | 'ln' | 'realpath' | 'cp' | 'touch' | 'test' | 'mkdir' | 'stat'

export type RunTool = ReturnType<typeof make>

/** The caller supplies a capability-granted executable, without application packaging policy. */
export const make = (executable?: string | undefined) => (tool: Tool, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (executable === undefined)
      return yield* Effect.fail(unsupported('FileSystem', `${tool}: coreutils executable is unavailable`))
    if ((executable !== 'coreutils' && !path.isAbsolute(executable)) || executable.includes('\0'))
      return yield* Effect.fail(
        PlatformError.badArgument({
          module: 'FileSystem',
          method: tool,
          description: 'Coreutils requires an absolute executable path or the granted coreutils command',
        }),
      )
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
