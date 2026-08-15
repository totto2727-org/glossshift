# Translate Popup

Translate Popup is a macOS-only desktop application that translates the text selected in any application and displays the result in a resizable GPUI popup. Configurable global shortcuts select the target language and start the translation, and Rig streams text from any server that implements the OpenAI Chat Completions API.

## Current scope

- macOS only.
- A native title bar and a freely resizable popup, with configurable initial and minimum sizes.
- Closing the popup hides it without stopping the app; the next configured shortcut shows it again and starts translation.
- Configurable global shortcuts, each assigned to a target language.
- Selection capture through the macOS Accessibility API, with a text-clipboard fallback.
- Streaming translation through an arbitrary OpenAI-compatible Chat Completions endpoint.
- Whole-pane copy controls for the source text and translation.
- Plain-text TOML configuration under `~/.config/translate-popup`.
- No local model or llama integration.

## Requirements

- macOS.
- Rust 1.85 or newer with Cargo. The repository currently builds with Rust 1.95.
- Accessibility permission for direct selection capture by the built application or terminal used to launch it. Without permission, copy the text before pressing a shortcut.
- An API key and model exposed by an OpenAI-compatible Chat Completions server.

GPUI is built with its `runtime_shaders` feature, so Xcode Command Line Tools are sufficient and the standalone Metal compiler from the full Xcode installation is not required.

## Run

```bash
just run
```

For a stable macOS application identity, build a local `.app` bundle and open it instead:

```bash
just package-app
open "target/Translate Popup.app"
```

The generated bundle stays under `target` and is not committed. `just package-app` applies and verifies a local ad-hoc signature after copying the final bundle contents. This is the recommended form for granting Accessibility permission because macOS can identify the application by its bundle identifier.

The first launch creates these files:

- `~/.config/translate-popup/config.toml`
- `~/.config/translate-popup/credentials.toml` with mode `0600`

Replace `replace-me` in `credentials.toml`, adjust the provider and shortcuts in `config.toml`, and restart the application. For direct selection capture, grant Accessibility permission in System Settings, select text in another application, and press the shortcut for the desired target language. Without permission, or if the focused element does not expose selected text, copy the text first and press the same shortcut; the application automatically falls back to the system clipboard. The generated default translates to Japanese with Control+Meta+J (`Ctrl+Super+KeyJ` in the configuration syntax). On macOS, `global-hotkey` calls the Meta/Command modifier `Super`.

Use the `COPY` control beside `SOURCE` or `TRANSLATION` to copy that pane's complete text to the system clipboard. GPUI 0.2.2 does not provide a ready-made selectable multiline text element, so partial mouse selection is outside the current simple popup scope.

The red close button hides the popup instead of terminating its window state. Pressing any configured translation shortcut brings the same popup back to the foreground and starts a new translation.

Window keyboard shortcuts follow standard macOS conventions:

- `Cmd+Q` quits the application.
- `Cmd+W` hides the popup while leaving the application and global translation shortcuts active.
- `Cmd+C` copies the complete translated text.
- `Cmd+Shift+C` copies the complete source text.

For an isolated local test, set the standard `XDG_CONFIG_HOME` before launching. The application appends its `translate-popup` directory automatically:

```bash
XDG_CONFIG_HOME=/tmp/translate-popup-test just run
```

## Configuration

See [`examples/config.toml`](examples/config.toml) and [`examples/credentials.toml`](examples/credentials.toml). Providers and credentials are linked by name, so the token remains separate from the ordinary configuration.

```toml
active_provider = "default"

[providers.default]
base_url = "https://api.openai.com/v1"
model = "gpt-4.1-mini"
credential = "default"
first_chunk_timeout_seconds = 15
stream_idle_timeout_seconds = 30

[translation]
source_language = "auto"

[[shortcuts]]
keys = "Ctrl+Super+KeyJ"
target_language = "Japanese"

[[shortcuts]]
keys = "Ctrl+Super+KeyE"
target_language = "English"
```

Add one `[[shortcuts]]` table for each target language. Each entry requires a unique `keys` value and a non-empty `target_language`; duplicate hotkeys fail at startup instead of silently replacing another language. The provider base URL must include the provider's API prefix, commonly `/v1`. Rig appends the Chat Completions route. Shortcut names follow the `global-hotkey` parser; modifiers must precede the key, for example `Ctrl+Super+KeyJ`.

Provider-specific Chat Completions fields can be added as a TOML table and are forwarded unchanged through Rig. For a reasoning model that supports OpenAI's `none` effort, use the following latency-first setting:

```toml
[providers.default.request_parameters]
reasoning_effort = "none"
```

Do not set this for models that reject `reasoning_effort` or do not support `none`. The default `gpt-4.1-mini` configuration is already non-reasoning and therefore omits the parameter. The active provider must be restarted after editing the configuration.

## Architecture

The GPUI main thread owns the window, global hotkey manager, and UI state. A dedicated Tokio runtime thread owns LLM network work. Bounded channels isolate the two runtimes. A monotonically increasing request ID prevents a cancelled or late stream from overwriting a newer translation.

```mermaid
flowchart LR
    A["Language-specific global shortcut"] --> B["Bounded channel: target language"]
    B --> C["GPUI main thread"]
    C --> D["macOS Accessibility API"]
    D --> E["Bounded request channel"]
    E --> F["Tokio network thread"]
    F --> G["Rig CompletionsClient"]
    G --> H["OpenAI-compatible /chat/completions stream"]
    H --> I["Request-scoped deltas"]
    I --> J["Bounded UI event channel"]
    J --> C
```

```mermaid
sequenceDiagram
    participant User
    participant Hotkey as global-hotkey
    participant UI as GPUI main thread
    participant AX as Accessibility API
    participant Worker as Tokio worker
    participant LLM as OpenAI-compatible API
    User->>Hotkey: Press configured shortcut
    Hotkey->>UI: Shortcut event(target_language)
    UI->>AX: Read focused element and selected text
    AX-->>UI: Selected text
    UI->>Worker: TranslationRequest(request_id, target_language)
    Worker->>Worker: Cancel the previous request
    Worker->>LLM: Start streaming Chat Completions request
    loop Each text delta
        LLM-->>Worker: Text delta
        Worker-->>UI: Delta(request_id)
        UI-->>User: Incrementally render translation
    end
    LLM-->>Worker: End of stream
    Worker-->>UI: Finished(request_id)
```

## Error behavior

- A new shortcut cancels the prior stream.
- Events from stale request IDs are ignored.
- The first chunk and subsequent idle periods use separately configurable timeouts.
- Missing Accessibility permission, missing selected text, invalid configuration, and provider failures are shown in the popup or reported at startup.
- If Accessibility selection capture fails, a non-empty text clipboard is used; otherwise the popup asks the user to copy text and retry.
- Tokens are never included in `Debug` output, but the current credential store is still plain text. Keychain integration is intentionally deferred.

## Development

```bash
just fix
just check
just ci
just package-app
```

`just fix` aggregates the `fix-*` recipes, `just check` aggregates the `check-*` recipes, and `just ci` runs checks, tests, and the build. Repository automation belongs in the root `Justfile`. Add a Just recipe instead of introducing a standalone shell script unless the workflow cannot reasonably be expressed as a recipe.

Source files are kept small and separated by responsibility: configuration, Accessibility selection capture, prompt construction, streaming worker, GPUI view, and application wiring.

## Documentation translation

`README.md` and `AGENTS.md` are the source documents. Regenerate Japanese translations with the local `mdt` command:

```bash
mdt --lang ja --force README.md
mdt --lang ja --force AGENTS.md
```

Commit the generated `README.ja.md` and `AGENTS.ja.md` beside their sources.

## Official references

- [GPUI crate documentation](https://docs.rs/gpui/0.2.2/gpui/)
- [GPUI source in Zed](https://github.com/zed-industries/zed/tree/main/crates/gpui)
- [Rig installation](https://www.rig.rs/docs/installation)
- [Rig streaming](https://www.rig.rs/docs/concepts/streaming)
- [Rig OpenAI provider](https://www.rig.rs/docs/integrations/model_providers/openai)
- [`global-hotkey` crate documentation](https://docs.rs/global-hotkey/0.8.0/global_hotkey/)
- [`accessibility` crate documentation](https://docs.rs/accessibility/0.2.0/accessibility/)
- [`macos-accessibility-client` crate documentation](https://docs.rs/macos-accessibility-client/0.0.2/macos_accessibility_client/)
- [`xdg` crate documentation](https://docs.rs/xdg/3.0.0/xdg/)
- [Apple Accessibility trust API](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)

## License

MIT
