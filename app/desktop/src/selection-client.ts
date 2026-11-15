import process, { spawn } from 'process'

import { Effect, Schema } from 'effect'

import type { Fault } from './ports'

const AbsolutePath = Schema.String.check(Schema.isPattern(/^\/[^\0]+$/u))
const HelperCommand = Schema.Union([AbsolutePath, Schema.Literal('glossshift-macos-helper')])
const Permission = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal('permission'),
  granted: Schema.Boolean,
})
const Selection = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal('selection'),
  text: Schema.String,
})
const Failure = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal('error'),
  code: Schema.String,
})
const Response = Schema.fromJsonString(Schema.Union([Permission, Selection, Failure]))
const fault = (message: string): Fault => ({ _tag: 'ActionRequired', message })
const unavailable = () => fault('Selection capture is unavailable. Start GlossShift with its installed launcher.')
const invalid = () => fault('The selection helper returned invalid data.')
const failureMessage = (code: string) => {
  switch (code) {
    case 'permission-required':
      return 'Enable Accessibility access for GlossShift in System Settings.'
    case 'selection-unavailable':
      return 'The focused application does not expose selected text.'
    case 'no-selection':
      return 'No text is selected.'
    case 'selection-too-large':
      return 'The selected text is too large.'
    default:
      return 'Selection capture failed. Select text again.'
  }
}

export type SelectionCommand = '--permission' | '--selection'
export type SelectionRunner = (
  command: string,
  argument: SelectionCommand,
) => Effect.Effect<
  {
    readonly code: number | null
    readonly stdout: string
  },
  Fault
>
const execute: SelectionRunner = (command, argument) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* Effect.acquireRelease(
        Effect.try({ try: () => spawn(command, [argument], { timeoutMs: 2_000 }), catch: unavailable }),
        (child) => Effect.try(() => child.kill()).pipe(Effect.ignore),
      )
      return yield* Effect.callback<{ readonly code: number | null; readonly stdout: string }, Fault>((resume) => {
        let stdout = ''
        let bytes = 0
        child.on('stdout', (chunk) => {
          bytes += new TextEncoder().encode(chunk).byteLength
          if (bytes > 6_400_000) {
            resume(Effect.fail(invalid()))
            child.kill()
          } else stdout += chunk
        })
        child.on('exit', (result) =>
          resume(
            result.error == null ? Effect.succeed({ code: result.code ?? null, stdout }) : Effect.fail(unavailable()),
          ),
        )
      })
    }),
  )

/** Accessibility is queried only by a separate, bounded, one-shot executable. */
export const createSelectionClient = (command: string, runner: SelectionRunner = execute) => {
  const request = (argument: SelectionCommand) =>
    Effect.gen(function* () {
      const output = yield* runner(command, argument)
      if (new TextEncoder().encode(output.stdout).byteLength > 6_400_000) return yield* Effect.fail(invalid())
      const response = yield* Schema.decodeUnknownEffect(Response)(output.stdout).pipe(Effect.mapError(invalid))
      if (response.kind === 'error') {
        return yield* Effect.fail(fault(failureMessage(response.code)))
      }
      if (output.code !== 0) return yield* Effect.fail(invalid())
      return response
    })
  return {
    permission: request('--permission').pipe(
      Effect.flatMap((response) =>
        response.kind === 'permission' ? Effect.succeed(response.granted) : Effect.fail(invalid()),
      ),
    ),
    capture: request('--selection').pipe(
      Effect.flatMap((response) => {
        if (response.kind !== 'selection') return Effect.fail(invalid())
        if (new TextEncoder().encode(response.text).byteLength > 1_048_576 || /^\s*$/u.test(response.text))
          return Effect.fail(invalid())
        return Effect.succeed(response.text)
      }),
    ),
  }
}

export const readSelectionClient = (environment: Readonly<Record<string, unknown>> = process.env) =>
  Schema.decodeUnknownEffect(HelperCommand)(environment['GLOSSSHIFT_MACOS_HELPER']).pipe(
    Effect.mapError(unavailable),
    Effect.map((command) => createSelectionClient(command)),
  )
