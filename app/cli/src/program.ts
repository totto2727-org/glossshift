import { Array, Effect, Option, Stdio, Stream } from 'effect'
import { CliConfig, CliOutput, Command, Flag, GlobalFlag } from 'effect/cli'

import { runAutostartCommand } from './commands/autostart.ts'
import { translateCommand } from './commands/translate.ts'

export const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const formatter = CliOutput.defaultFormatter({ colors: false })
    const present: CliOutput.Presenter['present'] = (event) => {
      const invalid = event._tag === 'InvalidInvocation'
      const text =
        event._tag === 'Version'
          ? formatter.formatVersion(event.name, event.version)
          : formatter.formatHelpDoc(event.helpDoc) + (invalid ? `\n${formatter.formatErrors(event.errors)}` : '')
      return Stream.run(
        Stream.succeed(`${text}\n`),
        (invalid ? stdio.stderr : stdio.stdout)({ endOnDone: false }),
      ).pipe(Effect.orDie)
    }
    return yield* Command.runWith(translateCommand, { version: '0.2.0' })(args.length === 0 ? ['--help'] : args).pipe(
      Effect.provideService(CliOutput.Presenter, { present }),
      Effect.provideService(CliConfig.CliConfig, {
        builtIns: [GlobalFlag.Help, { ...GlobalFlag.Version, flag: GlobalFlag.Version.flag.pipe(Flag.withAlias('V')) }],
      }),
    )
  })

export const runProgram = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const args = yield* stdio.args
  return yield* Option.contains(Array.head(args), '--autostart')
    ? runAutostartCommand(Array.drop(args, 1))
    : runCli(args)
})
