import { ConfigProvider, Layer, type Stdio } from 'effect'

import * as NshChildProcess from './platform/nshChildProcess.ts'
import * as NshConfigProvider from './platform/nshConfigProvider.ts'
import * as NshFileSystem from './platform/nshFileSystem.ts'
import * as NshPath from './platform/nshPath.ts'
import * as NshStdio from './platform/nshStdio.ts'

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
