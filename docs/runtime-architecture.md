# Runtime architecture

This explanation is for contributors who maintain launchers, platform services, or Nix packaging.

## Process ownership

GlossShift uses unmodified official NSH 0.5.0 prebuilt hosts for desktop, terminal, and noninteractive batch execution.
Configuration and translation run inside those hosts as TypeScript through an Effect Platform layer.
The application registers no custom Rust module and does not start a Node runtime.
The only application-owned native code is a separate Swift Accessibility helper.

| Launch mode | Long-lived processes after the first translation                                | Additional processes                                       |
| ----------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Desktop     | Official NSH macOS host and official llama-server                               | One-shot Swift selection helper and bounded file utilities |
| Terminal UI | Official NSH terminal host and official llama-server                            | Bounded file utilities                                     |
| Batch CLI   | Small shell wrapper, official headless terminal host, and official llama-server | Bounded file utilities                                     |

The inference server starts lazily after a translation request.
An idle UI does not load model weights merely to show its initial state.
Each launch owns its server instead of connecting to a shared daemon.
Separate desktop, terminal, and batch launches can therefore load separate model instances and consume additional memory.
All modes share the Effect AI `LanguageModel`, configuration, prompt policy, and output limits directly.
There is no translation sidecar or acknowledged JSON transport between UI and translation policy.

## Effect Platform boundary

`platform/` provides Effect filesystem, path, configuration, standard I/O, and subprocess services using NSH APIs.
Application policy depends on those services rather than a specific operating-system implementation.
NSH Promise APIs are confined to adapters and lifted into scoped Effects.
The controller interrupts the active translation stream on cancellation or replacement.
The translation scope releases its HTTP request and child resources without waiting for a consumer to acknowledge a delta.

NSH 0.5.0 exposes a subset of Node-compatible modules, not a complete Node process environment.
Compatibility was checked against the pinned official host, not inferred from generated types alone.
The matching upstream implementations are [filesystem operations](https://github.com/longbridge/nsh/blob/f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1/crates/nsh-core/src/runtime/fs.rs), [process operations](https://github.com/longbridge/nsh/blob/f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1/crates/nsh-core/src/runtime/process.rs), and the [terminal host](https://github.com/longbridge/nsh/blob/f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1/crates/nsh-tui-host/src/main.rs).

| Capability                           | Observed NSH behavior                                                                                                  | Application boundary                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Incremental SHA-256 and random bytes | Compatible `crypto` operations execute in the official host                                                            | Small authentication values use the compatible module                                                     |
| HTTP and SSE                         | Fetch body streams support incremental decoding and cancellation                                                       | Direct authenticated loopback HTTP with Effect AI                                                         |
| Filesystem                           | Whole-file reads are limited to 64 MiB and writes to 8 MiB; streaming handles and secure exclusive creation are absent | Ordinary small files use NSH; packaged curl and coreutils handle model bytes and narrow atomic operations |
| Child processes                      | Explicit command and environment capabilities, scoped event-based process API                                          | Effect subprocess adapter with bounded streams and cleanup                                                |
| Parent CLI handles                   | No parent `argv`, `cwd`, `stdout`, or `stderr` handles                                                                 | Explicit argument, working-directory, and output bridge                                                   |
| Exit status                          | A headless `process.exit(7)` did not produce OS exit status 7                                                          | The wrapper validates an explicit completion status                                                       |
| Browser XML parser                   | The `plist` browser export expects `DOMParser`, which the official QuickJS host does not provide                       | A narrow package patch routes parsing through its already-declared XML parser dependency                  |

The curl and coreutils adapters execute only configured packaged tools with argument arrays.
Model bytes never enter the JavaScript heap as a complete GGUF file.
Executable capabilities are exact strings, so installed manifests and launchers use the same immutable paths.
Desktop and terminal configuration and cache overrides must also remain inside their manifest's filesystem grants.
An absolute path does not itself grant access outside the home, application-data, or private temporary roots.
External utilities do not inherit NSH filesystem enforcement automatically.
Their adapters must preserve private temporary directories, atomic publication, source-file safety, and bounded output.
Unsupported Effect operations fail explicitly instead of pretending to supply a complete Node filesystem.
NSH controls child environments through manifest grants rather than per-spawn overrides.
The process adapter accepts only compatible inherited values and rejects unsupported overrides, descriptor redirection, and pipelines.

## Batch CLI bridge

The installed `gshift` wrapper sends no-argument and `--tui` invocations to the official interactive host.
File and option invocations run the same TypeScript policy in the official host's headless mode.
A private per-invocation directory holds output and completion files.
The wrapper passes arguments as JSON and the original physical working directory explicitly.
It forwards captured stdout and stderr after the headless process finishes, then returns the validated application status.
Thus batch stdout is buffered rather than live-streamed to its parent pipe.
Host diagnostics and terminal control sequences are not translation stdout.
Signals terminate the owned host and cleanup removes the wrapper's temporary directory.

## Accessibility boundary

The desktop adapter registers shortcuts through standard NSH APIs.
It requests text from `glossshift-macos-helper --selection` before revealing the popup.
The helper uses Apple's ApplicationServices framework, emits one bounded JSON response, and exits.
Its `--permission` command checks permission without requesting it or reading a selection.
The injected launcher and response decoder can be replaced for another operating system without changing translation policy.

The helper does not own a GUI loop, register shortcuts, simulate copy keystrokes, or modify the clipboard.
An application without `AXSelectedText` produces a public failure instead of a simulated `Cmd+C` fallback.
Terminal and batch modes never start this helper.
Swift uses Apple's supported APIs directly without a third-party Objective-C bridge or a custom NSH host rebuild.
Nix compiles the helper separately, so TypeScript-only changes do not rebuild it.

## Local inference and model storage

The translation service starts packaged `llama-server` b12110 and matching Metal libraries.
Nix fetches the official macOS arm64 archive by hash rather than compiling llama.cpp.
There is no gollama fork, direct llama FFI, or native Node addon.
The server binds only to `127.0.0.1` on a kernel-selected port.
A per-launch random authentication key is stored in a private temporary file, not a secret command-line argument.
Server diagnostics do not enter translation stdout or public errors.

The first translation downloads the pinned official PLaMo 3 Translate 0.8B GGUF into the user's cache.
The complete artifact must match its configured SHA-256 before inference.
A verified cache hit does not contact the model host.
The endpoint supplies weights only, not hosted inference; source text and prompts stay on the Mac.
Larger single-file GGUF models can be selected in `local.json` with an explicit URI, digest, and prompt format.
PFML trusted tokens and untrusted source are tokenized separately.
Unsupported languages, context overflow, and incomplete output fail instead of publishing successful truncated files.

## Build boundaries

- Vite+ installs dependencies, checks formatting and lint, and dispatches tasks.
- Official NSH commands check, run, test, bundle, and package the application.
- Nix builds the small Swift helper separately and fetches official NSH and llama.cpp binaries by hash.
- Application packaging does not run Cargo or compile C++ inference code.
- Node remains a development-tool dependency, not an application runtime dependency.
- Model weights remain outside the Nix store and are not fetched during a build.

Nix also generates a tiny native wrapper to provide a signable Mach-O macOS entry point.
It runs the audited launch script, which replaces itself with the official NSH host.
The script lives under Resources to preserve the macOS bundle resource seal.
See [Upstream differences](./upstream-differences.md) for exact release pins and the retained plist validation patch.
