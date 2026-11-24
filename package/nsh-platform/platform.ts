import { Predicate, ConfigProvider, Layer } from 'effect'
import type { FileSystem, Path, Stdio } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'

import * as NshChildProcess from './platform/nsh-child-process.ts'
import * as NshConfigProvider from './platform/nsh-config-provider.ts'
import * as NshFileSystem from './platform/nsh-file-system.ts'
import * as NshPath from './platform/nsh-path.ts'
import * as NshStdio from './platform/nsh-stdio.ts'

// oxlint-disable-next-line oxc/no-barrel-file -- The public NSH platform module exposes its named adapter namespaces alongside layer composition.
export * as NshChildProcess from './platform/nsh-child-process.ts'
export * as NshConfigProvider from './platform/nsh-config-provider.ts'
export * as NshFileSystem from './platform/nsh-file-system.ts'
export * as NshPath from './platform/nsh-path.ts'
export * as NshStdio from './platform/nsh-stdio.ts'

export type Options = NshFileSystem.Options &
  Readonly<{
    cwd: string
    configProvider?: ConfigProvider.ConfigProvider | undefined
    stdio?: Layer.Layer<Stdio.Stdio> | undefined
  }>

/**
 * Compose host services without reading application configuration or selecting a working directory.
 *
 * @param {Options} options Working directory, tool, configuration, and Stdio settings.
 * @returns {Layer.Layer} NSH implementations of the platform services.
 */
export const layer = (
  options: Options,
): Layer.Layer<FileSystem.FileSystem | Path.Path | Stdio.Stdio | ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.mergeAll(
    NshFileSystem.layer(options),
    NshPath.make(options.cwd),
    Predicate.isNullish(options.configProvider)
      ? NshConfigProvider.layer
      : ConfigProvider.layer(options.configProvider),
    options.stdio ?? NshStdio.unavailable([]),
    NshChildProcess.layer,
  )
