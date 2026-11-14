import { Effect } from 'effect'

import { loadConfig } from '../node/config'
import { loadDesktopConfig } from '../node/desktop-config'
import { makeTranslation } from '../node/translation'
import { layer } from '../platform'
import type { Fault } from './ports'

/** Both configuration and inference live in the official NSH application's scope. */
export const loadApplicationServices = Effect.gen(function* () {
  const configuration = yield* loadDesktopConfig
  const translation = yield* loadConfig.pipe(Effect.flatMap(makeTranslation))
  return { configuration, translation }
}).pipe(
  Effect.provide(layer),
  Effect.mapError((): Fault => ({
    _tag: 'ActionRequired',
    message: 'The application settings could not be loaded. Check config.toml and local.json.',
  })),
)
