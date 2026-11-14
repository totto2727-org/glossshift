import { Effect, Fiber, Option, Queue, Schema, Stream } from 'effect'
import { expect, test } from 'nsh/test'

import type { NativeCommand } from './application'
import { createController } from './controller'
import { createDesktopControls } from './desktop-controls'
import { connectDesktopShortcuts } from './desktop-shortcuts'
import { RequestId } from './domain'
import { localFixture } from './local-client.fixture'
import { connectDesktop } from './native-adapter'
import type { DesktopAdapterOptions } from './native-adapter'
import './local-client.test'

export const adapterFixture = Effect.gen(function* () {
  const controls = yield* Queue.bounded<NativeCommand>(8)
  const local = yield* localFixture
  const desktopEvents: string[] = []
  const desktop = createDesktopControls({
    writeText: (text) =>
      Effect.runPromise(
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
  const options: DesktopAdapterOptions = {
    runtime: { command: 'node', entry: '/fixture/main.ts' },
    selection: { permission: Effect.succeed(true), capture: Effect.die('Unexpected recapture') },
    background: true,
    launcher: local.launcher,
    loadSettings: () =>
      Effect.succeed({
        shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'Japanese' }],
        directory: '/fixture/config',
        created_files: false,
        window: { width: 560, height: 360, min_width: 320, min_height: 180 },
      }),
    installControls: desktop.install,
    installWindow: () => Effect.succeed(undefined),
    connectShortcuts: () =>
      Effect.acquireRelease(Effect.succeed(Stream.fromQueue(controls)), () => Queue.shutdown(controls)),
  }
  return { options, controls, local, desktop, desktopEvents }
})
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

test('global shortcut finishes separate selection capture before revealing the retained popup', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        const focused = yield* Queue.bounded<void>(1)
        let press = Option.none<() => void>()
        const connection = yield* connectDesktop({
          ...f.options,
          selection: {
            permission: Effect.succeed(true),
            capture: Effect.sync(() => {
              f.desktopEvents.push('capture')
              return '# selected before focus'
            }),
          },
          installControls: f.desktop.install.pipe(
            Effect.map((controls) => ({
              ...controls,
              reveal: controls.reveal.pipe(Effect.andThen(Queue.offer(focused, undefined)), Effect.asVoid),
            })),
          ),
          connectShortcuts: (configuration, capture) =>
            connectDesktopShortcuts(configuration, capture, {
              register: (_key, callback) =>
                Effect.runPromise(
                  Effect.sync(() => {
                    press = Option.some(callback)
                    return true
                  }),
                ),
              unregister: () => {
                press = Option.none()
              },
            }),
        })
        const controller = yield* createController(connection.ports)
        yield* connection.commands.pipe(
          Stream.runForEach((command) =>
            command._tag === 'Captured' ? controller.requestCaptured(command) : Effect.void,
          ),
          Effect.forkScoped,
        )
        Option.getOrThrow(press)()
        yield* Queue.take(focused)
        expect(f.desktopEvents).toEqual(['tray:install', 'capture', 'focus'])
        const request = yield* Queue.take(f.local.written)
        if (request.kind !== 'translate') return yield* Effect.die('Expected translation')
        expect(request.text).toBe('# selected before focus')
      }),
    ),
  )
})

test('desktop adapter owns the injected tray scope and routes raw copy and window controls', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { ports } = yield* connectDesktop(f.options)
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

test('standard desktop controls preserve helper-captured text while the Node process translates', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        const connection = yield* connectDesktop(f.options)
        const controller = yield* createController(connection.ports)
        yield* Queue.offer(f.controls, {
          _tag: 'Captured',
          id: Schema.decodeUnknownSync(RequestId)('desktop-71'),
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

test('desktop controls bypass a blocked local translation consumer', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* adapterFixture
        const connection = yield* connectDesktop(f.options)
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
          _tag: 'Captured',
          id: Schema.decodeUnknownSync(RequestId)('fresh'),
          text: 'fresh source',
          targetLanguage: 'ja',
        })
        expect(Option.getOrThrow(yield* Fiber.join(commands))._tag).toBe('Captured')
        expect(Option.isNone(yield* Queue.poll(f.local.written))).toBe(true)
      }),
    ),
  )
})
