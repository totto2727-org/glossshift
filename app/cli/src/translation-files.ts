import { Predicate, Array, Effect, FileSystem, HashSet, Option, Path, String } from 'effect'
import type { PlatformError, Scope } from 'effect'

import type { CliError } from './translation-error.ts'
import { cliError } from './translation-error.ts'
import { planBatch } from './translation-plan.ts'
import type { BatchOptions, PlannedFile } from './translation-plan.ts'

const optionalStat = (
  path: string,
  follow: boolean,
): Effect.Effect<Option.Option<FileSystem.File.Info>, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* Effect.map(follow ? fs.stat(path) : fs.lstat(path), Option.some).pipe(
      Effect.catchIf(
        (error) => Predicate.isTagged('NotFound')(error.reason),
        () => Effect.succeed(Option.none<FileSystem.File.Info>()),
      ),
    )
  })

const pathName = (
  file: string,
): Effect.Effect<Lowercase<string>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.realPath(path.dirname(file))
    return String.toLowerCase(path.join(directory, path.basename(file)))
  })

const identity = (name: string, info: Option.Option<FileSystem.File.Info>): string =>
  Option.match(info, {
    onNone: () => `path:${name}`,
    onSome: (stat) =>
      Option.match(stat.ino, {
        onNone: () => `path:${name}`,
        onSome: (ino) => `inode:${stat.dev}:${ino}`,
      }),
  })

type FileIndexes = Readonly<{
  identities: HashSet.HashSet<string>
  names: HashSet.HashSet<string>
}>
type FileError = PlatformError.PlatformError | CliError
type FileServices = FileSystem.FileSystem | Path.Path

const indexInputs = (
  inputs: Readonly<string[]>,
): Effect.Effect<FileIndexes, PlatformError.PlatformError, FileServices> =>
  Effect.gen(function* () {
    const names = yield* Effect.forEach(inputs, pathName)
    const identities = yield* Effect.forEach(inputs, (input) =>
      Effect.gen(function* () {
        const name = yield* pathName(input)
        const info = yield* optionalStat(input, true)
        return identity(name, info)
      }),
    )
    return { identities: HashSet.fromIterable(identities), names: HashSet.fromIterable(names) }
  })

const outputIsInput = (output: string): CliError => cliError(`output file '${output}' is also an input file`)

const destinationKey = (
  output: string,
  name: string,
  force: boolean,
): Effect.Effect<string, FileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const info = yield* optionalStat(output, false)
    const symlink = Option.exists(info, (value) => value.type === 'SymbolicLink')
    if (symlink && !force) {
      return yield* Effect.fail(cliError(`output path '${output}' is a symbolic link`))
    }
    return identity(name, symlink ? Option.none() : info)
  })

const checkDestinations = (
  inputs: FileIndexes,
  outputs: Readonly<string[]>,
  force: boolean,
): Effect.Effect<void, FileError, FileServices> =>
  Effect.reduce(
    outputs,
    (): FileIndexes => ({ identities: HashSet.empty<string>(), names: HashSet.empty<string>() }),
    (seen, output) =>
      Effect.gen(function* () {
        const name = yield* pathName(output)
        if (HashSet.has(inputs.names, name)) {
          return yield* Effect.fail(outputIsInput(output))
        }
        const key = yield* destinationKey(output, name, force)
        if (HashSet.has(inputs.identities, key)) {
          return yield* Effect.fail(outputIsInput(output))
        }
        if (HashSet.has(seen.names, name) || HashSet.has(seen.identities, key)) {
          return yield* Effect.fail(cliError(`multiple inputs resolve to the same output file '${output}'`))
        }
        return { identities: HashSet.add(seen.identities, key), names: HashSet.add(seen.names, name) }
      }),
  ).pipe(Effect.asVoid)

const checkForOverwrite = (outputs: Readonly<string[]>): Effect.Effect<void, FileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* Effect.forEach(
      outputs,
      (output) =>
        Effect.gen(function* () {
          if (yield* fs.exists(output)) {
            return yield* Effect.fail(cliError(`output file '${output}' already exists; pass --force to overwrite it`))
          }
        }),
      { discard: true },
    )
  })

/**
 * Complete preflight before loading a model or opening any translation stream.
 *
 * @param {BatchOptions} options Input files and output policy.
 * @returns {Effect.Effect} The ordered plan after checking destination collisions.
 */
export const prepareBatch = (
  options: BatchOptions,
): Effect.Effect<Array.NonEmptyArray<PlannedFile>, FileError, FileServices> =>
  Effect.gen(function* () {
    const plan = yield* planBatch(options)
    const inputs = yield* indexInputs(options.files)
    const outputs = Array.getSomes(Array.map(plan, (entry) => entry.output))
    const force = options.output === 'files' && options.force
    yield* checkDestinations(inputs, outputs, force)
    // Collision errors come before overwrite errors.
    if (options.output === 'files' && !force) {
      yield* checkForOverwrite(outputs)
    }
    return plan
  })

const inspectDestination = (
  destination: string,
  inputs: FileIndexes,
): Effect.Effect<Option.Option<FileSystem.File.Info>, FileError, FileServices> =>
  Effect.gen(function* () {
    const name = yield* pathName(destination)
    const info = yield* optionalStat(destination, false)
    const target = Option.filter(info, (value) => value.type !== 'SymbolicLink')
    const key = identity(name, target)
    if (HashSet.has(inputs.names, name) || HashSet.has(inputs.identities, key)) {
      return yield* Effect.fail(outputIsInput(destination))
    }
    return info
  })

const defaultFilePermissions = 0o644
const permissionMask = 0o777

const filePermissions = (info: Option.Option<FileSystem.File.Info>): number => {
  if (Option.isNone(info) || info.value.type !== 'File') {
    return defaultFilePermissions
  }
  // oxlint-disable-next-line eslint/no-bitwise -- The output inherits the existing regular file's POSIX permission bits.
  return info.value.mode & permissionMask
}

const stageTranslation = (
  destination: string,
  translated: string,
  permissions: number,
): Effect.Effect<string, PlatformError.PlatformError, FileServices | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const temporary = yield* fs.makeTempFileScoped({ directory: path.dirname(destination), prefix: '.translation-' })
    yield* fs.writeFileString(temporary, translated)
    yield* fs.chmod(temporary, permissions)
    return temporary
  })

type TranslationOutput = Readonly<{
  destination: string
  force: boolean
  inputs?: Readonly<string[]>
  translated: string
}>

/**
 * Publish a complete sibling file atomically. Forced replacement never follows or truncates the old inode.
 *
 * @param {TranslationOutput} output Destination, complete translation, replacement policy, and protected sources.
 * @returns {Effect.Effect} Publication of the staged output file.
 */
export const writeTranslation = (output: TranslationOutput): Effect.Effect<void, FileError, FileServices> =>
  Effect.scoped(
    Effect.gen(function* () {
      const { destination, force, inputs = [], translated } = output
      const fs = yield* FileSystem.FileSystem
      const protectedInputs = yield* indexInputs(inputs)
      const inspect = inspectDestination(destination, protectedInputs)
      const previous = yield* inspect
      const temporary = yield* stageTranslation(destination, translated, filePermissions(previous))
      // Recheck after staging. Rename replaces a swapped symlink or hard link itself, never its target.
      yield* inspect
      yield* force ? fs.rename(temporary, destination) : fs.link(temporary, destination)
    }),
  )

/**
 * Rust read_to_string rejects malformed UTF-8 and preserves a leading UTF-8 BOM.
 *
 * @param {string} path Path of the input Markdown file.
 * @returns {Effect.Effect} Strictly decoded UTF-8 source with its original whitespace.
 */
export const readSource = (
  path: string,
): Effect.Effect<string, PlatformError.PlatformError | CliError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const bytes = yield* fs.readFile(path)
    return yield* Effect.try({
      catch: () => cliError(`failed to read ${path}: input is not valid UTF-8`),
      try: () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
    })
  })
