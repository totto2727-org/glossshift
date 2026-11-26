import { Schema } from 'effect'

const zeroSize = 0
const largestNativeSize = 2_147_483_647
const Dimension = Schema.Number.check(Schema.isGreaterThan(zeroSize), Schema.isLessThanOrEqualTo(largestNativeSize))

/** Non-secret OS settings shared by both application adapters. */
const DesktopConfigurationSchema = Schema.Struct({
  created_files: Schema.Boolean,
  directory: Schema.String,
  shortcuts: Schema.Array(Schema.Struct({ keys: Schema.NonEmptyString, target_language: Schema.NonEmptyString })),
  window: Schema.Struct({
    height: Dimension,
    min_height: Dimension,
    min_width: Dimension,
    width: Dimension,
  }),
})
export type DesktopConfiguration = typeof DesktopConfigurationSchema.Type

export const DesktopConfigurationJson = Schema.fromJsonString(DesktopConfigurationSchema)
