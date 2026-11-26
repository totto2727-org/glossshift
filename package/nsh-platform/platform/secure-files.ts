// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import * as native from 'fs/promises'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import path from 'path'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import process from 'process'

import { Predicate, Effect, PlatformError, String } from 'effect'
import type { FileSystem } from 'effect'

import { failure, unsupported, systemError } from './errors.ts'
import type { RunTool } from './tools.ts'

const call = <A>(
  method: string,
  file: string,
  run: () => Promise<A>,
): Effect.Effect<A, PlatformError.PlatformError, never> =>
  Effect.tryPromise({ catch: (cause) => failure(method, file, cause), try: run })

type FileOperation<A> = Effect.Effect<A, PlatformError.PlatformError>

type TemporaryOptions = Readonly<{
  directory?: string | undefined
  prefix?: string | undefined
  suffix?: string | undefined
}>

type WriteOptions = Readonly<{ flag?: FileSystem.OpenFlag | undefined; mode?: number | undefined }>

interface SecureFiles {
  chmod: (file: string, mode: number) => FileOperation<void>
  link: (from: string, to: string) => FileOperation<void>
  temp: (directory: boolean, options?: TemporaryOptions) => FileOperation<string>
  write: (file: string, data: Uint8Array, options?: WriteOptions) => FileOperation<void>
}

const minimumMode = 0
const maximumMode = 0o7777
const modeRadix = 8
const ownerReadWriteMode = 0o600
const stripFinalNewline = -1
const startOfOutput = 0
const invalidPathCharacters = /[\r\n\0]/u

const chmodFile =
  (runTool: RunTool): SecureFiles['chmod'] =>
  (file, mode) =>
    Number.isInteger(mode) && mode >= minimumMode && mode <= maximumMode
      ? runTool('chmod', [mode.toString(modeRadix), '--', file]).pipe(Effect.asVoid)
      : Effect.fail(PlatformError.badArgument({ description: 'Invalid mode', method: 'chmod', module: 'FileSystem' }))

type TemporaryPath = Readonly<{ root: string; configuredRoot: string; prefix: string; suffix: string }>

const validTemporaryPath = ({ root, configuredRoot, prefix, suffix }: TemporaryPath): boolean =>
  path.isAbsolute(root) &&
  !invalidPathCharacters.test(configuredRoot) &&
  !String.includes('/')(prefix) &&
  !String.includes('/')(suffix) &&
  !invalidPathCharacters.test(prefix + suffix)

const temporaryOutputPath = (root: string, output: string): FileOperation<string> => {
  if (!output.endsWith('\n')) {
    return Effect.fail(unsupported('FileSystem', 'invalid mktemp response'))
  }
  const file = output.slice(startOfOutput, stripFinalNewline)
  const expectedPrefix = root === '/' ? '/' : `${root}/`
  if (!String.startsWith(expectedPrefix)(file) || invalidPathCharacters.test(file)) {
    return Effect.fail(unsupported('FileSystem', 'invalid mktemp response'))
  }
  return Effect.succeed(file)
}

const temporaryFile =
  (runTool: RunTool, temporaryDirectory?: string): SecureFiles['temp'] =>
  (directory, options) =>
    Effect.gen(function* () {
      const configuredRoot = options?.directory ?? temporaryDirectory
      const prefix = options?.prefix ?? 'nsh-'
      const suffix = options?.suffix ?? ''
      const root = Predicate.isNullish(configuredRoot) ? undefined : path.normalize(configuredRoot)
      if (
        Predicate.isNullish(root) ||
        !validTemporaryPath({ configuredRoot: configuredRoot ?? '', prefix, root, suffix })
      ) {
        return yield* Effect.fail(
          PlatformError.badArgument({ description: 'Invalid temporary path', method: 'mktemp', module: 'FileSystem' }),
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
      return yield* temporaryOutputPath(root, output)
    })

const linkError =
  (file: string): ((error: PlatformError.PlatformError) => FileOperation<never>) =>
  (error) =>
    Effect.gen(function* () {
      const exists = yield* call('link', file, () => native.exists(file))
      if (exists) {
        return yield* Effect.fail(
          systemError('AlreadyExists', { method: 'link', module: 'FileSystem', pathOrDescriptor: file }),
        )
      }
      return yield* Effect.fail(error)
    })

const linkFiles =
  (runTool: RunTool): SecureFiles['link'] =>
  (from, to) =>
    runTool('ln', ['-T', '--', from, to]).pipe(
      Effect.asVoid,
      Effect.catchIf((error) => Predicate.isTagged('Unknown')(error.reason), linkError(to)),
    )

const removeStagedFile = (file: string): Effect.Effect<void> =>
  call('cleanup', file, () => native.unlink(file)).pipe(
    Effect.catchIf(
      (error) => Predicate.isTagged('NotFound')(error.reason),
      () => Effect.void,
    ),
    Effect.orDie,
  )

type StagingOperations = Pick<SecureFiles, 'chmod' | 'link' | 'temp'>

/**
 * Stage within a private sibling directory, then publish without following a target symlink.
 *
 * @param {StagingOperations} operations Permissions, linking, and temporary file operations.
 * @returns {Function} The scoped write operation for a single destination.
 */
const writeFile =
  ({ chmod, link, temp }: StagingOperations): SecureFiles['write'] =>
  (file, data, options) => {
    const flag = options?.flag ?? 'w'
    if (flag !== 'w' && flag !== 'wx') {
      return Effect.fail(unsupported('FileSystem', `writeFile flag ${flag}`))
    }
    return Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          temp(true, { directory: path.dirname(file) }),
          (stagingDirectory) =>
            call('cleanup', stagingDirectory, () => native.rmdir(stagingDirectory)).pipe(Effect.orDie),
        )
        const staged = `${directory}/content`
        yield* Effect.acquireRelease(
          call('writeFile', staged, () => native.writeFile(staged, data)),
          () => removeStagedFile(staged),
        )
        yield* chmod(staged, options?.mode ?? ownerReadWriteMode)
        yield* flag === 'wx' ? link(staged, file) : call('rename', file, () => native.rename(staged, file))
      }),
    )
  }

export const make = ({
  runTool,
  temporaryDirectory = process.dataDir ?? undefined,
}: Readonly<{
  runTool: RunTool
  temporaryDirectory?: string | undefined
}>): SecureFiles => {
  const chmod = chmodFile(runTool)
  const link = linkFiles(runTool)
  const temp = temporaryFile(runTool, temporaryDirectory)
  return { chmod, link, temp, write: writeFile({ chmod, link, temp }) }
}
