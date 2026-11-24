import { Predicate, Effect, Fiber, MutableRef, Option, Queue, Stream } from 'effect'
import type { Scope } from 'effect'
import { expect, test } from 'nsh/test'

import type { NativeConnection } from './application.tsx'
import { createController } from './controller.ts'
import type { PopupController } from './controller.ts'
import { createDesktopControls } from './desktop-controls.ts'
import { connectDesktopShortcuts } from './desktop-shortcuts.ts'
import { NativeCommands, RequestIdSchema } from './domain.ts'
import type { NativeCommand } from './domain.ts'
import type { DesktopAdapterOptions } from './native-adapter.ts'
import { connectDesktop } from './native-adapter.ts'
import type { Fault } from './ports.ts'
import { translationFixture } from './translation-client.test.fixture.ts'

export const adapterFixture = Effect.gen(function* () {
  const controls = yield* Queue.bounded<NativeCommand>(8)
  const local = yield* translationFixture
  const desktopEvents: string[] = []
  const desktop = createDesktopControls({
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
      desktopEvents.push(Predicate.isNullish(options) ? 'tray:remove' : 'tray:install')
    },
    writeText: (text) =>
      // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
      Effect.runPromise(
        Effect.sync(() => {
          desktopEvents.push(`copy:${text}`)
        }),
      ),
  })
  const options: DesktopAdapterOptions = {
    background: true,
    configuration: {
      created_files: false,
      directory: '/fixture/config',
      shortcuts: [{ keys: 'Ctrl+Super+KeyJ', target_language: 'Japanese' }],
      window: { height: 360, min_height: 180, min_width: 320, width: 560 },
    },
    connectShortcuts: () =>
      Effect.acquireRelease(Effect.succeed(Stream.fromQueue(controls)), () => Queue.shutdown(controls)),
    installControls: desktop.install,
    // oxlint-disable-next-line unicorn/no-useless-undefined -- The NSH window installer returns Effect<undefined>; Effect.void is not this contract.
    installWindow: () => Effect.succeed(undefined),
    selection: { capture: Effect.die('Unexpected recapture'), permission: Effect.succeed(true) },
    translation: local.service,
  }
  return { controls, desktop, desktopEvents, local, options }
})
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- The native test runner or its injected host callback executes the Effect here.
  Effect.runPromise(effect.pipe(Effect.timeout('5 seconds')))

const connectController = (
  options: DesktopAdapterOptions,
): Effect.Effect<Readonly<{ connection: NativeConnection; controller: PopupController }>, Fault, Scope.Scope> =>
  Effect.gen(function* () {
    const connection = yield* connectDesktop(options)
    const controller = yield* createController(connection.ports)
    return { connection, controller }
  })

type AdapterFixture = Effect.Success<typeof adapterFixture>

const selectedBeforeFocus = '# selected before focus'

const focusedFixture = (
  context: AdapterFixture,
): Effect.Effect<Readonly<{ options: DesktopAdapterOptions; press: () => void; focused: Queue.Queue<true> }>> =>
  Effect.gen(function* () {
    const focused = yield* Queue.bounded<true>(1)
    const press = MutableRef.make(Option.none<() => void>())
    const options: DesktopAdapterOptions = {
      ...context.options,
      connectShortcuts: (configuration, capture) =>
        connectDesktopShortcuts(configuration, capture, {
          register: async (_key, onPress) => {
            MutableRef.set(press, Option.some(onPress))
            return true
          },
          unregister: () => {
            MutableRef.set(press, Option.none())
          },
        }),
      installControls: context.desktop.install.pipe(
        Effect.map((controls) => ({
          ...controls,
          reveal: controls.reveal.pipe(Effect.andThen(Queue.offer(focused, true)), Effect.asVoid),
        })),
      ),
      selection: {
        capture: Effect.sync(() => {
          context.desktopEvents.push('capture')
          return selectedBeforeFocus
        }),
        permission: Effect.succeed(true),
      },
    }
    return { focused, options, press: () => Option.getOrThrow(MutableRef.get(press))() }
  })

const dispatchCapture =
  (controller: PopupController) =>
  (command: NativeCommand): Effect.Effect<void> =>
    Predicate.isTagged('Captured')(command) ? controller.requestCaptured(command) : Effect.void

test('global shortcut finishes separate selection capture before revealing the retained popup', async () => {
  const verify = Effect.scoped(
    Effect.gen(function* () {
      const testContext = yield* adapterFixture
      const { focused, options, press } = yield* focusedFixture(testContext)
      const { connection, controller } = yield* connectController(options)
      yield* connection.commands.pipe(Stream.runForEach(dispatchCapture(controller)), Effect.forkScoped)
      press()
      yield* Queue.take(focused)
      expect(testContext.desktopEvents).toEqual(['tray:install', 'capture', 'focus'])
      const { request } = yield* Queue.take(testContext.local.requests)
      expect(request.text).toBe(selectedBeforeFocus)
    }),
  )
  await run(verify)
})

test('desktop adapter owns the injected tray scope and routes raw copy and window controls', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* adapterFixture
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { ports } = yield* connectDesktop(testContext.options)
            expect(testContext.desktopEvents).toEqual(['tray:install'])
            yield* ports.copy('# raw\n<literal>')
            yield* ports.reveal
            yield* ports.hide
            yield* ports.quit
          }),
        )
        expect(testContext.desktopEvents).toEqual([
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

const expectCaptured = (first: Option.Option<NativeCommand>): ReturnType<typeof NativeCommands.Captured> => {
  const captured = Option.filter(first, (command) => Predicate.isTagged('Captured')(command))
  return Option.getOrThrow(captured)
}

const receiveCapture = (
  commands: Stream.Stream<NativeCommand, Fault>,
): Effect.Effect<ReturnType<typeof NativeCommands.Captured>, Fault> =>
  commands.pipe(Stream.runHead, Effect.map(expectCaptured))

const provideTranslation = (output: Queue.Queue<Option.Option<string>>): Effect.Effect<void> => {
  const close = Queue.offer(output, Option.none())
  return Queue.offer(output, Option.some('translated')).pipe(Effect.andThen(close), Effect.asVoid)
}

test('standard desktop controls preserve helper-captured text during in-process translation', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* adapterFixture
        const { connection, controller } = yield* connectController(testContext.options)
        yield* Queue.offer(
          testContext.controls,
          NativeCommands.Captured({
            id: RequestIdSchema.make('desktop-71'),
            targetLanguage: 'Japanese',
            text: '# selection',
          }),
        )
        const command = yield* receiveCapture(connection.commands)
        yield* controller.requestCaptured(command)
        const translated = yield* Queue.take(testContext.local.requests)
        expect(translated.request.text).toBe('# selection')
        yield* provideTranslation(translated.output)
        const completed = yield* controller.snapshots.pipe(
          Stream.filter((snapshot) => snapshot.phase === 'Complete'),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        expect(completed).toMatchObject({ output: 'translated', sourceText: '# selection' })
      }),
    ),
  )
})

test('desktop controls bypass a blocked local translation consumer', async () => {
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const testContext = yield* adapterFixture
        const connection = yield* connectDesktop(testContext.options)
        const consumed = yield* Queue.bounded<true>(1)
        yield* connection.ports
          .translate({
            id: RequestIdSchema.make('blocked'),
            sourceLanguage: 'auto',
            targetLanguage: 'ja',
            text: 'source',
          })
          .pipe(
            Stream.runForEach(() => Queue.offer(consumed, true).pipe(Effect.andThen(Effect.never))),
            Effect.forkScoped,
          )
        yield* Queue.take(consumed)
        const commands = yield* connection.commands.pipe(Stream.runHead, Effect.forkScoped)
        yield* Queue.offer(
          testContext.controls,
          NativeCommands.Captured({
            id: RequestIdSchema.make('fresh'),
            targetLanguage: 'ja',
            text: 'fresh source',
          }),
        )
        expect(Option.exists(yield* Fiber.join(commands), Predicate.isTagged('Captured'))).toBe(true)
        expect(Option.isNone(yield* Queue.poll(testContext.local.requests))).toBe(true)
      }),
    ),
  )
})
