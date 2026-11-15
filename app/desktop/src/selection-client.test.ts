import { Effect, Result } from 'effect'
import { expect, test } from 'nsh/test'

import { createSelectionClient, readSelectionClient } from './selection-client'
import type { SelectionRunner } from './selection-client'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const response =
  (value: unknown, code = 0): SelectionRunner =>
  () =>
    Effect.succeed({ code, stdout: JSON.stringify(value) })

test('separate selection helper preserves raw text and validates permission replies', async () => {
  const argumentsSeen: string[] = []
  const client = createSelectionClient('/immutable/helper', (command, argument) => {
    argumentsSeen.push(`${command}:${argument}`)
    return response(
      argument === '--permission'
        ? { schemaVersion: 1, kind: 'permission', granted: false }
        : { schemaVersion: 1, kind: 'selection', text: '  # Synthetic 日本語\n<literal>\n' },
    )(command, argument)
  })
  expect(await run(client.permission)).toBe(false)
  expect(await run(client.capture)).toBe('  # Synthetic 日本語\n<literal>\n')
  expect(argumentsSeen).toEqual(['/immutable/helper:--permission', '/immutable/helper:--selection'])
})

test('helper errors project known public messages and never reflect untrusted diagnostics', async () => {
  const denied = createSelectionClient(
    '/helper',
    response({ schemaVersion: 1, kind: 'error', code: 'permission-required', message: 'private details' }, 1),
  )
  expect(await run(Effect.flip(denied.capture))).toEqual({
    _tag: 'ActionRequired',
    message: 'Enable Accessibility access for GlossShift in System Settings.',
  })
  const unknown = createSelectionClient(
    '/helper',
    response({ schemaVersion: 1, kind: 'error', code: 'private code', message: 'private selected text' }, 1),
  )
  expect(await run(Effect.flip(unknown.capture))).toEqual({
    _tag: 'ActionRequired',
    message: 'Selection capture failed. Select text again.',
  })
})

test('helper boundary rejects wrong shapes, versions, status, oversized and empty selections', async () => {
  for (const value of [
    { schemaVersion: 2, kind: 'selection', text: 'synthetic' },
    { schemaVersion: 1, kind: 'permission', granted: true },
    { schemaVersion: 1, kind: 'selection', text: ' \n\t' },
    { schemaVersion: 1, kind: 'selection', text: 'x'.repeat(1_048_577) },
    { schemaVersion: 1, kind: 'selection', text: 42 },
  ])
    expect(Result.isFailure(await run(Effect.result(createSelectionClient('/helper', response(value)).capture)))).toBe(
      true,
    )
  expect(
    Result.isFailure(
      await run(
        Effect.result(
          createSelectionClient('/helper', response({ schemaVersion: 1, kind: 'selection', text: 'synthetic' }, 1))
            .capture,
        ),
      ),
    ),
  ).toBe(true)
  expect(
    Result.isFailure(
      await run(
        Effect.result(createSelectionClient('/helper', () => Effect.succeed({ code: 0, stdout: 'not JSON' })).capture),
      ),
    ),
  ).toBe(true)
})

test('selection executable permits only an absolute path or the exact granted development helper', async () => {
  for (const value of [undefined, 'helper', './helper', '/bad\0helper']) {
    expect(Result.isFailure(await run(Effect.result(readSelectionClient({ GLOSSSHIFT_MACOS_HELPER: value }))))).toBe(
      true,
    )
  }
  expect(
    Result.isSuccess(
      await run(Effect.result(readSelectionClient({ GLOSSSHIFT_MACOS_HELPER: 'glossshift-macos-helper' }))),
    ),
  ).toBe(true)
  expect(
    Result.isSuccess(await run(Effect.result(readSelectionClient({ GLOSSSHIFT_MACOS_HELPER: '/immutable/helper' })))),
  ).toBe(true)
})
