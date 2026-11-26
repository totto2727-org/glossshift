// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import * as native from 'fs/promises'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import path from 'path'

import { Predicate, Console, Effect, Layer, Sink, Stdio, Stream, String } from 'effect'
import type { PlatformError } from 'effect'

import { append } from './capture-output.ts'
import { platformFailure, unsupported } from './errors.ts'

const firstArgument = 0

export const make = (
  options: Parameters<typeof Stdio.make>[typeof firstArgument],
): Layer.Layer<Stdio.Stdio, never, never> => Layer.succeed(Stdio.Stdio, Stdio.make(options))

const decodeText = (decoder: TextDecoder, value?: string | Uint8Array): string => {
  if (Predicate.isString(value)) {
    return decoder.decode() + value
  }
  return Predicate.isNullish(value) ? decoder.decode() : decoder.decode(value, { stream: true })
}

/**
 * A decoder belongs to one sink run, including incomplete UTF-8 sequences at chunk boundaries.
 *
 * @param {Function} consume Handler for decoded text.
 * @returns {Sink.Sink} A sink with a fresh decoder for each execution.
 */
const textSink = <E, R>(
  consume: (text: string) => Effect.Effect<void, E, R>,
): Sink.Sink<void, string | Uint8Array, never, PlatformError.PlatformError | E, R> =>
  Sink.suspend(() => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const decode = (value?: string | Uint8Array): Effect.Effect<void, PlatformError.PlatformError | E, R> =>
      Effect.try({
        catch: (cause) => platformFailure({ cause, method: 'Stdio UTF-8', module: 'Stdio', path: '' }),
        try: () => decodeText(decoder, value),
      }).pipe(Effect.flatMap((text) => (String.isEmpty(text) ? Effect.void : consume(text))))
    return Sink.forEach((value: string | Uint8Array) => decode(value)).pipe(Sink.mapEffect(() => decode()))
  })

/**
 * GUI/TUI diagnostics go to NSH's host logger, not a parent stderr handle. Input and stdout remain unavailable.
 *
 * @param {ReadonlyArray<string>} args Arguments supplied to the native host.
 * @returns {Layer.Layer} Stdio services for a GUI or TUI host.
 */
export const unavailable = (args: Readonly<string[]>): Layer.Layer<Stdio.Stdio, never, never> =>
  make({
    args: Effect.succeed(args),
    stderr: () => textSink((text) => Console.error(text)),
    stdin: Stream.fail(unsupported('Stdio', 'stdin')),
    stdout: () => Sink.forEach(() => Effect.fail(unsupported('Stdio', 'stdout'))),
  })

const maxCaptureChunkLength = 65_536
const firstCodeUnit = 0
const precedingCodeUnit = 1
const firstHighSurrogate = 55_296
const lastHighSurrogate = 56_319

const captureChunkEnd = (text: string, offset: number): number => {
  const end = Math.min(offset + maxCaptureChunkLength, text.length)
  if (end === text.length) {
    return end
  }
  const lastIndex = end - precedingCodeUnit
  const code = text.slice(lastIndex, end).codePointAt(firstCodeUnit)
  return !Predicate.isNullish(code) && code >= firstHighSurrogate && code <= lastHighSurrogate ? lastIndex : end
}

const output = (
  file: string,
  coreutils?: string,
): Sink.Sink<void, string | Uint8Array, never, PlatformError.PlatformError> =>
  textSink((text) => {
    const appendFrom = (offset: number): Effect.Effect<void, PlatformError.PlatformError> =>
      Effect.suspend(() => {
        if (offset >= text.length) {
          return Effect.void
        }
        const end = captureChunkEnd(text, offset)
        const write = append({ executable: coreutils, file, text: text.slice(offset, end) })
        return Effect.andThen(write, () => appendFrom(end))
      })
    return appendFrom(firstCodeUnit)
  })

export type CaptureOptions = Readonly<{
  args: Readonly<string[]>
  stdout: string
  stderr: string
  stdoutIsTerminal?: boolean | undefined
  stdin?: string | undefined
  coreutils?: string | undefined
}>

/**
 * Capture files belong to the wrapper's private temporary directory, not terminal handles.
 *
 * @param {CaptureOptions} options Launcher-owned capture paths and terminal information.
 * @returns {Layer.Layer} Stdio services backed by the launcher capture files.
 */
export const capture = (options: CaptureOptions): Layer.Layer<Stdio.Stdio, never, never> =>
  make({
    args: Effect.succeed(options.args),
    stderr: () => output(options.stderr, options.coreutils),
    stdin: Predicate.isNullish(options.stdin)
      ? Stream.empty
      : Stream.fromEffect(
          Effect.gen(function* () {
            const file = options.stdin
            if (Predicate.isNullish(file) || !path.isAbsolute(file) || String.includes('\0')(file)) {
              return yield* Effect.fail(unsupported('Stdio', 'stdin capture requires an absolute file path'))
            }
            return yield* Effect.tryPromise({
              catch: (cause) => platformFailure({ cause, method: 'read capture', module: 'Stdio', path: file }),
              try: () => native.readFile(file),
            })
          }),
        ),
    stdout: () => output(options.stdout, options.coreutils),
    stdoutIsTerminal: Effect.succeed(options.stdoutIsTerminal ?? false),
  })
