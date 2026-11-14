# NSH Effect Platform

This module adapts the official NSH 0.5.0 host APIs to Effect 4.1.2 services.
It does not require GlossShift settings, inference code, application environment variables, or a custom Rust module.
The public entry point is `platform.ts`, beside the implementation directory `platform/`.
Copy these together when extracting the adapter into another project.
The consumer must supply Effect and an NSH application with the capabilities required by its operations.
This is an extraction-ready internal module, not a published package or a claim of complete Node compatibility.

## Compose services

```ts
import { ConfigProvider, Effect, FileSystem, Path } from 'effect'

import * as NshPlatform from './platform.ts'

const services = NshPlatform.layer({
  cwd: '/absolute/working-directory',
  coreutils: '/absolute/path/to/coreutils',
  temporaryDirectory: '/absolute/private-temporary-directory',
  configProvider: ConfigProvider.fromEnvRecord({ APPLICATION_MODE: 'local' }),
})

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(path.resolve('settings.json'))
})

Effect.runFork(program.pipe(Effect.provide(services)))
```

`cwd` is mandatory and must be absolute without NUL characters.
It anchors the Path service's resolution, relative paths, and file URLs.
Resolve filesystem paths through that service before passing them to FileSystem, whose native operations use NSH's path rules.
Each composition receives its own options and does not change global application settings.

`coreutils` is optional.
Pass an absolute executable path, or the exact command `coreutils` when the host's fixed PATH and manifest grant it.
The adapter does not download utilities or impose a Nix store layout.
An operation that needs this utility fails explicitly when none is supplied.
`temporaryDirectory` supplies the secure temporary-file root, with NSH's application data directory as the host fallback.
The caller owns that root and must grant read and write access to it.

When `configProvider` is omitted, the provider reads only environment variables granted by the NSH manifest when the layer is acquired.
Pass an explicit provider to avoid relying on host environment configuration.
GlossShift-specific environment validation and batch wiring live separately in `runtime/platform.ts`.

## Services and limits

| Service             | Supported behavior                                                                                                                                                                                                                 | Explicit limitations                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FileSystem          | Native bounded reads, directory listing, rename, removal and basic directory creation. Optional coreutils supplies secure writes, exclusive creation, temporary files, permissions, links, canonical paths and ownership metadata. | No open file handles, streaming files, recursive copy, recursive listing, watch, chown, truncate or utimes. Native reads are limited to 64 MiB and writes to 8 MiB by NSH. |
| Path                | POSIX operations with an explicitly supplied absolute resolution base.                                                                                                                                                             | No implicit parent-process working directory.                                                                                                                              |
| ConfigProvider      | An injected provider or NSH's capability-filtered environment.                                                                                                                                                                     | No Node process globals or automatic application configuration parsing.                                                                                                    |
| Stdio               | Explicit arguments and optional private capture files. Host diagnostics use Effect Console by default.                                                                                                                             | No implicit parent stdin/stdout/stderr handles. Capture is buffered file I/O, not a live terminal stream.                                                                  |
| ChildProcessSpawner | Scoped native child processes, bounded stdout/stderr streams, completion and process-tree cancellation.                                                                                                                            | No pipelines, shell, extra descriptors, binary stdin, descriptor redirection, differing per-spawn environment overrides or unref.                                          |

Process cancellation uses NSH's fixed native policy: SIGTERM to the process group, then SIGKILL after 250 ms on macOS.
Explicit termination signals or escalation deadlines are rejected because the host cannot honor them.
Explicit `detached` options are rejected because the host fixes process-group ownership and cancellation.
An explicit child-process `cwd` is supported independently of the Path service's resolution base.
When child-process `cwd` is omitted, NSH uses its native default, `process.dataDir`, not the composition's `cwd`.

The default Stdio layer rejects stdin and stdout rather than inventing values.
Its stderr sink sends UTF-8 diagnostics to the host logger.
Use `NshStdio.make` to supply custom Effect sinks and streams.
Use `NshStdio.capture({ args, stdout, stderr, stdin, stdoutIsTerminal, coreutils })` for an explicitly managed capture bridge.
Capture paths must be absolute.
The caller owns file creation, permissions, terminal identity, publication and deletion.
The capture writer and child-process services wait for native exit before releasing their handles.

Unsupported operations fail with a typed `PlatformError` instead of silently changing semantics.
Invalid construction options are programmer errors.
NSH capability checks remain authoritative even when an executable or path was explicitly supplied.
When specifying an `env` record, set `extendEnv: true` and do not change inherited values.
Environment replacement is unsupported because NSH's manifest controls the child environment.
For a child process, grant the exact executable form used by the caller, including absolute paths where applicable.
Per-child output is bounded to 128 queued chunks and 1 MiB per stream.
A child that exceeds those limits fails and is terminated instead of growing memory without bounds.

## Verification

Run `vp run test-platform` in the pinned development shell.
The tests execute in the official NSH TUI host, not Node or a copied implementation.
They import only the public Platform and its implementation, with no GlossShift environment grants.
They cover independent providers and working directories, injected Stdio, unsupported operations, real filesystem metadata and safe temporary files, scoped child output and cleanup, capture UTF-8 chunk boundaries, and delayed native writer exit.
Application settings, CLI, inference and installed-package checks run separately through the application's public tasks.
