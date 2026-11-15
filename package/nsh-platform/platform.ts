import { ConfigProvider, Layer, type Stdio } from 'effect'

import * as NshChildProcess from './platform/NshChildProcess.ts'
import * as NshConfigProvider from './platform/NshConfigProvider.ts'
import * as NshFileSystem from './platform/NshFileSystem.ts'
import * as NshPath from './platform/NshPath.ts'
import * as NshStdio from './platform/NshStdio.ts'

export { NshChildProcess, NshConfigProvider, NshFileSystem, NshPath, NshStdio }

export interface Options extends NshFileSystem.Options {
  readonly cwd: string
  readonly configProvider?: ConfigProvider.ConfigProvider | undefined
  readonly stdio?: Layer.Layer<Stdio.Stdio> | undefined
}

/** Compose host services without reading application configuration or selecting a working directory. */
export const layer = (options: Options) =>
  Layer.mergeAll(
    NshFileSystem.layer(options),
    NshPath.make(options.cwd),
    options.configProvider === undefined ? NshConfigProvider.layer : ConfigProvider.layer(options.configProvider),
    options.stdio ?? NshStdio.unavailable([]),
    NshChildProcess.layer,
  )
