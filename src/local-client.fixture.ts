import { Effect, Option, Queue, Schema } from 'effect'

import type { LocalLauncher, LocalProcess } from './local-client'
import { ClientJson, ServerJson } from './local-protocol'
import type { ServerFrame } from './local-protocol'

/** Synthetic process boundary, with the production JSON schemas on both pipes. */
export const localFixture = Effect.gen(function* () {
  const written = yield* Queue.bounded<ReturnType<typeof decode>>(32)
  const lifecycle = yield* Queue.bounded<string>(16)
  let output = Option.none<(line: string) => void>()
  let exit = Option.none<() => void>()
  const emit = (frame: ServerFrame) => {
    if (Option.isSome(output)) output.value(encode(frame))
  }
  const process: LocalProcess = {
    stdout: (handler) => {
      output = Option.some(handler)
      emit({ version: 1, kind: 'ready', sourceLanguage: 'auto', model: 'synthetic-local' })
    },
    exited: (handler) => {
      exit = Option.some(handler)
    },
    write: (line) => {
      if (!Queue.offerUnsafe(written, decode(line))) throw new Error('Fixture input quota')
    },
    end: () => {
      Queue.offerUnsafe(lifecycle, 'end')
    },
    kill: () => {
      Queue.offerUnsafe(lifecycle, 'kill')
    },
  }
  const launcher: LocalLauncher = () => process
  return {
    launcher,
    written,
    lifecycle,
    emit,
    raw: (line: string) => {
      if (Option.isSome(output)) output.value(line)
    },
    exit: () => {
      if (Option.isSome(exit)) exit.value()
    },
  }
})
const decode = Schema.decodeUnknownSync(ClientJson)
const encode = Schema.encodeSync(ServerJson)
