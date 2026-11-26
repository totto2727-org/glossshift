import { Array, Effect, Result } from 'effect'
import { expect, test } from 'nsh/test'

import { FaultSchema } from './ports.ts'
import type { SelectionRunner } from './selection-client.ts'
import { createSelectionClient, readSelectionClient } from './selection-client.ts'

// oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const response =
  (value: unknown, code = 0): SelectionRunner =>
  () =>
    Effect.succeed({ code, stdout: JSON.stringify(value) })

const selectedFixtureText = '  # Synthetic 日本語\n<literal>\n'
const helperReplies = {
  '--permission': { granted: false, kind: 'permission', schemaVersion: 1 },
  '--selection': { kind: 'selection', schemaVersion: 1, text: selectedFixtureText },
}

const recordHelper =
  (calls: string[]): SelectionRunner =>
  (command, argument) => {
    calls.push(`${command}:${argument}`)
    return Effect.succeed({ code: 0, stdout: JSON.stringify(helperReplies[argument]) })
  }

test('separate selection helper preserves raw text and validates permission replies', async () => {
  const argumentsSeen: string[] = []
  const client = createSelectionClient('/immutable/helper', recordHelper(argumentsSeen))
  expect(await run(client.permission)).toBe(false)
  expect(await run(client.capture)).toBe(selectedFixtureText)
  expect(argumentsSeen).toEqual(['/immutable/helper:--permission', '/immutable/helper:--selection'])
})

test('helper errors project known public messages and never reflect untrusted diagnostics', async () => {
  const denied = createSelectionClient(
    '/helper',
    response({ code: 'permission-required', kind: 'error', message: 'private details', schemaVersion: 1 }, 1),
  )
  expect(await run(Effect.flip(denied.capture))).toEqual(
    FaultSchema.make({
      message: 'Enable Accessibility access for GlossShift in System Settings.',
    }),
  )
  const unknown = createSelectionClient(
    '/helper',
    response({ code: 'private code', kind: 'error', message: 'private selected text', schemaVersion: 1 }, 1),
  )
  expect(await run(Effect.flip(unknown.capture))).toEqual(
    FaultSchema.make({
      message: 'Selection capture failed. Select text again.',
    }),
  )
})

const badJson: SelectionRunner = () => Effect.succeed({ code: 0, stdout: 'not JSON' })

test('helper boundary rejects wrong shapes, versions, status, oversized and empty selections', async () => {
  const invalid = [
    { kind: 'selection', schemaVersion: 2, text: 'synthetic' },
    { granted: true, kind: 'permission', schemaVersion: 1 },
    { kind: 'selection', schemaVersion: 1, text: ' \n\t' },
    { kind: 'selection', schemaVersion: 1, text: 'x'.repeat(1_048_577) },
    { kind: 'selection', schemaVersion: 1, text: 42 },
  ]
  const malformed = Array.map(invalid, (value) => response(value))
  const badStatus = response({ kind: 'selection', schemaVersion: 1, text: 'synthetic' }, 1)
  const options = [...malformed, badStatus, badJson]
  const outcomes = await run(
    Effect.forEach(options, (runner) => {
      const client = createSelectionClient('/helper', runner)
      return Effect.result(client.capture)
    }),
  )
  expect(Array.map(outcomes, Result.isFailure)).toEqual(Array.replicate(true, options.length))
})

const configuredHelper = (value: string | undefined): ReturnType<typeof readSelectionClient> =>
  readSelectionClient({ GLOSSSHIFT_MACOS_HELPER: value })

test('selection executable permits only an absolute path or the exact granted development helper', async () => {
  const invalid = [undefined, 'helper', './helper', '/bad\0helper']
  const qualified = ['glossshift-macos-helper', '/immutable/helper']
  const rejected = await run(Effect.forEach(invalid, (value) => Effect.result(configuredHelper(value))))
  const accepted = await run(Effect.forEach(qualified, (value) => Effect.result(configuredHelper(value))))
  expect(Array.map(rejected, Result.isFailure)).toEqual(Array.replicate(true, invalid.length))
  expect(Array.map(accepted, Result.isSuccess)).toEqual(Array.replicate(true, qualified.length))
})
