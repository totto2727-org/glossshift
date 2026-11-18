import { Data } from 'effect'

export class CliError extends Data.TaggedError('CliError')<{
  readonly message: string
}> {}

export const cliError = (message: string): CliError => new CliError({ message })
