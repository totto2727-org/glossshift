# GlossShift

## Repository structure

```text
App.tsx                     NSH entry in the same directory as nsh.json
src/domain.ts               Pure popup states, messages, and transitions
src/controller.ts           Effect-owned request lifetimes and bounded event processing
src/ports.ts                Injectable native services and public settings
src/                        NSH views, process adapters, and application tests
terminal/App.tsx            Rust-free entry with its own NSH manifest and generated types
src/desktop-controls.ts     Standard NSH clipboard, window, application, and tray APIs
src/terminal-adapter.ts     Direct Effect translation without desktop services
helper/Selection.swift      Injectable macOS Accessibility selection boundary
helper/main.swift           One-shot JSON command entry
nix/macos-helper.nix        Small Swift helper build and synthetic contract tests
nix/llama-server.nix        Fixed official inference executable and sibling libraries
runtime/main.ts             Shared batch and desktop command policy
batch/App.tsx               Official headless batch entry and explicit completion status
platform/                   Effect services backed by NSH and bounded file utilities
runtime/desktop-config.ts      Non-destructive TOML settings and validation
runtime/autostart.ts           Safe macOS LaunchAgent file operations
runtime/translation.ts         Scoped Effect AI local translation service
runtime/model.ts               Verified automatic GGUF download and cache reuse
runtime/server.ts              Private llama-server process lifetime and authentication
runtime/server-api.ts          Validated loopback HTTP and bounded SSE
runtime/generation.ts          Bounded generation and prompt tokenization
runtime/prompt.ts              PFML3 prompt and supported-language validation
runtime/config.ts              Local model settings and pinned default artifact
nsh.json                    Application identity, narrow capabilities, and window defaults
vite.config.ts              Vite+ formatting, lint, and delegated task definitions
pnpm-workspace.yaml         Catalog, package-manager policy, and release-age safeguards
patches/                    LaunchAgent plist dictionary validation patch
packaging/                  macOS application metadata and assets
flake.nix                   Pinned development tools and Darwin package outputs
package.nix                 Native application packaging
Justfile                    Compatibility aliases into Vite+ tasks
```

## Development commands

Run commands from the repository root.
Enter `nix develop` to prepare the pinned official NSH 0.5.0 CLI and terminal component, development tools, the Swift helper, the official llama-server, curl, coreutils, and Vite+.
Keep the CLI and terminal component on the same exact release revision with content hashes.
Then install JavaScript dependencies with `vp install --frozen-lockfile`.
All application manifests omit `rust`, so NSH uses its official prebuilt hosts.
Do not add custom Rust host dependencies or generated source checkouts to restore an API that a separate helper or the standard JS API can provide.

| Command                                  | Responsibility                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `vp install --frozen-lockfile`           | Install the locked package graph through Vite+.                                          |
| `vp run check`                           | Check formatting and lint without a second typechecker.                                  |
| `vp run fix`                             | Apply Vite+ formatting and lint fixes.                                                   |
| `vp run typecheck`                       | Check desktop, terminal, runtime, and batch projects through NSH's TypeScript compiler.  |
| `vp run dev`                             | Delegate development and reload to NSH's macOS host.                                     |
| `vp run run`                             | Run the application through NSH.                                                         |
| `vp run build-tui`                       | Bundle the independent terminal application without compiling custom Rust.               |
| `vp run build`                           | Produce the NSH release bundle, not an installable application.                          |
| `vp run package`                         | Package the native macOS application through NSH.                                        |
| `vp run test`                            | Run application tests through the official NSH test host.                                |
| `vp run tui`                             | Run the shared TS application through NSH's official terminal host.                      |
| `vp run test-tui`                        | Run the dedicated terminal interaction suite through NSH's official TestBackend.         |
| `vp run test-platform`                   | Exercise isolated filesystem, configuration, process, and capture boundaries in NSH.     |
| `vp run test-inference`                  | Check compatible crypto and direct HTTP/SSE behavior in NSH.                             |
| `vp run test-cli`                        | Check batch contracts and real filesystem behavior through NSH.                          |
| `vp run test-local-model`                | Opt in to production TUI translation with real model weights and isolated configuration. |
| `vp run cli -- FILES... --lang LANGUAGE` | Run the shared batch policy in the official headless NSH host.                           |
| `vp run ci`                              | Run the minimal formatting and lint gate.                                                |

Vite+ owns installation, task orchestration, formatting, and lint only.
Do not introduce Vite bundling, `vp pack`, Vitest, or a standalone TypeScript compiler as an alternative application toolchain.
The template's strictest and Node-TS configuration presets remain, with NSH's generated configuration last so application types come from NSH rather than Node globals.
The Just aliases exist for compatibility, including the existing workflow's `just ci` entry point.
Nix compiles only the small Swift helper and bundles the TypeScript application with the official NSH hosts.
It fetches the pinned llama.cpp release instead of compiling inference code.
The helper's contract tests use synthetic input and do not read another application's selection.
Keep workflow changes within the user's explicitly approved runner and timeout changes.
Do not add macOS jobs, application builds, all-system evaluation, or flake checks to GitHub Actions without a new request.

## Application architecture

### TS application boundary

TypeScript owns popup state, display mode, request replacement, stale and terminal event handling, copy actions, and view rendering.
Use Effect services, scoped fibers, validated schemas, and Effect collection and string utilities instead of manual Promise orchestration or JavaScript standard-library collection helpers.
Keep unavoidable NSH Promise and UI APIs in boundary adapters.
Use one application-lifetime runtime, dispose its scope on teardown, and do not create a runtime per render.
Provider deltas use bounded, lossless transport.
Complete view snapshots may coalesce, but cancellation and replacement must not wait behind a full delta queue.

Use the official NSH components and native Tailwind `class` support.
Use NSH `Scroll`, not browser overflow behavior.
Markdown uses the standard NSH `TextView`, with literal HTML, disabled math, non-opening links, alt-only images, and plain code-block rendering without syntax highlighting.
Plain mode switches both panes without modifying stored source or translation text.
Copy always uses the raw domain text, not rendered Markdown.
Do not reintroduce an application CSS stylesheet, a custom Markdown parser, or a browser renderer.

### Local translation boundary

TypeScript owns translation, model selection, automatic download, prompt formatting, streaming, cancellation, and the batch CLI.
Use the real `effect/ai` `LanguageModel` adapter for the packaged official llama-server instead of a decorative AI dependency.
Run configuration and translation directly in NSH through the reusable Effect Platform layer.
Use compatible NSH modules only where their behavior has been verified in the official host.
NSH 0.5.0 is not a complete Node runtime: large-file streams, secure exclusive filesystem creation, and parent CLI handles are missing.
Use fixed packaged curl/coreutils commands for bounded model I/O and narrow atomic file operations.
Do not load a complete GGUF into the JS heap or emulate streaming by reading the whole file.
Unsupported Platform methods must fail explicitly.
No runtime Node process, custom JavaScript host, or custom Rust module is required.
Preserve scoped stream backpressure and independent cancellation without a JSON sidecar protocol.
Write download notices and diagnostics to stderr, never to the protocol or batch translation stdout.
Application teardown must release the active HTTP request and owned inference server.
The server binds only to `127.0.0.1` on a kernel-selected port.
Use a new random authentication key for each server, stored in a private temporary file rather than a command-line argument.
Keep server diagnostics out of protocol stdout and public failures.
Do not connect to caller-selected or hosted inference endpoints.

Pin the default official PFN GGUF revision and SHA-256.
Automatically resume supported byte-range model downloads and verify the complete artifact before publishing it in the cache.
Keep model weights in the user's cache, not the Nix store or repository.
An offline cache hit must not contact Hugging Face.
Use the exact packaged llama-server path and disable implicit engine compilation or downloads.
Keep untrusted source text separate from trusted PFML3 special tokens, add BOS once, and suppress protocol stop tokens.
Reject unsupported languages, context overflow, and output truncation instead of reporting a successful partial file.
Use the publisher's model license notice without registering the user or accepting commercial terms on their behalf.

### macOS helper boundary

Accessibility runs in a separate, one-shot Swift executable, not in NSH or Node.
Use Apple's ApplicationServices APIs directly without a third-party ABI bridge.
The helper supports nonprompting permission inspection and selected-text capture with a bounded JSON response.
It must not install another GUI loop, change privacy settings, simulate copy keystrokes, or modify the clipboard.
Return stable public error codes rather than native error details.
Capture the previous application's selection before showing or activating the popup.
Keep the process launcher injectable so another OS implementation can replace it.

TypeScript owns desktop configuration parsing, validation, default-file creation, and autostart file operations inside NSH.
Standard clipboard, window, application, shortcut, and tray controls use NSH's JavaScript APIs.
The installed launchers set immutable executable paths rather than depending on the caller's working directory.
Grant only the required executables in NSH's process capabilities.
Forward only the environment variables required for runtime, cache, and configuration paths.
Namespace translation request IDs by connection so a reloaded controller cannot alias a previous request.
Release child processes and shortcut registrations when the connection scope closes.
A delayed old scope must not unregister a newer scope's resources.

### Terminal UI

Use the official NSH TUI backend, not a second terminal renderer.
Use the separate `terminal/App.tsx` entry and `terminal/nsh.json` without a `rust` declaration.
Do not import `glossshift/native`, unsupported Node APIs, or a native Node addon into the terminal dependency graph.
The terminal entry uses NSH's official prebuilt host and must not generate a `terminal/.nsh/rust` workspace.
Use the same injected NSH Platform services as the desktop entry.
The installed launcher sets immutable paths and overrides caller-supplied values.
Share the Effect controller, local translation transport, Markdown/plain behavior, and raw-copy semantics with the desktop app.
Inject typed terminal input instead of capturing another application's selection.
Do not initialize AppKit, global hotkeys, tray resources, or desktop menus from terminal startup.
Use the official terminal clipboard and lifecycle APIs.
Keep batch `gshift` output compatible with existing files and pipelines.
Run terminal interaction tests through `nsh test --target tui`, which exercises the official TestBackend.
Do not pass `setViewport` to that backend; choose the initial dimensions in `open`.
The terminal screenshot format is cell JSON, not a pixel image.
Do not invent an NSH terminal package target when the pinned upstream release does not provide one.

### macOS lifecycle

Support Apple Silicon macOS only until platform scope explicitly expands.
Keep NSH's AppKit event loop and delegate.
The maintained [upstream difference record](docs/upstream-differences.md) identifies the exact release and the retained plist parser patch.
The official NSH executables and runtime source are unmodified.
Use standard window attributes and scoped JS controls instead of a custom native setup hook.
Closing the popup hides it without destroying the engine, and reopening reveals the retained state.
Background startup must not briefly activate and hide a window.

## Configuration

TypeScript in NSH reads `~/.config/glossshift/config.toml`, honoring `XDG_CONFIG_HOME`, for window and shortcut settings.
The desktop TypeScript adapter converts configured shortcuts to NSH's standard shortcut notation before registration.
TypeScript in NSH reads local translation settings from `~/.config/glossshift/local.json`, honoring `XDG_CONFIG_HOME` or the explicit absolute `GLOSSSHIFT_CONFIG` path.
The local model cache honors `XDG_CACHE_HOME` and can be changed in local settings.
Do not read or modify `~/.agents` or legacy provider credentials.
Treat configuration, shortcuts, native selection, process frames, model metadata, and model output as untrusted boundary input.
Tests must use isolated temporary settings and synthetic source text, never the developer's private configuration or selected content.
Real default-model tests must disclose the network download and distinguish inference acceptance from protocol fixtures.

## CLI contract

`gshift` without arguments, or with `--tui`, starts the official NSH terminal host in the installed package.
The wrapper forwards file and option invocations to the official headless host and shared TypeScript batch entry.
Pass arguments as JSON and the original working directory explicitly.
Resolve relative inputs through the injected Path service before filesystem calls.
Capture stdout, stderr, and completion status in a private wrapper-owned directory, then validate and return the status.
Never forward host diagnostics or terminal control sequences as translation stdout.
`gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]` retains its existing behavior.
Resolve every sibling output and reject input/output collisions before loading configuration or a model.
Preserve ordered `.md` and `.mbt.md` processing, normalized language suffixes, and safe forced replacement of symlinks without changing their targets.
File outputs and redirected automatic-color stdout must remain free of ANSI escapes.
Batch stdout is buffered until the headless process completes; do not describe it as parent-pipe streaming.
The captured plain translations contain no inserted separators.
Terminal automatic color and forced color buffer each completed translation before rendering.
Color styles the complete output without parsing Markdown or adding syntax highlighting.
Desktop, terminal UI, and batch CLI share the same local model, source language, prompt format, and token limits.

## Verification and maintenance

- Run application behavior tests through NSH, not Node or a copied controller harness.
- Check real Vite+ task delegation, official prebuilt host selection, native packaging, and the retained CLI independently.
- A successful NSH bundle is not proof that the native application, CLI package, or Nix derivation works.
- Use injected stream fixtures for deterministic cancellation and backpressure checks, then exercise real GGUF inference through installed NSH batch and TUI entries.
- Verify installed Nix executables start the packaged server and translate with the real model, not just that packaging completes.
- Distinguish synthetic protocol tests from actual model inference and headless layout from native visual review.
- If Accessibility or screen permissions block an end-user check, report the boundary and stop attempts to bypass it.
- Keep helper builds separate from TypeScript bundling, with no dependency on generated NSH Rust workspaces.
- Keep production source files below 250 lines when practical and preserve module responsibilities.
- Preserve the template's package-manager pin, release-age waiting period, strict age checking, and denied lifecycle builds.
- Do not commit credentials or generated `.nsh`, `node_modules`, target directories, benchmark fixtures, or temporary reports.
- Keep source, configuration, commit messages, and canonical documentation in English.
- Regenerate Japanese documents with the GlossShift CLI: `gshift README.md AGENTS.md --lang ja --force`.
- If the CLI is not installed, use the project task: `vp run cli -- README.md AGENTS.md --lang ja --force`.
- Do not use `mdt` for this repository's translations.
- If generation is blocked, record it instead of manually fabricating generated output.
- Keep `AGENTS.md` canonical and do not create a separate `CLAUDE.md`.

_This AGENTS.md was generated from the [share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) and [AGENTS template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/agents/template.md)._
