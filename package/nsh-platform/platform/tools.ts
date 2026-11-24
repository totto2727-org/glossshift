// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import path from 'path'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import { run } from 'process'

import { Predicate, Effect, PlatformError } from 'effect'

import { failure, unsupported, systemError } from './errors.ts'

export type Tool = 'mktemp' | 'chmod' | 'ln' | 'realpath' | 'cp' | 'touch' | 'test' | 'mkdir' | 'stat'

const successfulExit = 0

export type RunTool = ReturnType<typeof make>

/**
 * The caller supplies a capability-granted executable, without application packaging policy.
 *
 * @param {string} executable The coreutils executable authorized by the host.
 * @returns {RunTool} A runner that supplies the verified executable with the requested command.
 */
export const make =
  (
    executable?: string | undefined,
  ): ((tool: Tool, args: Readonly<string[]>) => Effect.Effect<string, PlatformError.PlatformError, never>) =>
  (tool: Tool, args: Readonly<string[]>): Effect.Effect<string, PlatformError.PlatformError, never> =>
    Effect.gen(function* () {
      if (Predicate.isNullish(executable)) {
        return yield* Effect.fail(unsupported('FileSystem', `${tool}: coreutils executable is unavailable`))
      }
      if ((executable !== 'coreutils' && !path.isAbsolute(executable)) || executable.includes('\0')) {
        return yield* Effect.fail(
          PlatformError.badArgument({
            description: 'Coreutils requires an absolute executable path or the granted coreutils command',
            method: tool,
            module: 'FileSystem',
          }),
        )
      }
      const result = yield* Effect.tryPromise({
        catch: (cause) => failure(tool, '', cause),
        try: () => run(executable, [`--coreutils-prog=${tool}`, ...args], { timeoutMs: 30_000 }),
      })
      if (result.code !== successfulExit) {
        return yield* Effect.fail(
          systemError('Unknown', {
            description: `Packaged ${tool} failed with status ${result.code ?? 'signal'}`,
            method: tool,
            module: 'FileSystem',
          }),
        )
      }
      return result.stdout
    })
