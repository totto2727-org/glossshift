import { spawn } from 'process'

import { Effect, Fiber, Schema, Stream } from 'effect'
import { cleanup, mount, signal, Text } from 'nsh'

import { RequestId } from '../domain'
import { connectLocal } from '../local-client'
import type { LocalLauncher } from '../local-client'

const provider = `
const {createInterface} = require('node:readline');
const send = (frame) => process.stdout.write(JSON.stringify({version:1,...frame})+'\\n');
let active;
send({kind:'ready',sourceLanguage:'auto',model:'synthetic-process'});
createInterface({input:process.stdin}).on('line', (line) => {
 const frame = JSON.parse(line);
 if (frame.kind === 'translate') {
  active = frame.requestId;
  send({kind:'started',requestId:active,seq:1,text:frame.text});
 } else if (frame.kind === 'ack' && frame.requestId === active) {
  if (frame.seq === 1) send({kind:'delta',requestId:active,seq:2,text:'local process translated'});
  else if (frame.seq === 2) send({kind:'finished',requestId:active,seq:3});
 } else if (frame.kind === 'cancel') active = undefined;
}).on('close', () => process.exit(0));
`
const launcher: LocalLauncher = () => {
  const child = spawn('node', ['-e', provider], { stdin: 'pipe', lines: true, cwd: '/private/tmp' })
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

mount(() => {
  const state = signal('Starting local process fixture')
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connectLocal({ command: 'node', entry: 'synthetic-inline' }, launcher)
        yield* client
          .translate({
            id: Schema.decodeUnknownSync(RequestId)('process-fixture'),
            text: 'source',
            sourceLanguage: 'auto',
            targetLanguage: 'ja',
          })
          .pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event._tag === 'Delta') state.set(event.text)
                if (event._tag === 'Finished') state.set('Complete: local process translated')
              }),
            ),
          )
        yield* Effect.never
      }),
    ).pipe(Effect.catchTag('ActionRequired', (error) => Effect.sync(() => state.set(error.message)))),
  )
  cleanup(() => {
    Effect.runFork(Fiber.interrupt(fiber))
  })
  return <Text>{state()}</Text>
})
