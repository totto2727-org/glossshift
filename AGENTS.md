# GlossShift

## Repository structure

```text
App.tsx                     NSH entry in the same directory as nsh.json
src/domain.ts               Pure popup states, messages, and transitions
src/controller.ts           Effect-owned request lifetimes and bounded event processing
src/ports.ts                Injectable native services and public settings
src/                        NSH views, native-module adapters, and application tests
native/Cargo.toml           Rust native bridge and gshift package
native/Cargo.lock           Locked Rust dependencies
native/src/bridge.rs        Typed NSH module exports
native/src/bridge_types.rs  Non-secret values crossing the TS/Rust boundary
native/src/desktop.rs       macOS service startup and shutdown
native/src/selection.rs     Accessibility and clipboard selection capture
native/src/platform.rs      Selection and permission interfaces
native/src/llm.rs           Rig translation stream and cancellation
native/src/config.rs        XDG settings and non-destructive provider migration
native/src/prompt.rs        Shared translation prompts
native/src/cli.rs           CLI language, path, and ANSI Markdown helpers
native/src/bin/gshift.rs    Ordered Markdown translation CLI
native/tests/              Real CLI and HTTP-boundary regression tests
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
| `vp run typecheck`                       | Delegate to `nsh check .`, including native declarations and NSH's TypeScript compiler.           |
| `vp run dev`                             | Delegate development and reload to NSH's macOS host.                                              |
| `vp run run`                             | Run the application through NSH.                                                                  |
| `vp run build`                           | Produce the NSH release bundle, not an installable application.                                   |
| `vp run package`                         | Package the native macOS application through NSH.                                                 |
| `vp run test`                            | Run application tests through the official NSH test host.                                         |
| `vp run tui`                             | Run the shared TS application through NSH's official terminal host.                               |
| `vp run test-tui`                        | Run the dedicated terminal interaction suite through NSH's official TestBackend.                  |
| `vp run test-native`                     | Run Rust library, CLI, and local HTTP transport regressions.                                      |
| `vp run test-lifecycle`                  | Opt in to a real AppKit window lifecycle check without reading credentials or other applications. |
| `vp run cli -- FILES... --lang LANGUAGE` | Run the retained Rust CLI.                                                                        |
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

### Rust boundary

The published [`llm-profiles`](https://crates.io/crates/llm-profiles) crate owns shared provider loading, validation, named credentials, and its optional Rig adapter.
Rust retains configuration migration, provider-specific headers and parameters, translation prompts and transport, native selection, hotkeys, tray, autostart, and the `gshift` CLI.
Credentials and secret headers never cross into view state or native-module bootstrap data.
Rig is retained for provider and CLI parity, not because NSH lacks streaming HTTP primitives.
Replacing it with Effect AI requires proving compatible base URLs, parameters, header substitution, cancellation, both timeout classes, and CLI behavior first.

The NSH module exports typed data and bounded pull-based events.
Decode unknown data at the TS boundary, attach a request ID to every stream event, and reject stale or terminal generations.
Native asynchronous functions must not block the JS engine thread or move JS callbacks across threads.
A pending native receive belongs to an explicit transport session and must be released or invalidated during reload and shutdown.
Opening a new session cancels old pending receivers, and closing an old session must not close a newer session.
Namespace translation request IDs by session so a reloaded controller cannot alias a previous request.
Project provider failures to allowlisted public messages instead of returning raw errors, response bodies, headers, or configuration parse context to the UI.
Capture the previous application's selection before showing or activating the popup.
Native selection and permission interfaces remain injectable for another OS implementation without introducing another GUI event loop.

### Terminal UI

Use the official NSH TUI backend, not a second terminal renderer.
Select terminal behavior with `platform.idiom === 'terminal'`; the operating system remains macOS and `nsh/desktop.isAvailable` alone does not distinguish a terminal host.
Share the Effect controller, provider transport, Markdown/plain behavior, and raw-copy semantics with the desktop app.
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

## Configuration and credentials

The application configuration root uses `xdg::BaseDirectories`, defaults to `~/.config/glossshift`, and honors `XDG_CONFIG_HOME`.
Shared providers live in `~/.agents/config.toml`, with named keys in `~/.agents/credentials.toml` and permissions `0600`.
`AGENTS_CONFIG` selects an absolute shared configuration path, with credentials beside it.
Do not search the current directory for credentials.
Legacy migration preserves original GlossShift files and never overwrites existing shared files.

Provider resolution must preserve the active provider, custom compatible API prefixes, positive first-chunk and idle timeouts, request parameters, and one UUID substitution for `${session_id}` headers per translation.
Cancel a previous request during connection establishment and while backpressured, not only after the provider produces a delta.
The provider idle timeout excludes time waiting for the downstream consumer to accept a text delta.
Treat TOML, shortcut strings, native selection values, and HTTP data as untrusted input.
Tests must use isolated temporary settings and synthetic credentials, never the developer's home configuration.

## CLI contract

`gshift` without arguments, or with `--tui`, starts the official NSH terminal host in the installed package.
The wrapper forwards file and option invocations to the retained batch binary.
`gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]` retains its existing behavior.
Resolve every sibling output and reject input/output collisions before loading configuration or contacting a provider.
Preserve ordered `.md` and `.mbt.md` processing, normalized language suffixes, and safe forced replacement of symlinks without changing their targets.
File outputs and redirected automatic-color stdout must remain free of ANSI escapes.
Plain stdout streams provider deltas without inserted separators.
Terminal automatic color and forced color buffer each completed translation before Tree-sitter rendering.
Desktop and CLI share configuration, credentials, prompts, parameters, and timeout semantics.

## Verification and maintenance

- Run application behavior tests through NSH, not Node or a copied controller harness.
- Check real Vite+ task delegation, generated native declarations, native packaging, and the retained CLI independently.
- A successful NSH bundle is not proof that the native application, CLI package, or Nix derivation works.
- Use real local HTTP/SSE fixtures to verify transport boundaries without contacting a paid model.
- Distinguish synthetic-provider tests from actual provider acceptance and headless layout from native visual review.
- If Accessibility or screen permissions block an end-user check, report the boundary and stop attempts to bypass it.
- Keep Rust `unsafe_code = "forbid"` and strict Clippy rules.
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
