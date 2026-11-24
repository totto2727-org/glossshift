import { Data, Predicate, Array, Config, Effect, FileSystem, Option, Path, Schema, Stdio, Stream } from 'effect'
import type { PlatformError, Types } from 'effect'
import * as plist from 'plist'

class AutostartError extends Data.TaggedError('AutostartError')<{ message: string }> {}

const identifier = 'com.totto2727.glossshift'
const fileName = `${identifier}.plist`
const binaryPlistHeader = 'bplist00'
const binaryPlistOffset = 0
const bundleArgumentIndex = 2
const executableBits = 0o111
const sharedWriteBits = 0o022
const emptyPermissionBits = 0
const privateFileMode = 0o600
const enableArgumentCount = 3
const standaloneArgumentCount = 1

const hasPermission = (mode: number, permissionBits: number): boolean =>
  // oxlint-disable-next-line eslint/no-bitwise -- POSIX file modes represent each permission with a separate bit.
  (mode & permissionBits) !== emptyPermissionBits

const Agent = Schema.Struct({
  AssociatedBundleIdentifiers: Schema.Array(Schema.String),
  EnvironmentVariables: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  Label: Schema.String,
  LimitLoadToSessionType: Schema.String,
  ProgramArguments: Schema.Array(Schema.String),
  RunAtLoad: Schema.Boolean,
})
type AgentPlist = Omit<Types.DeepMutable<typeof Agent.Type>, 'EnvironmentVariables'> & {
  EnvironmentVariables: Record<string, string>
}
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The existing plist is read from disk and must be validated before modification.
const decodeAgent = Schema.decodeUnknownEffect(Agent, { onExcessProperty: 'error' })
const Bundle = Schema.Struct({ CFBundleExecutable: Schema.String, CFBundleIdentifier: Schema.String })
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The external application plist is untrusted until its bundle shape is validated.
const decodeBundle = Schema.decodeUnknownEffect(Bundle)
const fail = (message: string): Effect.Effect<never, AutostartError, never> =>
  Effect.fail(new AutostartError({ message }))
const parsePlist = (source: Uint8Array): Effect.Effect<unknown, AutostartError, never> =>
  Effect.try({
    catch: () => new AutostartError({ message: 'invalid or unrelated autostart plist' }),
    try: (): unknown =>
      new TextDecoder().decode(source.subarray(binaryPlistOffset, binaryPlistHeader.length)) === binaryPlistHeader
        ? plist.parseBinary(source)
        : plist.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)),
  })
const absolute = (value: string): Effect.Effect<string, AutostartError, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    if (!path.isAbsolute(value) || /\p{Cc}/u.test(value)) {
      return yield* fail('path must be absolute and contain no control characters')
    }
    return value
  })
const agentFor = (app: string, xdg: Option.Option<string>): Effect.Effect<AgentPlist, AutostartError, Path.Path> =>
  Effect.gen(function* () {
    yield* absolute(app)
    const environment = Option.isSome(xdg) ? { XDG_CONFIG_HOME: yield* absolute(xdg.value) } : {}
    return {
      AssociatedBundleIdentifiers: [identifier],
      EnvironmentVariables: environment,
      Label: identifier,
      LimitLoadToSessionType: 'Aqua',
      ProgramArguments: ['/usr/bin/open', '-g', app, '--args', '--background'],
      RunAtLoad: true,
    }
  })
const optionalStat = (
  name: string,
): Effect.Effect<Option.Option<FileSystem.File.Info>, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.lstat(name).pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (error) => Predicate.isTagged('NotFound')(error.reason),
        () => Effect.succeed(Option.none<FileSystem.File.Info>()),
      ),
    )
  })
const validateExecutable = (executable: string): Effect.Effect<undefined, RegistrationError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(executable)
    if (info.type !== 'File' || !hasPermission(info.mode, executableBits)) {
      return yield* fail('bundle executable must be an executable file')
    }
  })

const validateApp = (
  app: string,
): Effect.Effect<undefined, AutostartError | PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* absolute(app)
    if (path.extname(app) !== '.app' || (yield* fs.stat(app)).type !== 'Directory') {
      return yield* fail('expected an existing .app directory')
    }
    const bundle = yield* parsePlist(yield* fs.readFile(path.join(app, 'Contents/Info.plist'))).pipe(
      Effect.flatMap(decodeBundle),
      Effect.mapError(() => new AutostartError({ message: 'invalid application Info.plist' })),
    )
    if (
      bundle.CFBundleIdentifier !== identifier ||
      !Array.contains(['GlossShift', 'glossshift'], bundle.CFBundleExecutable)
    ) {
      return yield* fail('bundle identity does not match GlossShift')
    }
    yield* validateExecutable(path.join(app, 'Contents/MacOS', bundle.CFBundleExecutable))
  })

type Registration = Readonly<{
  destination: string
  directory: string
  library: string
  owner: number
}>
type RegistrationError = AutostartError | PlatformError.PlatformError
type RegistrationServices = FileSystem.FileSystem | Path.Path

const registration = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const configuredHome = yield* Config.String('HOME')
  const home = yield* absolute(configuredHome)
  const info = yield* fs.stat(home)
  if (info.type !== 'Directory' || Option.isNone(info.uid)) {
    return yield* fail('HOME must be an owned directory')
  }
  const library = path.join(home, 'Library')
  const directory = path.join(library, 'LaunchAgents')
  return {
    destination: path.join(directory, fileName),
    directory,
    library,
    owner: info.uid.value,
  } satisfies Registration
})

const isOwned = (info: FileSystem.File.Info, owner: number): boolean =>
  Option.contains(info.uid, owner) && !hasPermission(info.mode, sharedWriteBits)

const checkDirectories = (
  files: Registration,
  create: boolean,
): Effect.Effect<void, RegistrationError, FileSystem.FileSystem> =>
  Effect.forEach(
    [files.library, files.directory],
    (name) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const info = yield* optionalStat(name)
        if (Option.isSome(info)) {
          if (info.value.type !== 'Directory' || !isOwned(info.value, files.owner)) {
            return yield* fail('unsafe registration directory')
          }
        } else if (create) {
          yield* fs.makeDirectory(name, { mode: 0o700 })
        }
      }),
    { discard: true },
  )

const equivalentAgent = Schema.toEquivalence(Agent)

const readBundlePath = (document: Uint8Array): Effect.Effect<string, AutostartError, Path.Path> =>
  Effect.gen(function* () {
    const agent = yield* parsePlist(document).pipe(
      Effect.flatMap(decodeAgent),
      Effect.mapError(() => new AutostartError({ message: 'invalid or unrelated autostart plist' })),
    )
    const app = Array.get(agent.ProgramArguments, bundleArgumentIndex)
    if (Option.isNone(app)) {
      return yield* fail('missing bundle argument')
    }
    const environment = agent.EnvironmentVariables ?? {}
    const xdg = Option.fromUndefinedOr(environment['XDG_CONFIG_HOME'])
    const expected = yield* agentFor(app.value, xdg)
    if (!equivalentAgent({ ...agent, EnvironmentVariables: environment }, expected)) {
      return yield* fail('refusing unrelated or modified autostart plist')
    }
    return app.value
  })

const readRegistration = (
  files: Registration,
): Effect.Effect<Option.Option<string>, RegistrationError, RegistrationServices> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* checkDirectories(files, false)
    const info = yield* optionalStat(files.destination)
    if (Option.isNone(info)) {
      return Option.none<string>()
    }
    if (info.value.type !== 'File' || !isOwned(info.value, files.owner)) {
      return yield* fail('refusing unsafe autostart file')
    }
    const document = yield* fs.readFile(files.destination)
    return yield* readBundlePath(document).pipe(Effect.map(Option.some))
  })

const publishRegistration = (
  files: Registration,
  agent: AgentPlist,
): Effect.Effect<void, RegistrationError, RegistrationServices> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const temporary = yield* fs.makeTempFileScoped({ directory: files.directory, prefix: '.autostart-' })
      yield* fs.chmod(temporary, privateFileMode)
      const document = yield* Effect.try({
        catch: () => new AutostartError({ message: 'Unable to serialize autostart configuration' }),
        try: () => plist.build(agent),
      })
      yield* fs.writeFileString(temporary, document)
      // Recheck ownership and contents before publishing the complete staged plist.
      const existing = yield* readRegistration(files)
      yield* Option.isSome(existing) ? fs.rename(temporary, files.destination) : fs.link(temporary, files.destination)
    }),
  )

const enableRegistration = (
  files: Registration,
  app: string,
): Effect.Effect<string, RegistrationError | Config.ConfigError, RegistrationServices> =>
  Effect.gen(function* () {
    yield* validateApp(app)
    const xdg = yield* Config.option(Config.String('XDG_CONFIG_HOME'))
    const agent = yield* agentFor(app, xdg)
    yield* readRegistration(files)
    yield* checkDirectories(files, true)
    yield* publishRegistration(files, agent)
    return `Autostart configured for next login: ${app}\nNo application was launched. macOS may require background-item approval.`
  })

const disableRegistration = (files: Registration): Effect.Effect<string, RegistrationError, RegistrationServices> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const existing = yield* readRegistration(files)
    if (Option.isSome(existing)) {
      yield* fs.remove(files.destination)
    }
    return 'Autostart not configured for next login. Any running application is unchanged.'
  })

const registrationStatus = (files: Registration): Effect.Effect<string, RegistrationError, RegistrationServices> =>
  Effect.gen(function* () {
    const app = yield* readRegistration(files)
    if (Option.isNone(app)) {
      return 'Autostart not configured for next login.'
    }
    yield* validateApp(app.value)
    return `Autostart configured for next login: ${app.value}\nConfiguration only. macOS authorization and running state are not checked.`
  })

const registrationMessage = (
  files: Registration,
  args: Readonly<string[]>,
): Effect.Effect<string, RegistrationError | Config.ConfigError, RegistrationServices> => {
  const [command, flag, app] = args
  if (command === 'enable' && args.length === enableArgumentCount && flag === '--app' && Predicate.isNotNullish(app)) {
    return enableRegistration(files, app)
  }
  if (command === 'disable' && args.length === standaloneArgumentCount) {
    return disableRegistration(files)
  }
  if (command === 'status' && args.length === standaloneArgumentCount) {
    return registrationStatus(files)
  }
  return fail('Invalid private autostart arguments')
}

/**
 * Update the next-login LaunchAgent registration.
 *
 * @param {ReadonlyArray<string>} args Enable, disable, or status followed by any required flags.
 * @returns {Effect.Effect} Access to the configured LaunchAgent registration.
 */
export const runAutostart = (
  args: Readonly<string[]>,
): Effect.Effect<void, RegistrationError | Config.ConfigError, RegistrationServices | Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const files = yield* registration
    const message = yield* registrationMessage(files, args)
    yield* Stream.run(Stream.succeed(`${message}\n`), stdio.stdout({ endOnDone: false }))
  })
