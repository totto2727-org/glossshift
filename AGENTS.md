# GlossShift

## Repository structure

```text
App.tsx                     NSH entry in the same directory as nsh.json
src/domain.ts               Pure popup states, messages, and transitions
src/controller.ts           Effect-owned request lifetimes and bounded event processing
src/ports.ts                Injectable native services and public settings
src/                        NSH views, process adapters, and application tests
cli/main.ts                 Native Node.js 26 CLI entry
nix/gshift.nix              Independent CLI package without NSH or Swift
src/desktop-controls.ts     Standard NSH clipboard, window, application, and tray APIs
helper/Selection.swift      Injectable macOS Accessibility selection boundary
helper/main.swift           One-shot JSON command entry
nix/macos-helper.nix        Production-only small Swift helper build
flake.nix                   Isolated Nixpkgs unstable pin for Metal-enabled llama-cpp
runtime/main.ts             Declarative Effect 4 CLI command and batch policy
platform/                   Effect services backed by NSH and bounded file utilities
platform.ts                 Public NSH Effect Platform composition
runtime/platform.ts         GlossShift GUI environment composition
runtime/desktop-config.ts      Non-destructive TOML settings and validation
runtime/autostart.ts           Safe macOS LaunchAgent file operations
runtime/translation.ts         Scoped Effect AI local translation service
runtime/model.ts               Verified automatic GGUF download and cache reuse
runtime/server.ts              Private llama-server process lifetime and authentication
runtime/server-api.ts          Validated loopback HTTP and bounded SSE
runtime/generation.ts          Bounded generation and prompt tokenization
runtime/prompt.ts              PFML3 prompt and supported-language validation
runtime/config.ts              Local model selection and configuration validation
runtime/models.ts              Pinned PLaMo model presets and operating budgets
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
Enter `nix develop` to prepare Node.js 26, the pinned official NSH 0.5.0 tools for the GUI, the Swift helper, the official llama-server, curl, coreutils, and Vite+.
Keep official NSH release components on the same exact revision with content hashes.
Then install JavaScript dependencies with `vp install --frozen-lockfile`.
All application manifests omit `rust`, so NSH uses its official prebuilt hosts.
Do not add custom Rust host dependencies or generated source checkouts to restore an API that a separate helper or the standard JS API can provide.

| Command                                  | Responsibility                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `vp install --frozen-lockfile`           | Install the locked package graph through Vite+.                                      |
| `vp run check`                           | Check formatting and lint without a second typechecker.                              |
| `vp run fix`                             | Apply Vite+ formatting and lint fixes.                                               |
| `vp run typecheck`                       | Check the GUI and native CLI with their respective TypeScript configurations.        |
| `vp run dev`                             | Delegate development and reload to NSH's macOS host.                                 |
| `vp run run`                             | Run the application through NSH.                                                     |
| `vp run build`                           | Produce the NSH release bundle, not an installable application.                      |
| `vp run package`                         | Package the native macOS application through NSH.                                    |
| `vp run test`                            | Run application tests through the official NSH test host.                            |
| `vp run test-platform`                   | Exercise isolated filesystem, configuration, process, and capture boundaries in NSH. |
| `vp run test-inference`                  | Check compatible crypto and direct HTTP/SSE behavior in NSH.                         |
| `vp run test-cli`                        | Run native CLI contracts and filesystem tests through Vite+ and Vitest.              |
| `vp run test-packaging`                  | Check installed package boundaries and native CLI execution.                         |
| `vp run test-local-model`                | Opt in to real-model translation with isolated configuration.                        |
| `vp run cli -- FILES... --lang LANGUAGE` | Run the native Effect 4 CLI on Node.js 26.                                           |
| `vp run ci`                              | Run the minimal formatting and lint gate.                                            |

Vite+ owns installation, task orchestration, formatting, lint, and native CLI tests through Vitest.
Use NSH for GUI bundling, execution, and behavior tests, not Vite bundling or a second GUI host.
Keep the strictest and Node-TS configuration presets and separate host-specific type boundaries.
NSH's generated configuration supplies GUI types, while the native CLI uses its Node configuration.
The Just aliases exist for compatibility, including the existing workflow's `just ci` entry point.
Nix compiles the small Swift helper separately and bundles the GUI with the official NSH host.
`nix/gshift.nix` packages `cli/main.ts`, shared runtime modules, and production dependencies for Node.js 26 without NSH or Swift.
The combined `glossshift` package links this standalone CLI, so its closure includes Node even though the GUI never starts Node.
It uses the unmodified `llama-cpp` package from the separately pinned Nixpkgs unstable input.
Confirm that the exact macOS arm64 derivation is available from the binary cache before changing that pin.
Do not override the package merely to change a local build preference, because this can invalidate its substitute.
Distribution source inputs exclude all tests, test helpers, and fixtures.
Run all type checks and tests through development tasks, outside package derivations.
Do not add check or test phases to the Nix derivations.
Use `vp run test-helper` for the Swift helper contract tests outside the package build.
Ruby is not permitted.
Do not add standalone test scripts or hand-maintained JavaScript test bundles.
Use the official NSH test framework for GUI behavior, native Vitest through Vite+ for CLI behavior, and reusable `.test` helpers.
Mark test-only modules and assets with `.test`, including `.test.fixture` modules and test-only directories.
Keep these names outside production source inputs.
The helper's contract tests use synthetic input and do not read another application's selection.
Keep workflow changes within the user's explicitly approved runner and timeout changes.
Do not add macOS jobs, application builds, all-system evaluation, or flake checks to GitHub Actions without a new request.

## Application architecture

### TS application boundary

Do not create `index.ts` or `index.tsx` modules.
Use a named module beside its child directory, such as `platform.ts` and `platform/NshFileSystem.ts`.
Keep the Platform implementation independent of GlossShift policy so it can be extracted as a library.
Pass working directories, tools, configuration providers, and Stdio layers explicitly through `platform.ts`.
Keep application environment interpretation in `runtime/platform.ts`.
Document supported services and explicit NSH limitations in `platform/README.md`.

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
Run GUI configuration and translation directly in NSH through the reusable Effect Platform layer.
Run the independent CLI through native Node Effect services, without importing NSH or Swift.
Use compatible NSH modules only where their behavior has been verified in the official host.
NSH 0.5.0 is not a complete Node runtime: large-file streams, secure exclusive filesystem creation, and parent CLI handles are missing.
Use fixed packaged curl/coreutils commands for bounded model I/O and narrow atomic file operations.
Do not load a complete GGUF into the JS heap or emulate streaming by reading the whole file.
Unsupported Platform methods must fail explicitly.
The GUI requires no runtime Node process, custom JavaScript host, or custom Rust module.
Preserve scoped stream backpressure and independent cancellation without a JSON sidecar protocol.
Write download notices and diagnostics to stderr, never to the protocol or batch translation stdout.
Application teardown must release the active HTTP request and owned inference server.
The server binds only to `127.0.0.1` on a kernel-selected port.
Use a new random authentication key for each server, stored in a private temporary file rather than a command-line argument.
Keep server diagnostics out of protocol stdout and public failures.
Do not connect to caller-selected or hosted inference endpoints.

Pin the default official PFN GGUF revision and SHA-256.
Keep supported PLaMo 0.8B, 2B, 8B, and 31B presets in code with immutable URLs, full digests, and actual full per-model context limits.
Calculate the completion budget from the remaining context after prompt tokenization, optionally reduced by an explicit output limit.
Do not restore artificial 8192-token context defaults, 4096-token output defaults, or a global 32768-token cap.
Do not download or run larger models merely to check preset metadata.
Do not require a configuration file to choose a built-in model.
Require explicit `contextSize` for an unknown custom model digest rather than borrowing the default PLaMo budget.
Identify known preset artifacts by digest, so a matching artifact selected through a `file:` URI still defaults to its full model maximum.
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

### Native CLI

Use `cli/main.ts` as the independent Node.js 26 entry and `runtime/main.ts` for the declarative Effect 4 CLI command.
Keep NSH, Swift, AppKit, global hotkeys, and tray resources outside the CLI dependency graph and package closure.
Use native arguments, working directory, standard streams, signals, and exit status.
Do not restore the shell capture bridge, `gshift-launcher.sh`, a Nix batch launcher, or the deleted `batch/` and `terminal/` products.
No arguments show help, and `--tui` is rejected.
Keep the desktop launch separate.
Share translation and configuration policy through Effect services, while retaining host-specific Platform implementations.
Test native CLI behavior through Vite+ and Vitest with reusable `.test` helpers.

### macOS lifecycle

Support Apple Silicon macOS only until platform scope explicitly expands.
Keep NSH's AppKit event loop and delegate.
The maintained [dependency compatibility record](docs/dependency-compatibility.md) identifies the exact release and the retained plist parser patch.
The official NSH executables and runtime source are unmodified.
Use standard window attributes and scoped JS controls instead of a custom native setup hook.
Closing the popup hides it without destroying the engine, and reopening reveals the retained state.
Background startup must not briefly activate and hide a window.

## Configuration

TypeScript in NSH reads `~/.config/glossshift/config.toml`, honoring `XDG_CONFIG_HOME`, for window and shortcut settings.
The desktop TypeScript adapter converts configured shortcuts to NSH's standard shortcut notation before registration.
The shared runtime reads local translation settings from `~/.config/glossshift/local.json`, honoring `XDG_CONFIG_HOME` or the explicit absolute `GLOSSSHIFT_CONFIG` path.
The local model cache honors `XDG_CACHE_HOME` and can be changed in local settings.
Do not read or modify `~/.agents` or legacy provider credentials.
Treat configuration, shortcuts, native selection, process frames, model metadata, and model output as untrusted boundary input.
Tests must use isolated temporary settings and synthetic source text, never the developer's private configuration or selected content.
Real default-model tests must disclose the network download and distinguish inference acceptance from protocol fixtures.

## CLI contract

`gshift` without arguments shows help without loading configuration or a model.
`--tui` is rejected rather than starting an interactive host.
The declarative Effect 4 command uses native Node arguments, working directory, standard streams, and completion status.
Resolve relative inputs through the injected Path service before filesystem calls.
Keep diagnostics and terminal control sequences out of plain translation stdout.
`gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]` retains its existing behavior.
Resolve every sibling output and reject input/output collisions before loading configuration or a model.
Preserve ordered `.md` and `.mbt.md` processing, normalized language suffixes, and safe forced replacement of symlinks without changing their targets.
File outputs and redirected automatic-color stdout must remain free of ANSI escapes.
Plain translations contain no inserted separators.
Terminal automatic color and forced color buffer each completed translation before rendering.
Color styles the complete output without parsing Markdown or adding syntax highlighting.
Desktop and native CLI share the same local model, source language, prompt format, and token-budget policy.

## Reproduce cached-model acceptance

Run from the repository root inside `nix develop` after installing the locked dependencies.
The opt-in suite in `packaging/Inference.test.ts` uses isolated temporary settings and accepts only an existing `file:` GGUF URI, so it cannot download model weights.
First obtain the 0.8B artifact through the normal verified application download if it is not already cached.
That initial download requires network access and approximately 573 MB of disk space.
Do not download larger presets for this check.

Create an isolated JSON configuration at `tmp/local-model.test.json` with a `model` object containing the cached artifact's absolute `file:` URI, pinned `sha256`, and `prompt: "plamo"` from `runtime/models.ts`.
Omit `contextSize` and `maxTokens` for the known 0.8B digest to exercise the full 262144-token default and dynamic completion budget.
Do not point this test at private user configuration.
Then run:

```bash
GLOSSSHIFT_TEST_MODEL_CONFIG="$PWD/tmp/local-model.test.json" \
GLOSSSHIFT_TEST_LLAMA_SERVER="$(command -v llama-server)" \
GLOSSSHIFT_COREUTILS="$(command -v coreutils)" \
GLOSSSHIFT_TEST_INSTALLED="$(nix build .#gshift --no-link --print-out-paths)/bin/gshift" \
vp run test-local-model
```

The native suite verifies Metal startup with production server arguments, real Japanese and English translations, file safety, and cancellation cleanup.
The installed suite exercises the independently packaged CLI, while the duplicate installed GPU diagnostic is intentionally skipped.
Without the opt-in environment variables, real-model suites skip rather than download weights.
These checks do not fill the context with a 262144-token prompt or establish performance results.
Check the GUI separately, and stop if macOS permission requirements block selection or interaction.

To opt in to installed package and closure checks, run:

```bash
GLOSSSHIFT_TEST_INSTALLED="$(nix build .#gshift --no-link --print-out-paths)/bin/gshift" \
GLOSSSHIFT_TEST_GUI_PACKAGE="$(nix build .#glossshift --no-link --print-out-paths)" \
vp run test-packaging
```

Set optional `GLOSSSHIFT_TEST_GUI_SOURCE` and `GLOSSSHIFT_TEST_CLI_SOURCE` to the filtered source paths obtained through Nix evaluation of the corresponding package's `src` attribute to check test and fixture exclusion.
Set optional `GLOSSSHIFT_TEST_MACOS_HELPER` to the built helper's absolute executable path to check its nonprompting permission response.
For Apple Silicon, evaluate `.#packages.aarch64-darwin.glossshift.src` and `.#packages.aarch64-darwin.gshift.src` with `nix eval --raw`, and build `.#glossshift-macos-helper` for its `bin/glossshift-macos-helper` path.
These packaging checks do not grant Accessibility permission or exercise actual selection capture.

## Verification and maintenance

- Run GUI behavior tests through NSH and native CLI tests through Vite+ and Vitest, not a copied controller harness.
- Check real Vite+ task delegation, official prebuilt host selection, native packaging, and the retained CLI independently.
- A successful NSH bundle is not proof that the native application, CLI package, or Nix derivation works.
- Use injected stream fixtures for deterministic cancellation and backpressure checks, then exercise real GGUF inference through the installed native CLI and GUI.
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
