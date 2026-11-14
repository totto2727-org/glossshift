# Runtime architecture

This explanation is for contributors who maintain launchers, process adapters, or Nix packaging.

## Process ownership

GlossShift uses official NSH 0.5.0 prebuilt hosts for both desktop and terminal interfaces.
The TypeScript application does not register a custom Rust module.
The only application-native code is a small, separate Swift Accessibility helper.

| Launch mode | Long-lived processes after the first translation                                       | Additional short-lived processes                        |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Desktop     | Official NSH macOS host, Node TypeScript translation process, official llama-server    | Node configuration bootstrap and Swift selection helper |
| Terminal UI | Official NSH terminal host, Node TypeScript translation process, official llama-server | Node configuration bootstrap                            |
| Batch CLI   | Node TypeScript batch process and official llama-server                                | None for Accessibility                                  |

The inference server starts lazily, after the first translation request.
An idle UI does not load model weights merely to display its initial state.
Each launch owns its server rather than connecting to a shared background daemon.
Separate desktop, terminal, and batch launches can therefore load separate model instances and consume additional memory.

The UI and batch modes share the Effect AI `LanguageModel` implementation, model configuration, prompt policy, and output limits.
The UI process communicates with its translation child through private, acknowledged NDJSON pipes.
The batch command calls the same translation service directly in its Node process.

## Accessibility boundary

The desktop TypeScript adapter registers global shortcuts through standard NSH APIs.
It requests the selected text from `glossshift-macos-helper --selection` before revealing the popup.
The helper reads the focused application's selection through Apple's ApplicationServices framework, emits one bounded JSON response, and exits.
Its `--permission` command checks permission without requesting it or reading a selection.
The launcher and response decoder are injected at the TypeScript boundary.
Another OS can replace this boundary without changing popup state or translation policy.

The helper does not own a GUI event loop, register shortcuts, simulate copy keystrokes, or modify the clipboard.
An application that does not expose `AXSelectedText` produces a public failure instead of falling back to simulated `Cmd+C`.
The terminal and batch modes never start the Accessibility helper.

Swift keeps this layer small because it can use Apple's supported APIs directly.
It avoids a third-party Objective-C bridge, manually maintained Go FFI structures, and a full NSH Rust host rebuild.
Nix supplies the Swift build environment and compiles the helper as a separate derivation.
A TypeScript-only change does not rebuild that derivation.

## Local inference boundary

The translation service starts the exact packaged `llama-server` b12110 executable and its matching Metal libraries.
Nix fetches the official macOS arm64 archive by hash rather than compiling llama.cpp.
There is no gollama fork, direct llama FFI, or native Node addon.

The server listens only on `127.0.0.1` with a kernel-selected port.
A random per-launch authentication key is stored in a private temporary file, not passed as a secret command-line argument.
The TypeScript adapter waits for readiness and uses authenticated HTTP and SSE.
Cancellation aborts the active HTTP request, and the owning scope terminates the server at shutdown.
Server diagnostics do not enter translation stdout or public error messages.

PLaMo translation uses trusted PFML special tokens and separately tokenized source text.
The service rejects unsupported languages, input context overflow, and incomplete output caused by token limits.
It does not report a partial file as a completed translation.

## Model storage and network

The first translation downloads the pinned official PLaMo 3 Translate 0.8B GGUF into the user's cache.
The complete file must match its configured SHA-256 before inference.
A verified cache hit does not contact the model host.
The download endpoint supplies weights only, not hosted inference.
Selected text and translation prompts stay on the Mac.
Larger single-file GGUF models can be selected in `local.json` with an explicit URI, digest, and prompt format.

## Why Node remains

Node executes the shared TypeScript translation and batch application code.
It provides incremental file hashing, large-file streams, subprocess control, and ordinary CLI arguments and output.
NSH's UI runtime is QuickJS, not Node, so it does not load Node APIs in the UI process.
Its pinned public APIs do not provide a drop-in noninteractive batch host with the same file and stdio contract.
Replacing Node with a new application-owned JS host would add a runtime to maintain.
Moving the translation policy into Go or Swift would also discard the TypeScript and Effect boundary.
Node therefore remains an explicit packaging dependency, without native inference bindings.

## Build boundaries

- Vite+ installs dependencies, checks format and lint, and dispatches tasks.
- Official NSH commands perform application checking, execution, tests, bundling, and packaging.
- Nix builds the Swift helper independently and fetches official NSH and llama.cpp binaries by hash.
- Application packaging does not run Cargo or compile C++ inference code.
- Model weights remain outside the Nix store and are not part of build-time network access.

Nix also generates a small native executable wrapper so the macOS app has a signable Mach-O entry point.
The wrapper executes the audited launch script, which replaces itself with the official NSH host.
It adds no long-lived process or custom UI runtime.

See [Upstream differences](./upstream-differences.md) for exact upstream pins and the retained plist parser patch.
