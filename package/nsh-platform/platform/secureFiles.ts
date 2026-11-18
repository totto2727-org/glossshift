import * as native from 'fs/promises'
import path from 'path'
import process from 'process'

import { Effect, PlatformError, String } from 'effect'

import { failure, unsupported } from './errors.ts'
import type { RunTool } from './tools.ts'

const call = <A>(method: string, file: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(method, file, cause) })

export const make = ({
  runTool,
  temporaryDirectory = process.dataDir ?? undefined,
}: {
  readonly runTool: RunTool
  readonly temporaryDirectory?: string | undefined
}) => {
  const chmod = (file: string, mode: number) =>
    Number.isInteger(mode) && mode >= 0 && mode <= 0o7777
      ? runTool('chmod', [mode.toString(8), '--', file]).pipe(Effect.asVoid)
      : Effect.fail(PlatformError.badArgument({ module: 'FileSystem', method: 'chmod', description: 'Invalid mode' }))

  const temp = (
    directory: boolean,
    options?: {
      readonly directory?: string | undefined
      readonly prefix?: string | undefined
      readonly suffix?: string | undefined
    },
  ) =>
    Effect.gen(function* () {
      const configuredRoot = options?.directory ?? temporaryDirectory
      const root = configuredRoot === undefined ? null : path.normalize(configuredRoot)
      const prefix = options?.prefix ?? 'nsh-'
      const suffix = options?.suffix ?? ''
      if (
        root === null ||
        !path.isAbsolute(root) ||
        /[\r\n\0]/u.test(configuredRoot ?? '') ||
        String.includes('/')(prefix) ||
        String.includes('/')(suffix) ||
        /[\r\n\0]/u.test(prefix + suffix)
      ) {
        return yield* Effect.fail(
          PlatformError.badArgument({ module: 'FileSystem', method: 'mktemp', description: 'Invalid temporary path' }),
        )
      }
      const output = yield* runTool('mktemp', [
        ...(directory ? ['-d'] : []),
        '-p',
        root,
        `--suffix=${suffix}`,
        '--',
        `${prefix}XXXXXXXXXX`,
      ])
      if (!output.endsWith('\n')) return yield* Effect.fail(unsupported('FileSystem', 'invalid mktemp response'))
      const file = output.slice(0, -1)
      if (!String.startsWith(root === '/' ? '/' : `${root}/`)(file) || /[\r\n\0]/u.test(file))
        return yield* Effect.fail(unsupported('FileSystem', 'invalid mktemp response'))
      return file
    })

  const link = (from: string, to: string) =>
    runTool('ln', ['-T', '--', from, to]).pipe(
      Effect.asVoid,
      Effect.catchIf(
        (error) => error.reason._tag === 'Unknown',
        (error) =>
          call('link', to, () => native.exists(to)).pipe(
            Effect.flatMap((exists) =>
              Effect.fail(
                exists
                  ? PlatformError.systemError({
                      _tag: 'AlreadyExists',
                      module: 'FileSystem',
                      method: 'link',
                      pathOrDescriptor: to,
                    })
                  : error,
              ),
            ),
          ),
      ),
    )

  /** Stage within a private sibling directory, then publish without following/replacing a target symlink. */
  const write = (
    file: string,
    data: Uint8Array,
    options?: { readonly flag?: import('effect/FileSystem').OpenFlag | undefined; readonly mode?: number | undefined },
  ) => {
    const flag = options?.flag ?? 'w'
    if (flag !== 'w' && flag !== 'wx') return Effect.fail(unsupported('FileSystem', `writeFile flag ${flag}`))
    return Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(temp(true, { directory: path.dirname(file) }), (directory) =>
          call('cleanup', directory, () => native.rmdir(directory)).pipe(Effect.orDie),
        )
        const staged = `${directory}/content`
        yield* Effect.acquireRelease(
          call('writeFile', staged, () => native.writeFile(staged, data)),
          () =>
            call('cleanup', staged, () => native.unlink(staged)).pipe(
              Effect.catchIf(
                (error) => error.reason._tag === 'NotFound',
                () => Effect.void,
              ),
              Effect.orDie,
            ),
        )
        yield* chmod(staged, options?.mode ?? 0o600)
        if (flag === 'wx') yield* link(staged, file)
        else yield* call('rename', file, () => native.rename(staged, file))
      }),
    )
  }
  return { chmod, temp, link, write }
}
