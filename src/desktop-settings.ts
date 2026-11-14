import { Schema } from 'effect'

const Dimension = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(2147483647))

/** Non-secret OS settings shared by Node bootstrap and both application adapters. */
export const DesktopConfiguration = Schema.Struct({
  shortcuts: Schema.Array(Schema.Struct({ keys: Schema.NonEmptyString, target_language: Schema.NonEmptyString })),
  window: Schema.Struct({
    width: Dimension,
    height: Dimension,
    min_width: Dimension,
    min_height: Dimension,
  }),
  directory: Schema.String,
  created_files: Schema.Boolean,
})
export type DesktopConfiguration = typeof DesktopConfiguration.Type

export const DesktopConfigurationJson = Schema.fromJsonString(DesktopConfiguration)
