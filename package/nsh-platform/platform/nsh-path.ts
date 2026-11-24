import { Data, Effect, Layer, Path } from 'effect'

class InvalidWorkingDirectory extends Data.TaggedError('InvalidWorkingDirectory')<{ message: string }> {}

/**
 * Resolve relative paths from the supplied working directory.
 *
 * @param {string} directory Absolute directory for path resolution.
 * @returns {Layer.Layer} The NSH Path layer.
 */
export const make = (directory: string): Layer.Layer<Path.Path, never, never> =>
  Layer.effect(
    Path.Path,
    Effect.gen(function* () {
      const posix = yield* Path.Path
      if (!posix.isAbsolute(directory) || directory.includes('\0')) {
        return yield* Effect.die(
          new InvalidWorkingDirectory({ message: 'NSH Path requires an absolute base directory' }),
        )
      }
      const resolve = (...segments: Readonly<string[]>): string => posix.resolve(directory, ...segments)
      return Path.make({
        ...posix,
        relative: (from, to) => posix.relative(resolve(from), resolve(to)),
        resolve,
        toFileUrl: (path) => posix.toFileUrl(resolve(path)),
      })
    }).pipe(Effect.provide(Path.layer)),
  )
