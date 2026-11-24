import { Predicate, Array, Effect, Option, Stdio, Stream } from 'effect'
import { CliConfig, CliOutput, Command, Flag, GlobalFlag } from 'effect/cli'

import { runAutostartCommand } from './commands/autostart.ts'
import { translateCommand } from './commands/translate.ts'

const executeTranslation = Command.runWith(translateCommand, { version: '0.2.0' })
const versionFlag = GlobalFlag.Version.flag.pipe(Flag.withAlias('V'))
const autostartCommandLength = 1

export const runCli = (args: Readonly<string[]>): ReturnType<typeof executeTranslation> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const formatter = CliOutput.defaultFormatter({ colors: false })
    const present: CliOutput.Presenter['present'] = (event) => {
      const invalid = Predicate.isTagged('InvalidInvocation')(event)
      const text = Predicate.isTagged('Version')(event)
        ? formatter.formatVersion(event.name, event.version)
        : formatter.formatHelpDoc(event.helpDoc) + (invalid ? `\n${formatter.formatErrors(event.errors)}` : '')
      return Stream.run(
        Stream.succeed(`${text}\n`),
        (invalid ? stdio.stderr : stdio.stdout)({ endOnDone: false }),
      ).pipe(Effect.orDie)
    }
    return yield* executeTranslation(Array.isReadonlyArrayEmpty(args) ? ['--help'] : args).pipe(
      Effect.provideService(CliOutput.Presenter, { present }),
      Effect.provideService(CliConfig.CliConfig, {
        builtIns: [GlobalFlag.Help, { ...GlobalFlag.Version, flag: versionFlag }],
      }),
    )
  })

export const runProgram = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const args = yield* stdio.args
  return yield* Option.contains(Array.head(args), '--autostart')
    ? runAutostartCommand(Array.drop(args, autostartCommandLength))
    : runCli(args)
})
