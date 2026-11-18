import { Array, Config, Effect, FileSystem, Option, Path, Schema, String } from 'effect'
import { parse } from 'smol-toml'

export const defaultDesktopConfig = `[[shortcuts]]
keys = "Ctrl+Super+KeyJ"
target_language = "Japanese"

[window]
width = 560
height = 360
min_width = 320
min_height = 180
`

const DesktopSettings = Schema.Struct({
  shortcuts: Schema.Array(Schema.Struct({ keys: Schema.NonEmptyString, target_language: Schema.String })),
  window: Schema.Struct({
    width: Schema.Number,
    height: Schema.Number,
    min_width: Schema.Number,
    min_height: Schema.Number,
  }),
})

const invalid = () => new Error('GlossShift config.toml is invalid')

export const parseDesktopConfig = (source: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({ try: () => parse(source, { integersAsBigInt: 'asNeeded' }), catch: invalid })
    const decoded = yield* Schema.decodeUnknownEffect(DesktopSettings)(raw)
    // NSH consumes f32 dimensions. Validate the same rounded values as the native adapter did.
    const config = {
      ...decoded,
      window: {
        width: Math.fround(decoded.window.width),
        height: Math.fround(decoded.window.height),
        min_width: Math.fround(decoded.window.min_width),
        min_height: Math.fround(decoded.window.min_height),
      },
    }
    const { width, height, min_width, min_height } = config.window
    if (Array.some([width, height, min_width, min_height], (value) => !Number.isFinite(value) || value > 2147483647)) {
      return yield* Effect.fail(new Error('window size must contain finite values within native window limits'))
    }
    if (min_width <= 0 || min_height <= 0 || width < min_width || height < min_height) {
      return yield* Effect.fail(new Error('window size must be positive and at least its minimum size'))
    }
    if (
      config.shortcuts.length === 0 ||
      Array.some(config.shortcuts, (shortcut) => String.trim(shortcut.target_language) === '')
    ) {
      return yield* Effect.fail(new Error('at least one shortcut with a non-empty target_language is required'))
    }
    return config
  }).pipe(Effect.mapError(invalid))

/** Publishes complete defaults atomically without replacing an existing file or symlink. */
const initialize = (destination: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const existing = yield* fs.lstat(destination).pipe(
        Effect.map(Option.some),
        Effect.catchIf(
          (error) => error.reason._tag === 'NotFound',
          () => Effect.succeed(Option.none<FileSystem.File.Info>()),
        ),
      )
      if (Option.isSome(existing)) return false
      const directory = path.dirname(destination)
      yield* fs.makeDirectory(directory, { recursive: true })
      const temporary = yield* fs.makeTempFileScoped({ directory, prefix: '.config-' })
      yield* fs.writeFileString(temporary, defaultDesktopConfig)
      yield* fs.chmod(temporary, 0o644)
      return yield* fs.link(temporary, destination).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason._tag === 'AlreadyExists',
          () => Effect.succeed(false),
        ),
      )
    }),
  )

/** Pre-engine configuration, deliberately independent of translation and model services. */
export const loadDesktopConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const xdg = yield* Config.option(Config.String('XDG_CONFIG_HOME'))
  const home = yield* Config.option(Config.String('HOME'))
  const root = Option.filter(xdg, (value) => path.isAbsolute(value))
  const configRoot = Option.isSome(root)
    ? root.value
    : Option.isSome(home)
      ? path.join(home.value, '.config')
      : undefined
  if (configRoot === undefined || !path.isAbsolute(configRoot)) return yield* Effect.fail(invalid())
  const directory = path.join(configRoot, 'glossshift')
  const destination = path.join(directory, 'config.toml')
  const created_files = yield* initialize(destination)
  const config = yield* parseDesktopConfig(yield* fs.readFileString(destination))
  return { ...config, directory, created_files }
}).pipe(Effect.mapError(invalid))
