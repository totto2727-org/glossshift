// oxlint-disable-next-line unicorn/prefer-node-protocol -- The official NSH 0.5 host resolves this built-in only through its unprefixed name.
import process, { spawn } from 'process'

import { Effect, MutableRef, Predicate, Schema } from 'effect'

import { FaultSchema } from './ports.ts'
import type { Fault } from './ports.ts'

const protocolVersion = 1
const helperTimeoutMs = 2000
const successfulExitCode = 0
const initialResponseBytes = 0
const maxHelperResponseBytes = 6_400_000
const maxSelectionBytes = 1_048_576
const utf8 = new TextEncoder()

const AbsolutePath = Schema.String.check(Schema.isPattern(/^\/[^\0]+$/u))
const HelperCommand = Schema.Union([AbsolutePath, Schema.Literal('glossshift-macos-helper')])
// oxlint-disable-next-line rules/prefer-non-unknown-decode -- The process environment supplies an unvalidated value.
const decodeHelperCommand = Schema.decodeUnknownEffect(HelperCommand)
const Permission = Schema.Struct({
  granted: Schema.Boolean,
  kind: Schema.Literal('permission'),
  schemaVersion: Schema.Literal(protocolVersion),
})
const Selection = Schema.Struct({
  kind: Schema.Literal('selection'),
  schemaVersion: Schema.Literal(protocolVersion),
  text: Schema.String,
})
const Failure = Schema.Struct({
  code: Schema.String,
  kind: Schema.Literal('error'),
  schemaVersion: Schema.Literal(protocolVersion),
})
const Response = Schema.fromJsonString(Schema.Union([Permission, Selection, Failure]))
const decodeHelperResponse = Schema.decodeEffect(Response)
const fault = (message: string): Fault => FaultSchema.make({ message })
const unavailable = (): Fault =>
  fault('Selection capture is unavailable. Start GlossShift with its installed launcher.')
const invalid = (): Fault => fault('The selection helper returned invalid data.')
const failureMessage = (code: string): string => {
  switch (code) {
    case 'permission-required': {
      return 'Enable Accessibility access for GlossShift in System Settings.'
    }
    case 'selection-unavailable': {
      return 'The focused application does not expose selected text.'
    }
    case 'no-selection': {
      return 'No text is selected.'
    }
    case 'selection-too-large': {
      return 'The selected text is too large.'
    }
    default: {
      return 'Selection capture failed. Select text again.'
    }
  }
}

export type SelectionCommand = '--permission' | '--selection'
export type SelectionRunner = (
  command: string,
  argument: SelectionCommand,
) => Effect.Effect<
  Readonly<{
    code: number | null
    stdout: string
  }>,
  Fault
>
const execute: SelectionRunner = (command, argument) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* Effect.acquireRelease(
        Effect.try({ catch: unavailable, try: () => spawn(command, [argument], { timeoutMs: helperTimeoutMs }) }),
        (handle) => Effect.try(() => handle.kill()).pipe(Effect.ignore),
      )
      return yield* Effect.callback<Readonly<{ code: number | null; stdout: string }>, Fault>((resume) => {
        const stdout = MutableRef.make('')
        const bytes = MutableRef.make(initialResponseBytes)
        child.on('stdout', (chunk) => {
          const chunkBytes = utf8.encode(chunk).byteLength
          const total = MutableRef.updateAndGet(bytes, (current) => current + chunkBytes)
          if (total > maxHelperResponseBytes) {
            resume(Effect.fail(invalid()))
            child.kill()
          } else {
            MutableRef.update(stdout, (current) => current + chunk)
          }
        })
        child.on('exit', (result) => {
          // oxlint-disable-next-line unicorn/no-null -- The selection runner uses NSH's null exit-code sentinel for an absent status.
          const code = result.code ?? null
          const text = MutableRef.get(stdout)
          resume(
            Predicate.isNullish(result.error) ? Effect.succeed({ code, stdout: text }) : Effect.fail(unavailable()),
          )
        })
      })
    }),
  )

/** Accessibility is queried only by a separate, bounded, one-shot executable. */
type SelectionClient = Readonly<{ capture: Effect.Effect<string, Fault>; permission: Effect.Effect<boolean, Fault> }>

export const createSelectionClient = (command: string, runner: SelectionRunner = execute): SelectionClient => {
  const request = (argument: SelectionCommand): Effect.Effect<typeof Permission.Type | typeof Selection.Type, Fault> =>
    Effect.gen(function* () {
      const output = yield* runner(command, argument)
      if (utf8.encode(output.stdout).byteLength > maxHelperResponseBytes) {
        return yield* Effect.fail(invalid())
      }
      const response = yield* decodeHelperResponse(output.stdout).pipe(Effect.mapError(invalid))
      if (response.kind === 'error') {
        return yield* Effect.fail(fault(failureMessage(response.code)))
      }
      if (output.code !== successfulExitCode) {
        return yield* Effect.fail(invalid())
      }
      return response
    })
  return {
    capture: request('--selection').pipe(
      Effect.flatMap((response) => {
        if (response.kind !== 'selection') {
          return Effect.fail(invalid())
        }
        if (utf8.encode(response.text).byteLength > maxSelectionBytes || /^\s*$/u.test(response.text)) {
          return Effect.fail(invalid())
        }
        return Effect.succeed(response.text)
      }),
    ),
    permission: request('--permission').pipe(
      Effect.flatMap((response) =>
        response.kind === 'permission' ? Effect.succeed(response.granted) : Effect.fail(invalid()),
      ),
    ),
  }
}

export const readSelectionClient = (
  environment: Readonly<Record<string, unknown>> = process.env,
): Effect.Effect<SelectionClient, Fault> =>
  decodeHelperCommand(environment['GLOSSSHIFT_MACOS_HELPER']).pipe(
    Effect.mapError(unavailable),
    Effect.map((command) => createSelectionClient(command)),
  )
