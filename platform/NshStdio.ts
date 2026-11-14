import path from 'path'
import process from 'process'

import { Console, Effect, Layer, Schema, Sink, Stdio, Stream } from 'effect'

import { append } from './capture-output.ts'
import { failure, unsupported } from './errors.ts'
import { fileSystem } from './NshFileSystem.ts'

export const make = (options: Parameters<typeof Stdio.make>[0]) => Layer.succeed(Stdio.Stdio, Stdio.make(options))

/** GUI/TUI diagnostics go to NSH's host logger, not a parent stderr handle. Input and stdout remain unavailable. */
export const unavailable = (args: ReadonlyArray<string>) =>
  make({
    args: Effect.succeed(args),
    stdout: () => Sink.forEach(() => Effect.fail(unsupported('Stdio', 'stdout'))),
    stderr: () =>
      Sink.forEach((value: string | Uint8Array) =>
        Effect.try({
          try: () => (typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value)),
          catch: (cause) => failure('diagnostic UTF-8', '', cause),
        }).pipe(Effect.flatMap((text) => Console.error(text))),
      ),
    stdin: Stream.fail(unsupported('Stdio', 'stdin')),
  })

const output = (file: string) =>
  Sink.forEach((value: string | Uint8Array) =>
    Effect.gen(function* () {
      const text = yield* Effect.try({
        try: () => (typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value)),
        catch: (cause) => failure('capture UTF-8', file, cause),
      })
      let offset = 0
      while (offset < text.length) {
        let end = Math.min(offset + 65536, text.length)
        const last = text.charCodeAt(end - 1)
        if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1
        yield* append(file, text.slice(offset, end))
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
}

/** Capture files belong to the wrapper's private temporary directory, not terminal handles. */
export const capture = (options: CaptureOptions) =>
  make({
    args: Effect.succeed(options.args),
    stdoutIsTerminal: Effect.succeed(options.stdoutIsTerminal ?? false),
    stdout: () => output(options.stdout),
    stderr: () => output(options.stderr),
    stdin: options.stdin === undefined ? Stream.empty : Stream.fromEffect(fileSystem.readFile(options.stdin)),
  })

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const env = process.env
    const stdout = env['GLOSSSHIFT_BATCH_STDOUT']
    const stderr = env['GLOSSSHIFT_BATCH_STDERR']
    const encodedArgs = env['GLOSSSHIFT_BATCH_ARGS']
    if (stdout === undefined && stderr === undefined && encodedArgs === undefined) return unavailable([])
    if (
      stdout === undefined ||
      stderr === undefined ||
      encodedArgs === undefined ||
      !path.isAbsolute(stdout) ||
      !path.isAbsolute(stderr)
    ) {
      return yield* Effect.die(new Error('Incomplete NSH capture environment'))
    }
    const args = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(encodedArgs)
    const stdin = env['GLOSSSHIFT_BATCH_STDIN']
    if (stdin !== undefined && !path.isAbsolute(stdin))
      return yield* Effect.die(new Error('Capture stdin requires an absolute path'))
    const terminal = env['GLOSSSHIFT_BATCH_STDOUT_IS_TTY']
    if (terminal !== undefined && terminal !== '0' && terminal !== '1')
      return yield* Effect.die(new Error('Invalid explicit batch stdout terminal flag'))
    return capture({ args, stdout, stderr, stdin, stdoutIsTerminal: terminal === '1' })
  }).pipe(Effect.orDie),
)
