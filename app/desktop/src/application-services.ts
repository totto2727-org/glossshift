import { loadConfig } from '@glossshift/runtime/config'
import { loadDesktopConfig } from '@glossshift/runtime/desktop-config'
import { makeTranslation } from '@glossshift/runtime/translation'
import { Effect } from 'effect'

import { layer } from '#desktop/platform.ts'

import { FaultSchema } from './ports.ts'

/** Both configuration and inference live in the official NSH application's scope. */
export const loadApplicationServices = Effect.gen(function* () {
  const configuration = yield* loadDesktopConfig.pipe(
    Effect.mapError(() =>
      FaultSchema.make({
        message: 'Desktop settings could not be loaded. Check config.toml.',
      }),
    ),
  )
  const translation = yield* loadConfig.pipe(
    Effect.flatMap(makeTranslation),
    Effect.mapError(() =>
      FaultSchema.make({
        message: 'Local model settings could not be loaded. Check model selection and optional local.json.',
      }),
    ),
  )
  return { configuration, translation }
}).pipe(Effect.provide(layer))
