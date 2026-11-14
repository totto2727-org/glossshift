import process from 'process'

import { ConfigProvider, Effect } from 'effect'

/** The host returns only metadata and explicitly granted environment variables. */
export const layer = ConfigProvider.layer(
  Effect.sync(() => ConfigProvider.fromEnvRecord(process.env, { preserveEmptyStrings: true })),
)
