import * as native from 'fs/promises'
import path from 'path'

import { Console, Effect, Layer, Sink, Stdio, Stream, String } from 'effect'

import { append } from './capture-output.ts'
import { failure, unsupported } from './errors.ts'

export const make = (options: Parameters<typeof Stdio.make>[0]) => Layer.succeed(Stdio.Stdio, Stdio.make(options))

/** A decoder belongs to one sink run, including incomplete UTF-8 sequences at chunk boundaries. */
const textSink = <E, R>(consume: (text: string) => Effect.Effect<void, E, R>) =>
  Sink.suspend(() => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const decode = (value?: string | Uint8Array) =>
      Effect.try({
        try: () =>
          typeof value === 'string'
            ? decoder.decode() + value
            : value === undefined
              ? decoder.decode()
              : decoder.decode(value, { stream: true }),
        catch: (cause) => failure('Stdio UTF-8', '', cause, 'Stdio'),
      }).pipe(Effect.flatMap((text) => (text === '' ? Effect.void : consume(text))))
    return Sink.forEach((value: string | Uint8Array) => decode(value)).pipe(Sink.mapEffect(() => decode()))
  })

/** GUI/TUI diagnostics go to NSH's host logger, not a parent stderr handle. Input and stdout remain unavailable. */
export const unavailable = (args: ReadonlyArray<string>) =>
  make({
    args: Effect.succeed(args),
    stdout: () => Sink.forEach(() => Effect.fail(unsupported('Stdio', 'stdout'))),
    stderr: () => textSink((text) => Console.error(text)),
    stdin: Stream.fail(unsupported('Stdio', 'stdin')),
  })

const output = (file: string, coreutils?: string) =>
  textSink((text) =>
    Effect.gen(function* () {
      let offset = 0
      while (offset < text.length) {
        let end = Math.min(offset + 65536, text.length)
        const last = text.charCodeAt(end - 1)
        if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1
        yield* append(file, text.slice(offset, end), coreutils)
        offset = end
      }
    }),
  )

export interface CaptureOptions {
  readonly args: ReadonlyArray<string>
  readonly stdout: string
  readonly stderr: string
  readonly stdoutIsTerminal?: boolean | undefined
  readonly stdin?: string | undefined
  readonly coreutils?: string | undefined
}

/** Capture files belong to the wrapper's private temporary directory, not terminal handles. */
export const capture = (options: CaptureOptions) =>
  make({
    args: Effect.succeed(options.args),
    stdoutIsTerminal: Effect.succeed(options.stdoutIsTerminal ?? false),
    stdout: () => output(options.stdout, options.coreutils),
    stderr: () => output(options.stderr, options.coreutils),
    stdin:
      options.stdin === undefined
        ? Stream.empty
        : Stream.fromEffect(
            Effect.gen(function* () {
              const file = options.stdin
              if (file === undefined || !path.isAbsolute(file) || String.includes('\0')(file))
                return yield* Effect.fail(unsupported('Stdio', 'stdin capture requires an absolute file path'))
              return yield* Effect.tryPromise({
                try: () => native.readFile(file),
                catch: (cause) => failure('read capture', file, cause, 'Stdio'),
              })
            }),
          ),
  })
