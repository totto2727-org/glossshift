# GlossShift

## Repository structure

```text
App.tsx                     NSH entry in the same directory as nsh.json
src/domain.ts               Pure popup states, messages, and transitions
src/controller.ts           Effect-owned request lifetimes and bounded event processing
src/ports.ts                Injectable native services and public settings
src/                        NSH views, native-module adapters, and application tests
native/Cargo.toml           Rust macOS service bridge
native/Cargo.lock           Locked native dependencies
native/src/bridge.rs        Typed NSH module exports
native/src/bridge_types.rs  Non-secret values crossing the TS/Rust boundary
native/src/desktop.rs       macOS service startup and shutdown
native/src/selection.rs     Accessibility and clipboard selection capture
native/src/platform.rs      Selection and permission interfaces
native/src/config.rs        Non-destructive XDG shortcut and window settings
native/src/runtime.rs       Installed Node runtime location
node/main.ts                Node batch and private sidecar entry
node/translation.ts         Scoped Effect AI local translation service
node/model.ts               Verified automatic GGUF download and native model lifetime
node/generation.ts          Bounded token generation and prompt tokenization
node/prompt.ts              PFML3 prompt and supported-language validation
node/config.ts              Local model settings and pinned default artifact
node/sidecar.ts             Acknowledged private NDJSON transport
nsh.json                    Native module, application identity, and entry metadata
vite.config.ts              Vite+ formatting, lint, and delegated task definitions
pnpm-workspace.yaml         Catalog, package-manager policy, and release-age safeguards
patches/                    Minimal NSH operational compatibility patch
packaging/                  macOS application metadata and assets
flake.nix                   Pinned development tools and Darwin package outputs
package.nix                 Native application packaging
Justfile                    Compatibility aliases into Vite+ tasks
```

## Development commands

Run commands from the repository root.
Enter `nix develop` to prepare the pinned NSH 0.5.0 release, matching terminal component, Rust tools, Vite+, and patched NSH source dependency.
Keep the source, CLI, and terminal component on the same exact release revision with content hashes.
Then install JavaScript dependencies with `vp install --frozen-lockfile`.
Do not point committed manifests at benchmark fixtures, arbitrary sibling checkouts, or developer-specific absolute paths.
The generated `.nsh/upstream` dependency is prepared from the pinned source and maintained patch, not from a mutable sibling repository.

| Command                                  | Responsibility                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `vp install --frozen-lockfile`           | Install the locked package graph through Vite+.                                                   |
| `vp run check`                           | Check formatting and lint without a second typechecker.                                           |
| `vp run fix`                             | Apply Vite+ formatting and lint fixes.                                                            |
| `vp run typecheck`                       | Check the NSH application and Node project through NSH's TypeScript compiler.                     |
| `vp run dev`                             | Delegate development and reload to NSH's macOS host.                                              |
| `vp run run`                             | Run the application through NSH.                                                                  |
| `vp run build`                           | Produce the NSH release bundle, not an installable application.                                   |
| `vp run package`                         | Package the native macOS application through NSH.                                                 |
| `vp run test`                            | Run application tests through the official NSH test host.                                         |
| `vp run tui`                             | Run the shared TS application through NSH's official terminal host.                               |
| `vp run test-tui`                        | Run the dedicated terminal interaction suite through NSH's official TestBackend.                  |
| `vp run test-node`                       | Run isolated Node engine tests through an official NSH process fixture.                           |
| `vp run test-cli`                        | Check batch contracts and real filesystem behavior through NSH.                                   |
| `vp run test-local-model`                | Opt in to production TUI translation with real model weights and isolated configuration.          |
| `vp run test-native`                     | Run Rust OS-service and native-boundary regressions.                                              |
| `vp run test-lifecycle`                  | Opt in to a real AppKit window lifecycle check without reading credentials or other applications. |
| `vp run cli -- FILES... --lang LANGUAGE` | Run the Node TypeScript batch CLI.                                                                |
| `vp run ci`                              | Run the minimal formatting and lint gate.                                                         |

Vite+ owns installation, task orchestration, formatting, and lint only.
Do not introduce Vite bundling, `vp pack`, Vitest, or a standalone TypeScript compiler as an alternative application toolchain.
The template's strictest and Node-TS configuration presets remain, with NSH's generated configuration last so application types come from NSH rather than Node globals.
The Just aliases exist for compatibility, including the existing workflow's `just ci` entry point.
Native Cargo tasks share the repository-root `target` directory with NSH's generated hosts instead of creating a second build cache under `native/target`.
The lifecycle check briefly shows and activates its own verification window, then checks close, reopening, and shutdown.
It is a local opt-in check, not part of CI.
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
Use the real `effect/ai` `LanguageModel` adapter for node-llama-cpp instead of a decorative AI dependency or a remote HTTP server.
NSH runs QuickJS, so Node APIs and the native llama addon stay in a dedicated Node process.
Keep Node imports out of the NSH application dependency graph.
Connect that process with private, schema-validated NDJSON over stdin and stdout.
Acknowledge started and delta frames only after the consumer takes them, and keep cancellation independent of a full stream queue.
Write download notices and diagnostics to stderr, never to the protocol or batch translation stdout.
Application teardown must release its process, active generation, context, model, and native llama runtime.

Pin the default official PFN GGUF revision and SHA-256.
Use `createModelDownloader` for automatic, resumable model downloads and verify the complete artifact before loading it.
Keep model weights in the user's cache, not the Nix store or repository.
An offline cache hit must not contact Hugging Face.
Use `getLlama` with the packaged native prebuild and disable implicit source compilation and binary downloads.
Keep untrusted source text separate from trusted PFML3 special tokens, add BOS once, and suppress protocol stop tokens.
Reject unsupported languages, context overflow, and output truncation instead of reporting a successful partial file.
Use the publisher's model license notice without registering the user or accepting commercial terms on their behalf.

### Rust boundary

Rust owns only macOS integration, window and shortcut settings, typed OS controls, and locating the installed Node runtime.
Keep translation, shared provider credentials, remote API clients, model inference, and the batch CLI out of Rust.
The runtime locator reads immutable installed metadata rather than depending on the caller's current directory.
Grant the exact packaged Node executable in NSH's process capabilities.
Forward only the environment variables required for home, cache, and configuration paths.

The NSH module exports typed data and bounded pull-based OS controls.
Decode unknown data at the TS boundary, attach a request ID to every stream event, and reject stale or terminal generations.
Native asynchronous functions must not block the JS engine thread or move JS callbacks across threads.
A pending native receive belongs to an explicit transport session and must be released or invalidated during reload and shutdown.
Opening a new session cancels old pending receivers, and closing an old session must not close a newer session.
Namespace translation request IDs by session so a reloaded controller cannot alias a previous request.
Project failures to public messages instead of exposing raw native errors, user text, environment values, or configuration parse context.
Capture the previous application's selection before showing or activating the popup.
Native selection and permission interfaces remain injectable for another OS implementation without introducing another GUI event loop.

### Terminal UI

Use the official NSH TUI backend, not a second terminal renderer.
Select terminal behavior with `platform.idiom === 'terminal'`; the operating system remains macOS and `nsh/desktop.isAvailable` alone does not distinguish a terminal host.
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
The maintained [NSH upstream difference record](docs/upstream-differences.md) explains the exact source revision and the narrow setup, shutdown, visibility, and window-bounds patch.
Native module registration must only register types and lifecycle function pointers.
It must not access the developer's configuration, request permissions, register hotkeys, or create tray resources while NSH describes exports or runs headless tests.
Initialize native services in the main-thread standalone setup hook and release them at shutdown.
Closing the popup hides it without destroying the engine, and reopening reveals the retained state.
Background startup must not briefly activate and hide a window.

## Configuration

Rust reads only `~/.config/glossshift/config.toml`, honoring `XDG_CONFIG_HOME`, for OS settings.
Node reads local translation settings from `~/.config/glossshift/local.json`, honoring `XDG_CONFIG_HOME` or the explicit absolute `GLOSSSHIFT_CONFIG` path.
The local model cache honors `XDG_CACHE_HOME` and can be changed in local settings.
Do not read or modify `~/.agents` or legacy provider credentials.
Treat configuration, shortcuts, native selection, process frames, model metadata, and model output as untrusted boundary input.
Tests must use isolated temporary settings and synthetic source text, never the developer's private configuration or selected content.
Real default-model tests must disclose the network download and distinguish inference acceptance from protocol fixtures.

## CLI contract

`gshift` without arguments, or with `--tui`, starts the official NSH terminal host in the installed package.
The wrapper forwards file and option invocations to the Node TypeScript batch entry.
`gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]` retains its existing behavior.
Resolve every sibling output and reject input/output collisions before loading configuration or a model.
Preserve ordered `.md` and `.mbt.md` processing, normalized language suffixes, and safe forced replacement of symlinks without changing their targets.
File outputs and redirected automatic-color stdout must remain free of ANSI escapes.
Plain stdout streams local model deltas without inserted separators.
Terminal automatic color and forced color buffer each completed translation before rendering.
Color styles the complete output without parsing Markdown or adding syntax highlighting.
Desktop, terminal UI, and batch CLI share the same local model, source language, prompt format, and token limits.

## Verification and maintenance

- Run application behavior tests through NSH, not Node or a copied controller harness.
- Check real Vite+ task delegation, generated native declarations, native packaging, and the retained CLI independently.
- A successful NSH bundle is not proof that the native application, CLI package, or Nix derivation works.
- Use protocol fixtures for deterministic cancellation and backpressure checks, then exercise real GGUF inference through the actual Node entry.
- Verify installed Nix executables load the packaged native addon and translate with the real model, not just that packaging completes.
- Distinguish synthetic protocol tests from actual model inference and headless layout from native visual review.
- If Accessibility or screen permissions block an end-user check, report the boundary and stop attempts to bypass it.
- Keep Rust `unsafe_code = "forbid"` and strict Clippy rules.
- Use `cargo fmt --manifest-path native/Cargo.toml --package glossshift`, not `--all`, to avoid formatting the managed NSH checkout.
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
