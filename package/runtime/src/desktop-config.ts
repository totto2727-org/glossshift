import { Data, Predicate, Array, Config, Effect, FileSystem, Option, Path, Schema, String } from 'effect'
import type { PlatformError } from 'effect'
import { parse } from 'smol-toml'

class DesktopConfigError extends Data.TaggedError('DesktopConfigError')<{ message: string }> {}

export const defaultDesktopConfig = `[[shortcuts]]
keys = "Ctrl+Super+KeyJ"
target_language = "Japanese"

[window]
width = 560
height = 360
min_width = 320
min_height = 180
`

const DesktopSettingsSchema = Schema.Struct({
  shortcuts: Schema.Array(Schema.Struct({ keys: Schema.NonEmptyString, target_language: Schema.String })),
  window: Schema.Struct({
    height: Schema.Number,
    min_height: Schema.Number,
    min_width: Schema.Number,
    width: Schema.Number,
  }),
})
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The TOML parser returns unvalidated configuration data.
const decodeDesktopSettings = Schema.decodeUnknownEffect(DesktopSettingsSchema)

const invalid = (): Error => new DesktopConfigError({ message: 'GlossShift config.toml is invalid' })

type DesktopSettings = typeof DesktopSettingsSchema.Type

const maxNativeWindowSize = 2_147_483_647
const zeroDimension = 0
const publicConfigMode = 0o644

const nativeWindow = (window: DesktopSettings['window']): DesktopSettings['window'] => ({
  height: Math.fround(window.height),
  min_height: Math.fround(window.min_height),
  min_width: Math.fround(window.min_width),
  width: Math.fround(window.width),
})

const validatedSettings = (settings: DesktopSettings): Effect.Effect<DesktopSettings, DesktopConfigError> => {
  // NSH consumes f32 dimensions. Validate the same rounded values as the native adapter did.
  const window = nativeWindow(settings.window)
  const { width, height, min_width, min_height } = window
  if (
    Array.some(
      [width, height, min_width, min_height],
      (value) => !Number.isFinite(value) || value > maxNativeWindowSize,
    )
  ) {
    return Effect.fail(
      new DesktopConfigError({ message: 'window size must contain finite values within native window limits' }),
    )
  }
  if (min_width <= zeroDimension || min_height <= zeroDimension || width < min_width || height < min_height) {
    return Effect.fail(
      new DesktopConfigError({ message: 'window size must be positive and at least its minimum size' }),
    )
  }
  if (
    Array.isReadonlyArrayEmpty(settings.shortcuts) ||
    Array.some(settings.shortcuts, (shortcut) => String.isEmpty(String.trim(shortcut.target_language)))
  ) {
    return Effect.fail(
      new DesktopConfigError({ message: 'at least one shortcut with a non-empty target_language is required' }),
    )
  }
  return Effect.succeed({ ...settings, window })
}

export const parseDesktopConfig = (source: string): Effect.Effect<DesktopSettings, Error> => {
  const parsed = Effect.try({ catch: invalid, try: () => parse(source, { integersAsBigInt: 'asNeeded' }) })
  return parsed.pipe(Effect.flatMap(decodeDesktopSettings), Effect.flatMap(validatedSettings), Effect.mapError(invalid))
}

/**
 * Publishes complete defaults atomically without replacing an existing file or symlink.
 *
 * @param {string} destination Path where the default TOML can be created.
 * @returns {Effect.Effect} An indicator that the default file was created.
 */
const initialize = (
  destination: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const existing = yield* fs.lstat(destination).pipe(
        Effect.map(Option.some),
        Effect.catchIf(
          (error) => Predicate.isTagged('NotFound')(error.reason),
          () => Effect.succeed(Option.none<FileSystem.File.Info>()),
        ),
      )
      if (Option.isSome(existing)) {
        return false
      }
      const directory = path.dirname(destination)
      yield* fs.makeDirectory(directory, { recursive: true })
      const temporary = yield* fs.makeTempFileScoped({ directory, prefix: '.config-' })
      yield* fs
        .writeFileString(temporary, defaultDesktopConfig)
        .pipe(Effect.andThen(() => fs.chmod(temporary, publicConfigMode)))
      return yield* fs.link(temporary, destination).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => Predicate.isTagged('AlreadyExists')(error.reason),
          () => Effect.succeed(false),
        ),
      )
    }),
  )

const desktopConfigRoot = Effect.gen(function* () {
  const path = yield* Path.Path
  const xdg = yield* Config.option(Config.String('XDG_CONFIG_HOME'))
  const home = yield* Config.option(Config.String('HOME'))
  const custom = Option.filter(xdg, (value) => path.isAbsolute(value))
  const root = Option.orElse(custom, () => Option.map(home, (value) => path.join(value, '.config')))
  if (Option.isNone(root) || !path.isAbsolute(root.value)) {
    return yield* Effect.fail(invalid())
  }
  return root.value
})

/** Pre-engine configuration, deliberately independent of translation and model services. */
export const loadDesktopConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* desktopConfigRoot
  const directory = path.join(root, 'glossshift')
  const destination = path.join(directory, 'config.toml')
  const created_files = yield* initialize(destination)
  const config = yield* parseDesktopConfig(yield* fs.readFileString(destination))
  return { ...config, created_files, directory }
}).pipe(Effect.mapError(invalid))
