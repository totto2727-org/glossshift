# GlossShift

## Repository structure

```text
src/lib.rs            Shared public library modules
src/config.rs         XDG configuration and credential loading
src/prompt.rs         Translation prompt construction
src/llm.rs            Rig streaming worker and request events
src/cli.rs            Public CLI path, language, and Markdown rendering helpers
src/bin/gshift.rs     Markdown translation CLI binary
src/main.rs           GPUI desktop binary wiring
src/selection.rs      macOS Accessibility and clipboard fallback
src/ui.rs             GPUI popup view and actions
examples/              Starter TOML configuration and credentials
packaging/             macOS application metadata
Justfile               Local development and packaging recipes
flake.nix              Darwin packages, overlay, and development shell
package.nix            Nix Rust package definition
```

## Development commands

### Execution rules

- Run commands from the repository root.
- Support macOS only until the project explicitly expands its platform scope.
- Use the named Just recipes below instead of ad-hoc shell workflows; use Cargo directly only when a recipe cannot express the needed target.
- Keep source code, configuration examples, commit messages, and source documentation in English; `README.md` and `AGENTS.md` are canonical and their Japanese translations are generated with `mdt`.
- Do not create a separate `CLAUDE.md`; keep `AGENTS.md` as the canonical agent document.
- Never commit real credentials, log API keys, or weaken a failing test or lint.

### Standard tasks

- `just fix` — Apply formatting and Clippy fixes.
- `just fix-format` — Format all Rust sources with `cargo fmt --all`.
- `just fix-lint` — Apply Clippy fixes with all targets, features, and denied warnings.
- `just check` — Run format and Clippy checks.
- `just check-format` — Check Rust formatting without changing files.
- `just check-lint` — Run strict Clippy checks for every target and feature.
- `just test` — Run the Rust unit tests.
- `just build` — Build the debug binaries.
- `just ci` — Run the complete local check, test, and build gate.
- `just dev` — Run the desktop binary directly with Cargo.
- `just run` — Build, ad-hoc sign, verify, and open `target/GlossShift.app`.
- `just package-app` — Build and verify the local application bundle without opening it.
- `mdt --lang ja --force README.md` — Regenerate the Japanese README source output.
- `mdt --lang ja --force AGENTS.md` — Regenerate the Japanese AGENTS source output.

### CLI reference

Run the CLI from the repository root with `just cli FILES... --lang LANGUAGE [OPTIONS]`; the equivalent direct command is `cargo run --bin gshift -- FILES... --lang LANGUAGE [OPTIONS]`. The `gshift` binary always reuses the desktop application's XDG configuration, active provider, source language, timeout values, and named credential; it has no separate model, prompt, or token settings.

The positional `FILES...` accepts one or more Markdown files with `.md` or `.mbt.md` suffixes and preserves their input order. `--lang`/`-l` is required and accepts a non-empty ASCII language code containing only letters, digits, and internal hyphens; it is trimmed and lowercased before use. `--force`/`-f` permits replacing existing sibling outputs and conflicts with `--stdout`. `--stdout` writes translations to standard output instead of files. `--color auto|always|never` controls ANSI Markdown highlighting, requires `--stdout`, and defaults to `auto`.

Before loading configuration or translating, the CLI resolves every sibling output and rejects batches whose outputs collide with any input or with one another. Without `--stdout`, it creates one sibling path per input by inserting `.<language>` before `.md`, preserves the compound `.mbt.md` extension, and replaces an existing trailing `.ja` or `.en` segment. It refuses an existing output, including a symbolic link, unless `--force` is present. With `--force`, a symbolic link is removed and replaced by a regular output file without modifying its target. The CLI never writes ANSI escapes to files.

Inputs are translated sequentially in their command-line order. With `--stdout`, translation bodies are concatenated in that same order without inserted separators. With `--stdout --color auto`, redirected stdout remains byte-plain and each provider delta is flushed immediately, while terminal stdout buffers each translation until completion and then renders it with Tree-sitter Markdown ANSI styles. `--color never` keeps output plain and streamed even on a terminal. `--color always` buffers each completed translation and emits ANSI styles even when stdout is redirected.

Examples:

```bash
just cli README.md AGENTS.md --lang ja --force
just cli README.md AGENTS.md --lang ja --stdout
just cli README.md AGENTS.md --lang ja --stdout --color never
just cli README.md --lang ja --stdout --color always
```

### Configuration and credentials

The shared configuration root is resolved through `xdg::BaseDirectories`, defaults to `~/.config/glossshift`, and honors `XDG_CONFIG_HOME`. `config.toml` links `active_provider` to a named provider and each provider to a named credential in `credentials.toml`; credential permissions are always reset to `0600`. Treat shortcut strings, TOML content, Accessibility values, and HTTP responses as untrusted boundary input.

The active provider requires a non-empty `base_url` and `model`; its timeout defaults are 15 seconds for the first chunk and 30 seconds for stream idle periods. Optional `[providers.<name>.request_parameters]` JSON fields are forwarded unchanged through Rig. Shortcuts require unique hotkeys and non-empty target languages, and window dimensions must be positive and at least their configured minimums.

## Architecture

### Shared library boundary

The reusable library owns XDG configuration, prompt construction, and provider streaming so the desktop and CLI binaries use the same provider contract. `config.rs` keeps tokens separate from ordinary TOML, `prompt.rs` builds translation-only prompts, and `llm.rs` emits request-scoped `TranslationEvent` values.

### Desktop boundary

The GPUI application thread owns the popup entity, global-hotkey manager, window actions, and shared two-worker Tokio runtime. `selection.rs` is the only module that accesses macOS Accessibility and clipboard APIs; `ui.rs` is the only module that mutates GPUI view state. The popup keeps its window alive when closed, cancels older streams when a newer shortcut starts, and ignores events whose `RequestId` is stale.

### CLI boundary

`cli.rs` owns language validation, Markdown sibling-path resolution, batch output preflight, and Tree-sitter ANSI rendering. `gshift` owns ordered file/stdout I/O and feeds each input sequentially to the shared `llm::translate` function. Bounded channels isolate the desktop UI and streaming worker, and cancellation is observed at the provider stream boundary.

### Packaging boundary

Both binaries are included in the Rust and Nix package outputs. The default flake overlay publishes `glossshift` and `gshift` with matching `meta.mainProgram` values, and the package derivation exposes the desktop binary through a stable `GlossShift.app` bundle layout.

## Development tools

- **Rust and Cargo**: Compile, test, format, and lint the 2024-edition package with `unsafe_code` forbidden and strict Clippy lints.
- **Just**: Provides the repository's named development, validation, CLI, and macOS packaging workflows.
- **Nix flakes**: Provide Darwin package outputs, the reusable overlay, and a development shell with the Rust toolchain and Just; run `nix develop` before the named recipes when those tools are not installed locally.
- **mdt**: Generates the Japanese source-document translations with the configured OpenCode or Codex adapter.
- **GPUI**: Supplies the native-title-bar, resizable desktop popup and application-thread UI model.
- **Rig**: Supplies OpenAI Chat Completions streaming, including custom compatible base URLs.
- **global-hotkey and macOS Accessibility crates**: Provide global shortcut registration and safe selection capture boundaries.
- **Tree-sitter**: Provides Markdown syntax highlighting for colorized terminal output.

## Package-specific rules

- Keep production source files below 250 lines when practical and preserve the existing module responsibility boundaries.
- Use bounded channels across callback, UI, CLI, and network boundaries, and attach a request ID to every streaming event.
- Cancel the active stream before starting a newer translation and do not allow stale events to overwrite current UI state.
- Keep ANSI escapes out of generated files and redirected stdout in automatic color mode.
- Regenerate and commit `README.ja.md` and `AGENTS.ja.md` with `mdt --lang ja --force README.md` and `mdt --lang ja --force AGENTS.md` beside their English sources after either source document changes.
- Preserve the relative links in both source documents and the exact share-artifact provenance footer at the end of each English source.

_This AGENTS.md was generated from the [share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) and [AGENTS template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/agents/template.md)._
