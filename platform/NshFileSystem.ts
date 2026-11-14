import * as native from 'fs/promises'

import { Effect, FileSystem, Layer, Stream } from 'effect'

import { failure, unsupported } from './errors.ts'
import * as metadata from './metadata.ts'
import * as secureFiles from './secure-files.ts'
import * as tools from './tools.ts'

const call = <A>(method: string, path: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(method, path, cause) })
const deny = (method: string) => Effect.fail(unsupported('FileSystem', method))

const nativeType = (value: native.Stats): FileSystem.File.Info['type'] =>
  value.isSymbolicLink() ? 'SymbolicLink' : value.isDirectory() ? 'Directory' : value.isFile() ? 'File' : 'Unknown'

const remove = (
  path: string,
  options?: { readonly recursive?: boolean | undefined; readonly force?: boolean | undefined },
): Effect.Effect<void, import('effect/PlatformError').PlatformError> => {
  const operation = Effect.gen(function* () {
    const entry = yield* call('remove', path, () => native.lstat(path))
    if (!entry.isDirectory()) return yield* call('remove', path, () => native.unlink(path))
    if (options?.recursive) {
      const entries = yield* call('remove', path, () => native.readdir(path))
      yield* Effect.forEach(entries, (name) => remove(`${path}/${name}`, options), { discard: true })
    }
    yield* call('remove', path, () => native.rmdir(path))
  })
  return options?.force
    ? operation.pipe(
        Effect.catchIf(
          (error) => error.reason._tag === 'NotFound',
          () => Effect.void,
        ),
      )
    : operation
}

export interface Options {
  readonly coreutils?: string | undefined
  readonly temporaryDirectory?: string | undefined
}

export const make = (options: Options = {}) => {
  const runTool = tools.make(options.coreutils)
  const stat = metadata.make(runTool)
  const secure = secureFiles.make({ runTool, temporaryDirectory: options.temporaryDirectory })
  return FileSystem.make({
    access: (path, options) =>
      options?.readable || options?.writable
        ? runTool('test', [
            ...(options.readable ? ['-r', path] : ['-e', path]),
            ...(options.writable ? ['-a', '-w', path] : []),
          ]).pipe(Effect.asVoid)
        : call('access', path, () => native.stat(path)).pipe(Effect.asVoid),
    copy: () => deny('copy'),
    copyFile: (from, to) => runTool('cp', ['--no-target-directory', '--', from, to]).pipe(Effect.asVoid),
    chmod: secure.chmod,
    chown: () => deny('chown'),
    link: secure.link,
    lstat: (path) => stat(path, false),
    makeDirectory: (path, options) =>
      options?.mode !== undefined
        ? runTool('mkdir', [...(options.recursive ? ['-p'] : []), '-m', options.mode.toString(8), '--', path]).pipe(
            Effect.asVoid,
          )
        : call('makeDirectory', path, () => native.mkdir(path, { recursive: options?.recursive ?? false })),
    makeTempDirectory: (options) => secure.temp(true, options),
    makeTempDirectoryScoped: (options) =>
      Effect.acquireRelease(secure.temp(true, options), (path) =>
        remove(path, { recursive: true, force: true }).pipe(Effect.orDie),
      ),
    makeTempFile: (options) => secure.temp(false, options),
    makeTempFileScoped: (options) =>
      Effect.acquireRelease(secure.temp(false, options), (path) => remove(path, { force: true }).pipe(Effect.orDie)),
    open: () => deny('open'),
    readDirectory: (path, options) =>
      options?.recursive ? deny('readDirectory recursive') : call('readDirectory', path, () => native.readdir(path)),
    readDirectoryEntries: (path) =>
      call('readDirectoryEntries', path, () => native.readdir(path)).pipe(
        Effect.flatMap((names) =>
          Effect.forEach(names, (name) =>
            call('readDirectoryEntries', `${path}/${name}`, () => native.lstat(`${path}/${name}`)).pipe(
              Effect.map((entry) => ({ name, type: nativeType(entry) })),
            ),
          ),
        ),
      ),
    readFile: (path) => call('readFile', path, () => native.readFile(path)),
    readLink: (path) => call('readLink', path, () => native.readlink(path)),
    realPath: (path) =>
      runTool('realpath', ['--zero', '-e', '--', path]).pipe(
        Effect.flatMap((output) =>
          output.endsWith('\0') && !output.slice(0, -1).includes('\0')
            ? Effect.succeed(output.slice(0, -1))
            : Effect.fail(unsupported('FileSystem', 'invalid realpath response')),
        ),
      ),
    remove,
    rename: (from, to) => call('rename', from, () => native.rename(from, to)),
    stat: (path) => stat(path, true),
    symlink: (from, to) => runTool('ln', ['-s', '-T', '--', from, to]).pipe(Effect.asVoid),
    truncate: () => deny('truncate'),
    utimes: () => deny('utimes'),
    watch: () => Stream.fail(unsupported('FileSystem', 'watch')),
    writeFile: secure.write,
  })
}

export const layer = (options: Options = {}) => Layer.succeed(FileSystem.FileSystem, make(options))
