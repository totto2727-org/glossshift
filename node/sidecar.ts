import { Buffer } from 'node:buffer'
import process from 'node:process'
import { createInterface } from 'node:readline'

import { Data, Deferred, Effect, Fiber, Option, Queue, Schema, Stream, String } from 'effect'

import { ClientJson, MAX_FRAME_BYTES, ServerJson } from '../src/local-protocol.ts'
import type { ClientFrame, ServerFrame } from '../src/local-protocol.ts'
import { Translation, TranslationLive } from './translation.ts'

class SidecarError extends Data.TaggedError('SidecarError')<{ readonly message: string }> {}
const ioError = () => new SidecarError({ message: 'The local translation process connection failed.' })

const write = (frame: ServerFrame) =>
  Effect.gen(function* () {
    const json = yield* Schema.encodeEffect(ServerJson)(frame).pipe(Effect.mapError(ioError))
    if (Buffer.byteLength(json, 'utf8') >= MAX_FRAME_BYTES) return yield* Effect.fail(ioError())
    yield* Effect.callback<void, SidecarError>((resume) => {
      process.stdout.write(`${json}\n`, (error?: Error | null) => resume(error ? Effect.fail(ioError()) : Effect.void))
    })
  })

interface Active {
  readonly id: string
  readonly fiber: Fiber.Fiber<void>
  readonly acknowledgements: Queue.Queue<void>
  pendingSequence: Option.Option<number>
}

type Translate = Extract<ClientFrame, { readonly kind: 'translate' }>

/** Private NDJSON stdio, with one acknowledged frame in flight and independent cancellation. */
const serve = Effect.gen(function* () {
  const translation = yield* Translation
  const failed = yield* Deferred.make<never, SidecarError>()
  const input = yield* Effect.acquireRelease(
    Effect.sync(() => createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })),
    (lines) => Effect.sync(() => lines.close()),
  )
  let active = Option.none<Active>()
  const stop = Effect.suspend(() => {
    if (Option.isNone(active)) return Effect.void
    const previous = active.value
    active = Option.none()
    return Fiber.interrupt(previous.fiber).pipe(Effect.andThen(Queue.shutdown(previous.acknowledgements)))
  })
  yield* Effect.addFinalizer(() => stop)

  const start = (request: Translate) =>
    Effect.gen(function* () {
      yield* stop
      const acknowledgements = yield* Queue.bounded<void>(1)
      let sequence = 0
      const state: { pendingSequence: Option.Option<number> } = { pendingSequence: Option.none() }
      const frame = (kind: 'started' | 'delta', text: string) =>
        Effect.gen(function* () {
          sequence += 1
          state.pendingSequence = Option.some(sequence)
          yield* write({ version: 1, kind, requestId: request.requestId, seq: sequence, text })
          yield* Queue.take(acknowledgements)
        })
      const run = Effect.gen(function* () {
        yield* frame('started', request.text)
        yield* translation
          .stream({
            text: request.text,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
          })
          .pipe(
            Stream.runForEach((text) => frame('delta', text)),
            Effect.andThen(() =>
              write({ version: 1, kind: 'finished', requestId: request.requestId, seq: ++sequence }),
            ),
            Effect.catchTag('TranslationError', (error) =>
              write({
                version: 1,
                kind: 'failed',
                requestId: request.requestId,
                seq: ++sequence,
                message: error.message,
              }),
            ),
          )
      })
      const fiber = yield* Effect.forkScoped(
        run.pipe(
          Effect.catchTag('SidecarError', (error) => Deferred.fail(failed, error)),
          Effect.asVoid,
        ),
      )
      active = Option.some({
        id: request.requestId,
        fiber,
        acknowledgements,
        get pendingSequence() {
          return state.pendingSequence
        },
        set pendingSequence(value) {
          state.pendingSequence = value
        },
      })
    })

  yield* write({ version: 1, kind: 'ready', ...translation.settings })
  yield* Stream.fromAsyncIterable(input, ioError).pipe(
    Stream.runForEach((line) =>
      Effect.gen(function* () {
        if (String.isEmpty(line)) return
        if (Buffer.byteLength(line, 'utf8') >= MAX_FRAME_BYTES) return yield* Effect.fail(ioError())
        const message = yield* Schema.decodeUnknownEffect(ClientJson)(line).pipe(Effect.mapError(ioError))
        switch (message.kind) {
          case 'translate':
            return yield* start(message)
          case 'cancel':
            if (Option.isSome(active) && active.value.id === message.requestId) yield* stop
            return
          case 'ack':
            if (
              Option.isSome(active) &&
              active.value.id === message.requestId &&
              Option.isSome(active.value.pendingSequence) &&
              active.value.pendingSequence.value === message.seq
            ) {
              active.value.pendingSequence = Option.none()
              yield* Queue.offer(active.value.acknowledgements, undefined)
            }
            return
        }
      }),
    ),
    Effect.raceFirst(Deferred.await(failed)),
  )
})

export const runSidecar = Effect.scoped(serve).pipe(
  Effect.provide(TranslationLive),
  Effect.catchTag('TranslationError', (error) => write({ version: 1, kind: 'fatal', message: error.message })),
  Effect.catchTag('SidecarError', () =>
    write({ version: 1, kind: 'fatal', message: 'The local translation process connection failed.' }),
  ),
)
