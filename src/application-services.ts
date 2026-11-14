import { Effect } from 'effect'

import { loadConfig } from '../node/config'
import { loadDesktopConfig } from '../node/desktop-config'
import { makeTranslation } from '../node/translation'
import { layer } from '../platform'
import type { Fault } from './ports'

/** Both configuration and inference live in the official NSH application's scope. */
export const loadApplicationServices = Effect.gen(function* () {
  const configuration = yield* loadDesktopConfig.pipe(
    Effect.mapError((): Fault => ({
      _tag: 'ActionRequired', message: 'Desktop settings could not be loaded. Check config.toml.',
    })),
  )
  const translation = yield* loadConfig.pipe(
    Effect.flatMap(makeTranslation),
    Effect.mapError((): Fault => ({
      _tag: 'ActionRequired', message: 'Local model settings could not be loaded. Check local.json.',
    })),
  )
  return { configuration, translation }
}).pipe(Effect.provide(layer))
