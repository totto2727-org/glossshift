import { Deferred, Effect, Fiber, Option, Queue, Schema, Stream } from 'effect'
import { expect, open, test } from 'nsh/test'

import { RequestId } from './domain'
import { connectLocal } from './local-client'
import { localFixture } from './local-client.fixture'

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))
test('official NSH process pipes carry acknowledged NDJSON without network or native translation', async () => {
  const app = await open('./src/local-process.fixture/App.tsx', { platform: 'macos' })
  await app.waitFor('Complete: local process translated')
  expect(app.requests()).toEqual([])
  app.dispose()
})

const request = (id: string) => ({
  id: Schema.decodeUnknownSync(RequestId)(id),
  text: 'source',
  sourceLanguage: 'auto',
  targetLanguage: 'ja',
})
const runtime = { command: 'fixture', entry: '/fixture/main.ts' }

test('local transport kills its child even when closing stdin throws', async () => {
  let killed = false
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        yield* connectLocal(runtime, (input) => ({
          ...f.launcher(input),
          end: () => {
            throw new Error('stdin already closed')
          },
          kill: () => {
            killed = true
          },
        }))
      }),
    ),
  )
  expect(killed).toBe(true)
})

test('local transport acknowledges only consumed frames and preserves ordered text', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const client = yield* connectLocal(runtime, f.launcher)
        const held = yield* Deferred.make<void>()
        const seen = yield* Queue.bounded<string>(4)
        const consumer = yield* client.translate(request('one')).pipe(
          Stream.runForEach((event) =>
            event._tag === 'Delta'
              ? Queue.offer(seen, event.text).pipe(Effect.andThen(Deferred.await(held)))
              : Effect.void,
          ),
          Effect.forkScoped,
        )
        const command = yield* Queue.take(f.written)
        if (command.kind !== 'translate') return yield* Effect.die('Expected translate')
        f.emit({ version: 1, kind: 'started', requestId: command.requestId, seq: 1, text: 'source' })
        expect(yield* Queue.take(f.written)).toEqual({ version: 1, kind: 'ack', requestId: command.requestId, seq: 1 })
        f.emit({ version: 1, kind: 'delta', requestId: command.requestId, seq: 2, text: 'translated' })
        expect(yield* Queue.take(seen)).toBe('translated')
        expect(Option.isNone(yield* Queue.poll(f.written))).toBe(true)
        yield* Deferred.succeed(held, undefined)
        expect(yield* Queue.take(f.written)).toEqual({ version: 1, kind: 'ack', requestId: command.requestId, seq: 2 })
        f.emit({ version: 1, kind: 'finished', requestId: command.requestId, seq: 3 })
        yield* Fiber.join(consumer)
      }),
    ),
  )
})

test('local transport cancellation bypasses blocked consumption and rejects stale frames', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const client = yield* connectLocal(runtime, f.launcher)
        const first = yield* client.translate(request('one')).pipe(Stream.runDrain, Effect.forkScoped)
        const old = yield* Queue.take(f.written)
        if (old.kind !== 'translate') return yield* Effect.die('Expected translate')
        yield* Fiber.interrupt(first)
        expect((yield* Queue.take(f.written)).kind).toBe('cancel')
        const second = yield* client.translate(request('two')).pipe(Stream.runCollect, Effect.forkScoped)
        const fresh = yield* Queue.take(f.written)
        if (fresh.kind !== 'translate') return yield* Effect.die('Expected replacement')
        f.emit({ version: 1, kind: 'delta', requestId: old.requestId, seq: 99, text: 'stale' })
        f.emit({ version: 1, kind: 'started', requestId: fresh.requestId, seq: 1, text: 'source' })
        yield* Queue.take(f.written)
        f.emit({ version: 1, kind: 'delta', requestId: fresh.requestId, seq: 2, text: 'fresh' })
        yield* Queue.take(f.written)
        f.emit({ version: 1, kind: 'finished', requestId: fresh.requestId, seq: 3 })
        const output = yield* Fiber.join(second)
        expect(output).toEqual([
          { _tag: 'Started', id: request('two').id, sourceText: 'source' },
          { _tag: 'Delta', id: request('two').id, text: 'fresh' },
          { _tag: 'Finished', id: request('two').id },
        ])
      }),
    ),
  )
})

test('local transport malformed output fails safely and kills the child', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const client = yield* connectLocal(runtime, f.launcher)
        const failure = yield* client.failures.pipe(Stream.runDrain, Effect.flip, Effect.forkScoped)
        f.raw('SECRET broken JSON')
        expect((yield* Fiber.join(failure)).message).toBe('The local translation service returned invalid data.')
        expect(yield* Queue.take(f.lifecycle)).toBe('kill')
      }),
    ),
  )
})

test('local transport rejects sequence gaps with a public failure', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const client = yield* connectLocal(runtime, f.launcher)
        const consumer = yield* client.translate(request('gap')).pipe(Stream.runDrain, Effect.flip, Effect.forkScoped)
        const command = yield* Queue.take(f.written)
        if (command.kind !== 'translate') return yield* Effect.die('Expected translate')
        f.emit({ version: 1, kind: 'delta', requestId: command.requestId, seq: 2, text: 'secret' })
        expect((yield* Fiber.join(consumer)).message).toBe('The local translation service returned invalid data.')
      }),
    ),
  )
})

test('local transport does not expose child-provided failure details', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const client = yield* connectLocal(runtime, f.launcher)
        const consumer = yield* client.translate(request('failure')).pipe(Stream.runCollect, Effect.forkScoped)
        const frame = yield* Queue.take(f.written)
        if (frame.kind !== 'translate') return yield* Effect.die('Expected translate')
        f.emit({ version: 1, kind: 'started', requestId: frame.requestId, seq: 1, text: 'source' })
        yield* Queue.take(f.written)
        f.emit({ version: 1, kind: 'failed', requestId: frame.requestId, seq: 2, message: 'SECRET internal file path' })
        expect(yield* Fiber.join(consumer)).toEqual([
          { _tag: 'Started', id: request('failure').id, sourceText: 'source' },
          {
            _tag: 'Failed',
            id: request('failure').id,
            message: 'Local translation failed. Check the model and local settings.',
          },
        ])
      }),
    ),
  )
})

test('local transport kills a child that sends data before its previous frame is acknowledged', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* localFixture
        const client = yield* connectLocal(runtime, f.launcher)
        const failure = yield* client.failures.pipe(Stream.runDrain, Effect.flip, Effect.forkScoped)
        yield* client.translate(request('overflow')).pipe(
          Stream.runForEach(() => Effect.never),
          Effect.forkScoped,
        )
        const frame = yield* Queue.take(f.written)
        if (frame.kind !== 'translate') return yield* Effect.die('Expected translate')
        f.emit({ version: 1, kind: 'started', requestId: frame.requestId, seq: 1, text: 'source' })
        f.emit({ version: 1, kind: 'delta', requestId: frame.requestId, seq: 2, text: 'uncredited' })
        expect((yield* Fiber.join(failure)).message).toBe('The local translation service returned invalid data.')
        expect(yield* Queue.take(f.lifecycle)).toBe('kill')
      }),
    ),
  )
})
