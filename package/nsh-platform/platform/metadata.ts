// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import * as native from 'fs/promises'

import type { FileSystem, PlatformError } from 'effect'
import { Data, ByteSize, Effect, Option, Schema } from 'effect'

import { failure } from './errors.ts'
import type { RunTool } from './tools.ts'

class InvalidFileMetadata extends Data.TaggedError('InvalidFileMetadata')<{ message: string }> {}

const DecimalInteger = Schema.String.check(Schema.isPattern(/^-?\d+$/u))
const HexadecimalMode = Schema.String.check(Schema.isPattern(/^[0-9a-f]+$/iu))
const Metadata = Schema.Struct({
  atime: DecimalInteger,
  birthtime: DecimalInteger,
  blksize: DecimalInteger,
  blocks: DecimalInteger,
  dev: DecimalInteger,
  gid: DecimalInteger,
  ino: DecimalInteger,
  mode: HexadecimalMode,
  mtime: DecimalInteger,
  nlink: DecimalInteger,
  rdev: DecimalInteger,
  size: DecimalInteger,
  uid: DecimalInteger,
})
const decodeMetadata = Schema.decodeEffect(Schema.fromJsonString(Metadata))
const format =
  '{"dev":"%d","ino":"%i","mode":"%f","nlink":"%h","uid":"%u","gid":"%g","rdev":"%r","size":"%s","atime":"%X","mtime":"%Y","birthtime":"%W","blksize":"%o","blocks":"%b"}'
const fileTypeMask = 0o17_0000
const regularFile = 0o10_0000
const directory = 0o04_0000
const symbolicLink = 0o12_0000
const blockDevice = 0o06_0000
const characterDevice = 0o02_0000
const fifo = 0o01_0000
const socket = 0o14_0000
const fileTypes = new Map<number, FileSystem.File.Info['type']>([
  [regularFile, 'File'],
  [directory, 'Directory'],
  [symbolicLink, 'SymbolicLink'],
  [blockDevice, 'BlockDevice'],
  [characterDevice, 'CharacterDevice'],
  [fifo, 'FIFO'],
  [socket, 'Socket'],
])
const millisecondsPerSecond = 1000

const safeNumber = (value: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidFileMetadata({ message: 'Invalid numeric metadata' })
  }
  return parsed
}
const date = (value: string): Date => {
  // oxlint-disable-next-line rules/no-js-date -- Effect FileSystem.File.Info exposes JavaScript Date for these timestamps.
  const result = new Date(safeNumber(value) * millisecondsPerSecond)
  if (!Number.isFinite(result.getTime())) {
    throw new InvalidFileMetadata({ message: 'Invalid date metadata' })
  }
  return result
}

const toFileInfo = (value: typeof Metadata.Type): FileSystem.File.Info => {
  const mode = Number.parseInt(value.mode, 16)
  // oxlint-disable-next-line eslint/no-bitwise -- POSIX stat stores the file type in the high mode bits.
  const type = fileTypes.get(mode & fileTypeMask) ?? 'Unknown'
  return {
    atime: Option.some(date(value.atime)),
    birthtime: value.birthtime === '0' ? Option.none() : Option.some(date(value.birthtime)),
    blksize: Option.some(ByteSize.fromInputUnsafe(BigInt(value.blksize))),
    blocks: Option.some(BigInt(value.blocks)),
    dev: BigInt(value.dev),
    gid: Option.some(safeNumber(value.gid)),
    ino: Option.some(BigInt(value.ino)),
    mode,
    mtime: Option.some(date(value.mtime)),
    nlink: Option.some(BigInt(value.nlink)),
    rdev: Option.some(BigInt(value.rdev)),
    size: ByteSize.fromInputUnsafe(BigInt(value.size)),
    type,
    uid: Option.some(safeNumber(value.uid)),
  }
}

/**
 * GNU stat supplies inode and ownership metadata absent from NSH's native Stats.
 *
 * @param {RunTool} runTool Capability-granted GNU stat execution.
 * @returns {Function} A stat operation that also supports non-following lstat.
 */
export const make =
  (
    runTool: RunTool,
  ): ((path: string, follow: boolean) => Effect.Effect<FileSystem.File.Info, PlatformError.PlatformError>) =>
  (path, follow) =>
    Effect.gen(function* () {
      // Native access validation also retains NSH's stable ENOENT and capability errors.
      yield* Effect.tryPromise({
        catch: (cause) => failure('stat', path, cause),
        try: () => (follow ? native.stat(path) : native.lstat(path)),
      })
      const output = yield* runTool('stat', [...(follow ? ['-L'] : []), `--printf=${format}`, '--', path])
      const value = yield* decodeMetadata(output).pipe(
        Effect.mapError((cause) => failure('stat metadata', path, cause)),
      )
      return yield* Effect.try({
        catch: (cause) => failure('stat metadata', path, cause),
        try: () => toFileInfo(value),
      })
    })
