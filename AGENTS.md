# Repository instructions

## Language and documentation

- Use English for source code, configuration examples, commit messages, and source documentation.
- `README.md` and `AGENTS.md` are the source documents.
- Generate `README.ja.md` and `AGENTS.ja.md` with `mdt --lang ja --force <file>` after changing either source document.
- Keep generated Japanese documents synchronized with their English sources.

## Scope

- Support macOS only until the project explicitly expands its platform scope.
- Use GPUI for the desktop UI and keep the native title bar and resizable window behavior.
- Use Rig's OpenAI Chat Completions client for streaming, including custom base URLs.
- Do not add a local inference runtime, llama integration, or provider-specific SDK when the OpenAI-compatible contract is sufficient.
- Keep tokens separate from `config.toml`. The current plain-text `credentials.toml` is intentional; do not commit real credentials.

## Architecture boundaries

- Mutate GPUI entities only on the GPUI application thread.
- Run network operations on the dedicated Tokio runtime thread.
- Use bounded channels across callback, UI, and network boundaries.
- Attach a request ID to every streaming event and ignore stale events.
- Cancel the active stream before starting a newer translation.
- Keep Accessibility access in `selection.rs`, provider streaming in `llm.rs`, and UI rendering in `ui.rs`.
- Keep XDG configuration, prompt construction, and provider streaming in the shared library used by both binaries.
- Keep CLI path resolution and ANSI Markdown rendering in `cli.rs`; never write ANSI escapes to generated files or redirected stdout in automatic color mode.
- Keep both binaries in the package derivation and expose `glossshift` and `gshift` through the default flake overlay with the matching `meta.mainProgram`.
- Avoid `unsafe` code. Prefer safe wrappers around macOS APIs.

## Configuration compatibility

- Resolve the configuration root through `xdg::BaseDirectories`; it defaults to `~/.config/glossshift` and honors `XDG_CONFIG_HOME`.
- Preserve the named provider-to-credential relationship.
- Preserve the target language attached to each configured global shortcut across the hotkey, UI, and network boundaries.
- Treat shortcut strings, TOML content, Accessibility values, and HTTP responses as untrusted boundary input.
- Keep `credentials.toml` permissions at `0600`.

## Development commands

Run these from the repository root:

```bash
just fix
just fix-format
just fix-lint
just check
just check-format
just check-lint
just test
just build
just ci
just cli README.md --lang ja
```

Use `just ci` to run the full local validation gate. Use the smallest relevant `check-*` or `fix-*` recipe while iterating and run the full gate before handoff. Do not weaken a failing test or lint.

## Automation

- Keep repository automation in the root `Justfile` by default.
- Prefer a named Just recipe over a standalone shell script.
- Add a script only when the workflow cannot reasonably be expressed in Just, and invoke that script from a Just recipe.

## Change discipline

- Keep production source files below 250 lines when practical.
- Add tests for configuration validation, prompt contracts, cancellation, or stale-event behavior when those boundaries change.
- Do not log or render API keys.
