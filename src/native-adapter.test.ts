import { Effect, Fiber, Option, Queue, Schema, Stream } from 'effect'
import type { BridgeEvent, BridgeModule } from 'glossshift/native'
import { expect, test } from 'nsh/test'

import { createController } from './controller'
import { createDesktopControls } from './desktop-controls'
import { RequestId } from './domain'
import { localFixture } from './local-client.fixture'
import { connectNative } from './native-adapter'
import './local-client.test'

export const adapterFixture = Effect.gen(function* () {
  const controls = yield* Queue.bounded<BridgeEvent>(8)
  const closed = yield* Queue.bounded<string>(8)
  const local = yield* localFixture
  const promise = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
  const bootstrap = {
    schemaVersion: 2,
    runtime: { command: 'fixture', entry: '/fixture/main.ts' },
    status: 'Synthetic native services',
    accessibilityGranted: true,
    shortcuts: [],
    window: { width: 560, height: 360, minWidth: 320, minHeight: 180 },
  }
  const desktopEvents: string[] = []
  const desktop = createDesktopControls({
    writeText: (text) =>
      promise(
        Effect.sync(() => {
          desktopEvents.push(`copy:${text}`)
        }),
      ),
    mainWindow: () => ({
      focus: () => {
        desktopEvents.push('focus')
      },
      hide: () => {
        desktopEvents.push('hide')
      },
    }),
    quit: () => {
      desktopEvents.push('quit')
    },
    setTray: (options) => {
      desktopEvents.push(options === null ? 'tray:remove' : 'tray:install')
    },
  })
  const bridge: BridgeModule = {
    initialize: () => promise(Effect.succeed(bootstrap)),
    openTransport: () => promise(Effect.succeed('native-session')),
    closeTransport: (id) =>
      promise(Queue.offer(closed, id).pipe(Effect.andThen(Queue.shutdown(controls)), Effect.asVoid)),
    nextControl: () => promise(Queue.take(controls)),
    selection: () => promise(Effect.die('Unexpected recapture')),
  }
  return { bridge, controls, closed, local, desktop, desktopEvents }
})
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

test('desktop adapter owns the injected tray scope and routes raw copy and window controls', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { ports } = yield* connectNative(f.bridge, f.local.launcher, f.desktop.install)
            expect(f.desktopEvents).toEqual(['tray:install'])
            yield* ports.copy('# raw\n<literal>')
            yield* ports.reveal
            yield* ports.hide
            yield* ports.quit
          }),
        )
        expect(f.desktopEvents).toEqual([
          'tray:install',
          'copy:# raw\n<literal>',
          'focus',
          'hide',
          'quit',
          'tray:remove',
        ])
      }),
    ),
  )
})

test('schema2 native controls preserve captured text while local process translates', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        const connection = yield* connectNative(f.bridge, f.local.launcher, f.desktop.install)
        const controller = yield* createController(connection.ports)
        yield* Queue.offer(f.controls, {
          kind: 'capture',
          requestId: 'native-71',
          seq: 0,
          text: '# selection',
          targetLanguage: 'Japanese',
        })
        const command = yield* connection.commands.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        if (command._tag !== 'Captured') return yield* Effect.die('Expected captured command')
        yield* controller.requestCaptured(command)
        const translated = yield* Queue.take(f.local.written)
        if (translated.kind !== 'translate') return yield* Effect.die('Expected translate')
        expect(translated.text).toBe('# selection')
        f.local.emit({ version: 1, kind: 'started', requestId: translated.requestId, seq: 1, text: '# selection' })
        yield* Queue.take(f.local.written)
        f.local.emit({ version: 1, kind: 'delta', requestId: translated.requestId, seq: 2, text: 'translated' })
        yield* Queue.take(f.local.written)
        f.local.emit({ version: 1, kind: 'finished', requestId: translated.requestId, seq: 3 })
        const completed = yield* controller.snapshots.pipe(
          Stream.filter((snapshot) => snapshot.phase === 'Complete'),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        expect(completed.output).toBe('translated')
        expect(completed.sourceText).toBe('# selection')
      }),
    ),
  )
})

test('native controls bypass a blocked local translation consumer', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        const connection = yield* connectNative(f.bridge, f.local.launcher, f.desktop.install)
        const consumed = yield* Queue.bounded<void>(1)
        yield* connection.ports
          .translate({
            id: Schema.decodeUnknownSync(RequestId)('blocked'),
            text: 'source',
            sourceLanguage: 'auto',
            targetLanguage: 'ja',
          })
          .pipe(
            Stream.runForEach(() => Queue.offer(consumed, undefined).pipe(Effect.andThen(Effect.never))),
            Effect.forkScoped,
          )
        const translate = yield* Queue.take(f.local.written)
        if (translate.kind !== 'translate') return yield* Effect.die('Expected local request')
        f.local.emit({ version: 1, kind: 'started', requestId: translate.requestId, seq: 1, text: 'source' })
        yield* Queue.take(consumed)
        const commands = yield* connection.commands.pipe(Stream.runHead, Effect.forkScoped)
        yield* Queue.offer(f.controls, {
          kind: 'capture',
          requestId: 'fresh',
          seq: 0,
          text: 'fresh source',
          targetLanguage: 'ja',
        })
        const command = Option.getOrThrow(yield* Fiber.join(commands))
        expect(command._tag).toBe('Captured')
        expect(Option.isNone(yield* Queue.poll(f.local.written))).toBe(true)
      }),
    ),
  )
})
