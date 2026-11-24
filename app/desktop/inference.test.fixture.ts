import { defaultModel, loadConfig } from '@glossshift/runtime/config'
import type { LocalConfig, TranslationError } from '@glossshift/runtime/config'
import { ConfigProvider, Effect, FileSystem, Path, Predicate } from 'effect'

export const config: LocalConfig = {
  cacheDirectory: '/synthetic/cache',
  contextSize: 2048,
  maxTokens: 512,
  model: defaultModel,
  sourceLanguage: 'auto',
}

export const runTestEffect = <A, E>(program: Effect.Effect<A, E>): Promise<A> =>
  // oxlint-disable-next-line rules/no-effect-runtime-run -- This is the boundary where the test runner executes the Effect program.
  Effect.runPromise(program)

export const loadFixtureConfig = (
  file?: unknown,
  env: Record<string, string> = {},
): Effect.Effect<LocalConfig, TranslationError> =>
  loadConfig.pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        // oxlint-disable-next-line rules/prefer-is-nullish -- A null fixture represents a present file containing invalid JSON configuration.
        exists: () => Effect.succeed(!Predicate.isUndefined(file)),
        readFileString: () => Effect.succeed(JSON.stringify(file)),
      }),
    ),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnvRecord({ HOME: '/synthetic/home', ...env }),
    ),
    Effect.provide(Path.layer),
  )
