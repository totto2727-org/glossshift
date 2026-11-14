import * as native from 'fs/promises'

import { ByteSize, Effect, FileSystem, Option, Schema } from 'effect'

import { failure } from './errors.ts'
import type { RunTool } from './tools.ts'

const Metadata = Schema.Struct({
  dev: Schema.String,
  ino: Schema.String,
  mode: Schema.String,
  nlink: Schema.String,
  uid: Schema.String,
  gid: Schema.String,
  rdev: Schema.String,
  size: Schema.String,
  atime: Schema.String,
  mtime: Schema.String,
  birthtime: Schema.String,
  blksize: Schema.String,
  blocks: Schema.String,
})
const format =
  '{"dev":"%d","ino":"%i","mode":"%f","nlink":"%h","uid":"%u","gid":"%g","rdev":"%r","size":"%s","atime":"%X","mtime":"%Y","birthtime":"%W","blksize":"%o","blocks":"%b"}'
const integer = (value: string) => {
  if (!/^-?\d+$/u.test(value)) throw new Error('Invalid integer metadata')
  return BigInt(value)
}
const safeNumber = (value: string) => {
  const parsed = Number(integer(value))
  if (!Number.isSafeInteger(parsed)) throw new Error('Invalid numeric metadata')
  return parsed
}
const date = (value: string) => {
  const result = new Date(safeNumber(value) * 1000)
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid date metadata')
  return result
}

/** GNU stat supplies inode and ownership metadata absent from NSH's native Stats. */
export const make = (runTool: RunTool) => (path: string, follow: boolean) =>
  Effect.gen(function* () {
    // Native access validation also retains NSH's stable ENOENT and capability errors.
    yield* Effect.tryPromise({
      try: () => (follow ? native.stat(path) : native.lstat(path)),
      catch: (cause) => failure('stat', path, cause),
    })
    const output = yield* runTool('stat', [...(follow ? ['-L'] : []), `--printf=${format}`, '--', path])
    const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Metadata))(output).pipe(
      Effect.mapError((cause) => failure('stat metadata', path, cause)),
    )
    return yield* Effect.try({
      try: (): FileSystem.File.Info => {
        if (!/^[0-9a-f]+$/iu.test(value.mode)) throw new Error('Invalid file mode')
        const mode = Number.parseInt(value.mode, 16)
        const type = mode & 0o170000
        return {
          type:
            type === 0o100000
              ? 'File'
              : type === 0o040000
                ? 'Directory'
                : type === 0o120000
                  ? 'SymbolicLink'
                  : type === 0o060000
                    ? 'BlockDevice'
                    : type === 0o020000
                      ? 'CharacterDevice'
                      : type === 0o010000
                        ? 'FIFO'
                        : type === 0o140000
                          ? 'Socket'
                          : 'Unknown',
          mtime: Option.some(date(value.mtime)),
          atime: Option.some(date(value.atime)),
          birthtime: value.birthtime === '0' ? Option.none() : Option.some(date(value.birthtime)),
          dev: integer(value.dev),
          ino: Option.some(integer(value.ino)),
          mode,
          nlink: Option.some(integer(value.nlink)),
          uid: Option.some(safeNumber(value.uid)),
          gid: Option.some(safeNumber(value.gid)),
          rdev: Option.some(integer(value.rdev)),
          size: ByteSize.fromInputUnsafe(integer(value.size)),
          blksize: Option.some(ByteSize.fromInputUnsafe(integer(value.blksize))),
          blocks: Option.some(integer(value.blocks)),
        }
      },
      catch: (cause) => failure('stat metadata', path, cause),
    })
  })
