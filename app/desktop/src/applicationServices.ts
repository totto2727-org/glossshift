import { loadConfig } from '@glossshift/runtime/config'
import { loadDesktopConfig } from '@glossshift/runtime/desktopConfig'
import { makeTranslation } from '@glossshift/runtime/translation'
import { Effect } from 'effect'

import { layer } from '../runtime/platform.ts'
import { Fault } from './ports'

/** Both configuration and inference live in the official NSH application's scope. */
export const loadApplicationServices = Effect.gen(function* () {
  const configuration = yield* loadDesktopConfig.pipe(
    Effect.mapError(() =>
      Fault.make({
        message: 'Desktop settings could not be loaded. Check config.toml.',
      }),
    ),
  )
  const translation = yield* loadConfig.pipe(
    Effect.flatMap(makeTranslation),
    Effect.mapError(() =>
      Fault.make({
        message: 'Local model settings could not be loaded. Check model selection and optional local.json.',
      }),
    ),
  )
  return { configuration, translation }
}).pipe(Effect.provide(layer))
