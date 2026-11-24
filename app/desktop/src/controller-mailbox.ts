import { Effect, Option, Queue, Ref } from 'effect'

import { ControllerMessages } from './domain.ts'
import type { ControllerMessage } from './domain.ts'

const controlCapacity = 16
const eventCapacity = 256
const latestCapacity = 1

const makeQueues = Effect.gen(function* () {
  const controls = yield* Queue.bounded<ControllerMessage>(controlCapacity)
  const events = yield* Queue.bounded<ControllerMessage>(eventCapacity)
  const urgent = yield* Queue.sliding<ControllerMessage>(latestCapacity)
  const cancellation = yield* Ref.make(false)
  const wake = yield* Queue.sliding<true>(latestCapacity)
  return { cancellation, controls, events, urgent, wake }
})

type Queues = Effect.Success<typeof makeQueues>

type Send = (message: ControllerMessage) => Effect.Effect<void>

export interface ControllerMailboxes {
  awaitMessage: Effect.Effect<void>
  cancel: Effect.Effect<void>
  clearEvents: Effect.Effect<void>
  emit: Send
  notify: Send
  poll: Effect.Effect<Option.Option<ControllerMessage>>
  send: Send
  shutdown: Effect.Effect<void>
}

const sendCommands = ({
  controls,
  events,
  urgent,
  wake,
}: Queues): Pick<ControllerMailboxes, 'emit' | 'notify' | 'send'> => {
  const signal = Effect.sync(() => {
    Queue.offerUnsafe(wake, true)
  })
  const notify: Send = (message) =>
    Effect.sync(() => {
      Queue.offerUnsafe(urgent, message)
      Queue.offerUnsafe(wake, true)
    })
  const send: Send = (message) =>
    Effect.gen(function* () {
      const accepted = yield* Effect.sync(() => Queue.offerUnsafe(controls, message))
      if (!accepted) {
        yield* Queue.clear(controls)
        yield* notify(
          ControllerMessages.ActionFailed({ message: 'The translation queue is busy. Try the shortcut again.' }),
        )
      }
      yield* signal
    })
  const emit: Send = (message) => Queue.offer(events, message).pipe(Effect.andThen(signal))
  return { emit, notify, send }
}

const nextCommand = ({ cancellation, controls, events, urgent }: Queues): ControllerMailboxes['poll'] =>
  Effect.gen(function* () {
    if (yield* Ref.getAndSet(cancellation, false)) {
      return Option.some(ControllerMessages.Cancel())
    }
    const priority = yield* Queue.poll(urgent)
    if (Option.isSome(priority)) {
      return priority
    }
    const control = yield* Queue.poll(controls)
    return Option.isSome(control) ? control : yield* Queue.poll(events)
  })

const clearPending = ({ cancellation, controls, wake }: Queues): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Ref.set(cancellation, true)
    yield* Queue.clear(controls)
    yield* Effect.sync(() => {
      Queue.offerUnsafe(wake, true)
    })
  })

const closeQueues = ({ controls, events, urgent, wake }: Queues): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Queue.shutdown(controls)
    yield* Queue.shutdown(events)
    yield* Queue.shutdown(urgent)
    yield* Queue.shutdown(wake)
  })

export const makeMailboxes: Effect.Effect<ControllerMailboxes> = Effect.map(makeQueues, (queues) => ({
  ...sendCommands(queues),
  awaitMessage: Queue.take(queues.wake).pipe(Effect.asVoid),
  cancel: clearPending(queues),
  clearEvents: Queue.clear(queues.events).pipe(Effect.asVoid),
  poll: nextCommand(queues),
  shutdown: closeQueues(queues),
}))
