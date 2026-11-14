import { Array, Effect, FileSystem, HashSet, Option, Path, String } from 'effect'

import { cliError, planBatch } from './cli.ts'
import type { BatchOptions } from './cli.ts'

const optionalStat = (path: string, follow: boolean) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* Effect.map(follow ? fs.stat(path) : fs.lstat(path), Option.some).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === 'NotFound',
        () => Effect.succeed(Option.none<FileSystem.File.Info>()),
      ),
    )
  })

const pathName = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.realPath(path.dirname(file))
    return String.toLowerCase(path.join(directory, path.basename(file)))
  })

const identity = (name: string, info: Option.Option<FileSystem.File.Info>) =>
  Option.match(info, {
    onNone: () => `path:${name}`,
    onSome: (stat) =>
      Option.match(stat.ino, {
        onNone: () => `path:${name}`,
        onSome: (ino) => `inode:${stat.dev}:${ino}`,
      }),
  })

/** Complete preflight before loading a model or opening any translation stream. */
export const prepareBatch = (options: BatchOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const plan = yield* planBatch(options)
    const inputNames = HashSet.fromIterable(yield* Effect.forEach(options.files, pathName))
    const inputIdentities = HashSet.fromIterable(
      yield* Effect.forEach(options.files, (input) =>
        Effect.gen(function* () {
          return identity(yield* pathName(input), yield* optionalStat(input, true))
        }),
      ),
    )
    let outputNames = HashSet.empty<string>()
    let outputIdentities = HashSet.empty<string>()
    for (const entry of plan) {
      if (Option.isNone(entry.output)) continue
      const output = entry.output.value
      const name = yield* pathName(output)
      if (HashSet.has(inputNames, name))
        return yield* Effect.fail(cliError(`output file '${output}' is also an input file`))
      const info = yield* optionalStat(output, false)
      const symlink = Option.isSome(info) && info.value.type === 'SymbolicLink'
      const force = options.output === 'files' && options.force
      if (symlink && !force) return yield* Effect.fail(cliError(`output path '${output}' is a symbolic link`))
      const outputIdentity = identity(name, symlink ? Option.none() : info)
      if (HashSet.has(inputIdentities, outputIdentity))
        return yield* Effect.fail(cliError(`output file '${output}' is also an input file`))
      if (HashSet.has(outputNames, name) || HashSet.has(outputIdentities, outputIdentity)) {
        return yield* Effect.fail(cliError(`multiple inputs resolve to the same output file '${output}'`))
      }
      outputNames = HashSet.add(outputNames, name)
      outputIdentities = HashSet.add(outputIdentities, outputIdentity)
    }
    // Keep collision errors ahead of ordinary overwrite errors, as in the Rust CLI.
    if (options.output === 'files' && !options.force) {
      yield* Effect.forEach(Array.getSomes(Array.map(plan, (entry) => entry.output)), (output) =>
        Effect.gen(function* () {
          if (yield* fs.exists(output))
            return yield* Effect.fail(cliError(`output file '${output}' already exists; pass --force to overwrite it`))
        }),
      )
    }
    return plan
  })

/** Replace a forced symbolic link itself. Never follow it when opening the output. */
export const writeTranslation = (
  path: string,
  translated: string,
  force: boolean,
  inputs: ReadonlyArray<string> = [],
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const protectedIdentities = HashSet.fromIterable(
        yield* Effect.forEach(inputs, (input) =>
          Effect.gen(function* () {
            return identity(yield* pathName(input), yield* optionalStat(input, true))
          }),
        ),
      )
      if (force) {
        const info = yield* optionalStat(path, false)
        if (Option.isSome(info) && info.value.type === 'SymbolicLink') yield* fs.remove(path)
      }
      // Append opens without truncating and needs no read permission. Truncate only after
      // checking the opened descriptor, so a swapped hard link cannot destroy an input.
      const file = yield* fs.open(path, { flag: force ? 'a' : 'wx', noFollow: true })
      const openedIdentity = identity(yield* pathName(path), Option.some(yield* file.stat))
      if (HashSet.has(protectedIdentities, openedIdentity)) {
        return yield* Effect.fail(cliError(`output file '${path}' is also an input file`))
      }
      if (force) yield* file.truncate(0)
      yield* file.writeAll(new TextEncoder().encode(translated))
    }),
  )

/** Rust read_to_string rejects malformed UTF-8 and preserves a leading UTF-8 BOM. */
export const readSource = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const bytes = yield* fs.readFile(path)
    return yield* Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      catch: () => cliError(`failed to read ${path}: input is not valid UTF-8`),
    })
  })
