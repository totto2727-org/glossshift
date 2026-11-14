import { Array, Config, Effect, FileSystem, Option, Path, Schema, Stdio, Stream } from 'effect'
import * as plist from 'plist'

const identifier = 'com.totto2727.glossshift'
const fileName = `${identifier}.plist`
const Agent = Schema.Struct({
  Label: Schema.String,
  ProgramArguments: Schema.Array(Schema.String),
  RunAtLoad: Schema.Boolean,
  LimitLoadToSessionType: Schema.String,
  AssociatedBundleIdentifiers: Schema.Array(Schema.String),
  EnvironmentVariables: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const Bundle = Schema.Struct({ CFBundleIdentifier: Schema.String, CFBundleExecutable: Schema.String })
const fail = (message: string) => Effect.fail(new Error(message))
const parsePlist = (source: Uint8Array) =>
  Effect.try({
    try: (): unknown =>
      new TextDecoder().decode(source.subarray(0, 8)) === 'bplist00'
        ? plist.parseBinary(source)
        : plist.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)),
    catch: () => new Error('invalid or unrelated autostart plist'),
  })
const absolute = (value: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    if (!path.isAbsolute(value) || /\p{Cc}/u.test(value))
      return yield* fail('path must be absolute and contain no control characters')
    return value
  })
const agentFor = (app: string, xdg: Option.Option<string>) =>
  Effect.gen(function* () {
    yield* absolute(app)
    const environment = Option.isSome(xdg) ? { XDG_CONFIG_HOME: yield* absolute(xdg.value) } : {}
    return {
      Label: identifier,
      ProgramArguments: ['/usr/bin/open', '-g', app, '--args', '--background'],
      RunAtLoad: true,
      LimitLoadToSessionType: 'Aqua',
      AssociatedBundleIdentifiers: [identifier],
      EnvironmentVariables: environment,
    }
  })
const optionalStat = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.lstat(name).pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (error) => error.reason._tag === 'NotFound',
        () => Effect.succeed(Option.none<FileSystem.File.Info>()),
      ),
    )
  })
const validateApp = (app: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* absolute(app)
    if (path.extname(app) !== '.app' || (yield* fs.stat(app)).type !== 'Directory')
      return yield* fail('expected an existing .app directory')
    const bundle = yield* parsePlist(yield* fs.readFile(path.join(app, 'Contents/Info.plist'))).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Bundle)),
      Effect.mapError(() => new Error('invalid application Info.plist')),
    )
    if (
      bundle.CFBundleIdentifier !== identifier ||
      !Array.contains(['GlossShift', 'glossshift'], bundle.CFBundleExecutable)
    ) {
      return yield* fail('bundle identity does not match GlossShift')
    }
    const executable = yield* fs.stat(path.join(app, 'Contents/MacOS', bundle.CFBundleExecutable))
    if (executable.type !== 'File' || (executable.mode & 0o111) === 0)
      return yield* fail('bundle executable must be an executable file')
  })

/** No launchctl or application launch occurs. Only the next-login registration is changed. */
export const runAutostart = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const stdio = yield* Stdio.Stdio
    const home = yield* absolute(yield* Config.String('HOME'))
    const homeInfo = yield* fs.stat(home)
    if (homeInfo.type !== 'Directory' || Option.isNone(homeInfo.uid))
      return yield* fail('HOME must be an owned directory')
    const owner = homeInfo.uid.value
    const library = path.join(home, 'Library')
    const directory = path.join(library, 'LaunchAgents')
    const destination = path.join(directory, fileName)
    const checkDirectories = (create: boolean) =>
      Effect.gen(function* () {
        for (const name of [library, directory]) {
          const info = yield* optionalStat(name)
          if (Option.isSome(info)) {
            if (
              info.value.type !== 'Directory' ||
              !Option.contains(info.value.uid, owner) ||
              (info.value.mode & 0o022) !== 0
            ) {
              return yield* fail('unsafe registration directory')
            }
          } else if (create) yield* fs.makeDirectory(name, { mode: 0o700 })
        }
      })
    const read = Effect.gen(function* () {
      yield* checkDirectories(false)
      const info = yield* optionalStat(destination)
      if (Option.isNone(info)) return Option.none<string>()
      if (info.value.type !== 'File' || !Option.contains(info.value.uid, owner) || (info.value.mode & 0o022) !== 0) {
        return yield* fail('refusing unsafe autostart file')
      }
      const agent = yield* parsePlist(yield* fs.readFile(destination)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Agent, { onExcessProperty: 'error' })),
        Effect.mapError(() => new Error('invalid or unrelated autostart plist')),
      )
      const app = Array.get(agent.ProgramArguments, 2)
      if (Option.isNone(app)) return yield* fail('missing bundle argument')
      const environment = agent.EnvironmentVariables ?? {}
      const expected = yield* agentFor(app.value, Option.fromUndefinedOr(environment['XDG_CONFIG_HOME']))
      if (!Schema.toEquivalence(Agent)({ ...agent, EnvironmentVariables: environment }, expected)) {
        return yield* fail('refusing unrelated or modified autostart plist')
      }
      return app
    })
    const output = (text: string) => Stream.run(Stream.succeed(`${text}\n`), stdio.stdout({ endOnDone: false }))
    const command = Array.head(args)
    if (Option.contains(command, 'enable') && args.length === 3 && args[1] === '--app' && args[2] !== undefined) {
      const app = args[2]
      yield* validateApp(app)
      const agent = yield* agentFor(app, yield* Config.option(Config.String('XDG_CONFIG_HOME')))
      yield* read
      yield* checkDirectories(true)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fs.makeTempFileScoped({ directory, prefix: '.autostart-' })
          yield* fs.chmod(temporary, 0o600)
          yield* fs.writeFileString(
            temporary,
            yield* Effect.try({
              try: () => plist.build(agent),
              catch: () => new Error('Unable to serialize autostart configuration'),
            }),
          )
          const handle = yield* fs.open(temporary, { flag: 'r+' })
          yield* handle.sync
          const existing = yield* read
          if (Option.isSome(existing)) yield* fs.rename(temporary, destination)
          else yield* fs.link(temporary, destination)
        }),
      )
      yield* output(
        `Autostart configured for next login: ${app}\nNo application was launched. macOS may require background-item approval.`,
      )
    } else if (Option.contains(command, 'disable') && args.length === 1) {
      if (Option.isSome(yield* read)) yield* fs.remove(destination)
      yield* output('Autostart not configured for next login. Any running application is unchanged.')
    } else if (Option.contains(command, 'status') && args.length === 1) {
      const app = yield* read
      if (Option.isSome(app)) {
        yield* validateApp(app.value)
        yield* output(
          `Autostart configured for next login: ${app.value}\nConfiguration only. macOS authorization and running state are not checked.`,
        )
      } else yield* output('Autostart not configured for next login.')
    } else return yield* fail('Invalid private autostart arguments')
  })
