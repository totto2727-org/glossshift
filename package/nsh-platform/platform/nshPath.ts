import { Effect, Layer, Path } from 'effect'

/** Relative resolution is anchored to an explicit absolute directory, never an invented cwd. */
export const make = (directory: string) =>
  Layer.effect(
    Path.Path,
    Effect.gen(function* () {
      const posix = yield* Path.Path
      if (!posix.isAbsolute(directory) || directory.includes('\0'))
        return yield* Effect.die(new Error('NSH Path requires an absolute base directory'))
      const resolve = (...segments: ReadonlyArray<string>) => posix.resolve(directory, ...segments)
      return Path.make({
        ...posix,
        resolve,
        relative: (from, to) => posix.relative(resolve(from), resolve(to)),
        toFileUrl: (path) => posix.toFileUrl(resolve(path)),
      })
    }).pipe(Effect.provide(Path.layer)),
  )
