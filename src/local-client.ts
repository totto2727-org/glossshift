import { spawn } from 'process'

import { Cause, Effect, Option, Queue, Schema, Stream } from 'effect'

import type { TranslationEvent } from './domain'
import { ClientJson, MAX_FRAME_BYTES, ServerJson } from './local-protocol'
import type { ClientFrame, ServerFrame } from './local-protocol'
import type { Fault, TranslationRequest } from './ports'

export interface LocalRuntime {
  readonly command: string
  readonly entry: string
}
export interface LocalProcess {
  readonly stdout: (handler: (line: string) => void) => void
  readonly exited: (handler: () => void) => void
  readonly write: (line: string) => void
  readonly end: () => void
  readonly kill: () => void
}
export type LocalLauncher = (runtime: LocalRuntime) => LocalProcess
const launch: LocalLauncher = (runtime) => {
  const child = spawn(runtime.command, [runtime.entry, '--sidecar'], { stdin: 'pipe', lines: true })
  return {
    stdout: (handler) => {
      child.on('stdout', handler)
    },
    exited: (handler) => {
      child.on('exit', handler)
    },
    write: (line) => child.write(line),
    end: () => child.end(),
    kill: () => child.kill(),
  }
}
const fault = (message: string): Fault => ({ _tag: 'ActionRequired', message })
const invalid = fault('The local translation service returned invalid data.')
const unavailable = fault('The local translation service stopped. Please restart GlossShift.')
const encode = Schema.encodeSync(ClientJson)
const decode = Schema.decodeUnknownSync(ServerJson)
const size = (text: string) => new TextEncoder().encode(text).byteLength
let generation = 0

type Ready = Extract<ServerFrame, { readonly kind: 'ready' }>
type Event = Exclude<ServerFrame, { readonly kind: 'ready' | 'fatal' }>
type Active = {
  readonly wireId: string
  readonly id: TranslationRequest['id']
  readonly queue: Queue.Queue<Event, Fault>
  sequence: number
  pending: boolean
  terminal: boolean
}

/** Private child lifetime and callback quotas belong to the application scope. */
export const connectLocal = (runtime: LocalRuntime, launcher: LocalLauncher = launch) =>
  Effect.gen(function* () {
    const ready = yield* Queue.bounded<Ready, Fault>(1)
    const failures = yield* Queue.bounded<never, Fault>(1)
    const child = yield* Effect.acquireRelease(
      Effect.try({ try: () => launcher(runtime), catch: () => unavailable }),
      (process) =>
        Effect.try(() => process.end()).pipe(
          Effect.ignore,
          Effect.andThen(Effect.try(() => process.kill()).pipe(Effect.ignore)),
        ),
    )
    const prefix = `local-${++generation}`
    let requestNumber = 0
    let active = Option.none<Active>()
    let booted = false
    let stopped = false
    const stop = (error: Fault) => {
      if (stopped) return
      stopped = true
      Queue.failCauseUnsafe(ready, Cause.fail(error))
      Queue.failCauseUnsafe(failures, Cause.fail(error))
      if (Option.isSome(active)) Queue.failCauseUnsafe(active.value.queue, Cause.fail(error))
      child.kill()
    }
    const send = (frame: ClientFrame) =>
      Effect.try({
        try: () => {
          if (stopped) throw unavailable
          const line = `${encode(frame)}\n`
          if (size(line) >= MAX_FRAME_BYTES) throw invalid
          child.write(line)
        },
        catch: () => fault('The local translation request could not be sent. Check the input size and local model.'),
      })
    yield* Effect.sync(() => {
      child.exited(() => stop(unavailable))
      child.stdout((line) => {
        if (stopped) return
        try {
          if (size(line) >= MAX_FRAME_BYTES) return stop(invalid)
          const frame = decode(line)
          if (frame.kind === 'fatal') return stop(fault('The local model could not initialize. Check local settings.'))
          if (frame.kind === 'ready') {
            if (booted) return stop(invalid)
            booted = true
            if (!Queue.offerUnsafe(ready, frame)) stop(invalid)
            return
          }
          if (!booted) return stop(invalid)
          if (Option.isNone(active) || frame.requestId !== active.value.wireId) return
          const request = active.value
          if (request.terminal || frame.seq !== request.sequence + 1) return stop(invalid)
          if ((frame.seq === 1) !== (frame.kind === 'started')) return stop(invalid)
          if (request.pending && frame.kind !== 'failed') return stop(invalid)
          request.pending = frame.kind === 'started' || frame.kind === 'delta'
          request.sequence = frame.seq
          request.terminal = frame.kind === 'finished' || frame.kind === 'failed'
          if (!Queue.offerUnsafe(request.queue, frame)) stop(invalid)
        } catch {
          stop(invalid)
        }
      })
    })
    const settings = yield* Queue.take(ready).pipe(
      Effect.timeout('30 seconds'),
      Effect.mapError(() => fault('The local model service did not start. Check local settings.')),
    )
    const cancelWire = (wireId: string) => send({ version: 1, kind: 'cancel', requestId: wireId })
    const cancel = (id: TranslationRequest['id']) =>
      Effect.gen(function* () {
        if (Option.isNone(active) || active.value.id !== id) return
        const previous = active.value
        active = Option.none()
        yield* Queue.shutdown(previous.queue)
        yield* cancelWire(previous.wireId)
      })
    const translate = (request: TranslationRequest) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (Option.isSome(active)) {
            const previous = active.value
            active = Option.none()
            yield* Queue.shutdown(previous.queue)
            yield* cancelWire(previous.wireId)
          }
          const queue = yield* Queue.bounded<Event, Fault>(4)
          const wireId = `${prefix}:request-${++requestNumber}`
          active = Option.some({ wireId, id: request.id, queue, sequence: 0, pending: false, terminal: false })
          yield* send({
            version: 1,
            kind: 'translate',
            requestId: wireId,
            text: request.text,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
          })
          let ack = Option.none<number>()
          return Stream.fromEffectRepeat(
            Effect.gen(function* () {
              if (Option.isSome(ack)) {
                if (Option.isSome(active) && active.value.queue === queue) active.value.pending = false
                yield* send({ version: 1, kind: 'ack', requestId: wireId, seq: ack.value })
                ack = Option.none()
              }
              const event = yield* Queue.take(queue)
              if (event.kind === 'delta' || event.kind === 'started') ack = Option.some(event.seq)
              return event
            }),
          ).pipe(
            Stream.takeUntil((event) => event.kind === 'finished' || event.kind === 'failed'),
            Stream.map((event): TranslationEvent => {
              switch (event.kind) {
                case 'started':
                  return { _tag: 'Started', id: request.id, sourceText: request.text }
                case 'delta':
                  return { _tag: 'Delta', id: request.id, text: event.text }
                case 'finished':
                  return { _tag: 'Finished', id: request.id }
                case 'failed':
                  return {
                    _tag: 'Failed',
                    id: request.id,
                    message: 'Local translation failed. Check the model and local settings.',
                  }
              }
            }),
            Stream.ensuring(
              Effect.gen(function* () {
                if (Option.isSome(active) && active.value.queue === queue) {
                  const terminal = active.value.terminal
                  active = Option.none()
                  if (!terminal && !stopped) yield* cancelWire(wireId).pipe(Effect.ignore)
                }
                yield* Queue.shutdown(queue)
              }),
            ),
          )
        }),
      )
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        stopped = true
      }),
    )
    return { settings, translate, cancel, failures: Stream.fromQueue(failures) }
  })

export type LocalClient = Effect.Success<ReturnType<typeof connectLocal>>
