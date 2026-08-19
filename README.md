# GlossShift

GlossShift is a macOS-only translation application with a GPUI desktop popup and a command-line interface that share configuration, prompts, credentials, and OpenAI-compatible streaming.

## Usage

Start the desktop popup with its stable macOS application identity:

```bash
just run
```

For development without an application bundle, use `just dev`; the built application is preferred when granting Accessibility permission because macOS can identify its bundle identifier (`com.totto2727.glossshift`).

Select text in another application and press a configured global shortcut to capture and translate it; the default shortcut is `Ctrl+Super+KeyJ` for Japanese, where `Super` means the macOS Command modifier in the `global-hotkey` syntax.

The popup hides instead of terminating when closed, and its standard shortcuts are `Cmd+Q` to quit, `Cmd+W` to hide, `Cmd+C` to copy the translation, and `Cmd+Shift+C` to copy the source.

Translate one or more Markdown files with the shared provider configuration:

```bash
just cli README.md AGENTS.md --lang ja --force
```

The CLI processes files in input order. It writes one language-suffixed sibling file per input by default; with `--stdout`, it concatenates the translations in that order without inserting separators. The complete flag, path, and color reference is in [AGENTS.md](./AGENTS.md#cli-reference).

## Key features

- A native-title-bar GPUI popup that can be resized and hidden without terminating the application.
- Global shortcuts with a separate target language for each shortcut.
- macOS Accessibility selection capture with a simulated `Cmd+C` fallback when the focused element does not export selected text.
- Streaming translations through any server that implements the OpenAI Chat Completions API, including custom base URLs and provider request parameters.
- Shared XDG configuration and credentials for the desktop application and `gshift` CLI.
- Plain streamed stdout for pipelines and optional Tree-sitter Markdown ANSI highlighting for terminals.
- Full-pane copy controls for source and translation text.
- No local inference runtime or llama integration.

## Prerequisites

- **macOS**: GlossShift currently supports macOS only.
- **Rust and Cargo**: Rust 1.85 or newer is required.
- **Just**: The documented `just` recipes provide the development, packaging, and CLI workflows.
- **Nix (optional)**: `nix develop` provides the Rust toolchain and Just in a reproducible Darwin development shell; use it when those tools are not already installed.
- **Accessibility permission**: Grant permission to the application bundle or terminal that captures selections and sends the fallback `Cmd+C`.
- **OpenAI-compatible credentials**: Provide an API key and model through a server implementing Chat Completions.
- **Xcode Command Line Tools**: GPUI's `runtime_shaders` feature does not require the standalone Metal compiler from a full Xcode installation.

## Setup

1. Clone the repository and enter it.

```bash
git clone https://github.com/totto2727-org/glossshift.git
cd glossshift
```

2. Build and open the signed local application bundle.

```bash
just run
```

3. On first launch, edit `~/.config/glossshift/credentials.toml` and replace `replace-me` with the provider API key, then adjust `~/.config/glossshift/config.toml` if needed.

4. Grant Accessibility permission to `GlossShift.app` in System Settings > Privacy & Security > Accessibility, then select text in another application and use a configured shortcut.

The application creates `config.toml` with the default provider, Japanese shortcut, and window dimensions, and creates `credentials.toml` with mode `0600`. Providers and credentials are linked by name, so credentials remain separate from ordinary configuration.

The configuration root defaults to `~/.config/glossshift` and honors `XDG_CONFIG_HOME`; set `XDG_CONFIG_HOME=/tmp/glossshift-test` before `just dev` for an isolated local run. The provider base URL must include its API prefix, commonly `/v1`, because Rig appends the Chat Completions route.

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
```

See [`examples/config.toml`](examples/config.toml) and [`examples/credentials.toml`](examples/credentials.toml) for complete starter files. Add one `[[shortcuts]]` table per target language; every shortcut key must be unique and every target language must be non-empty.

## API

GlossShift has no maintained API registry, so the public Rust API is documented inline below. Import the library as `glossshift`.

### `config::DEFAULT_CONFIG`

Provides the default `config.toml` template used by `config::load_or_initialize`.

```rust
fn default_config() -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(glossshift::config::DEFAULT_CONFIG)
}
```

### `config::AppConfig`, `config::ProviderConfig`, `config::TranslationConfig`, `config::ShortcutConfig`, `config::WindowConfig`, and `config::LoadedConfig`

These public data types represent validated application configuration, provider endpoint and timeout settings, source-language settings, target-language shortcuts, popup dimensions, and the loaded API key plus configuration directory. `ProviderConfig::request_parameters` carries optional JSON fields unchanged to Rig.

```rust
fn active_provider(
    config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    config.provider()
}
```

### `config::AppConfig::provider`

Returns the provider selected by `active_provider` or an error when that name is not configured.

```rust
fn active_provider(
    app_config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    app_config.provider()
}
```

### `config::parse_config`

Parses TOML and validates the active provider, popup dimensions, shortcut list, target languages, and duplicate hotkeys.

```rust
fn parse(source: &str) -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(source)
}
```

### `config::load_or_initialize`

Resolves the XDG configuration directory, creates missing configuration and credential templates, enforces credential mode `0600`, and returns `LoadedConfig` with the active API key.

```rust
fn load() -> anyhow::Result<glossshift::config::LoadedConfig> {
    glossshift::config::load_or_initialize()
}
```

### `prompt::translation_system_prompt` and `prompt::translation_user_prompt`

Builds the translation contract as a system message and passes the input document as the only user content. The document is treated as inert content translated one-to-one without changing its structure; a source of `auto` directs the model to detect the language.

```rust
fn main() {
    let system = glossshift::prompt::translation_system_prompt("auto", "Japanese");
    let user = glossshift::prompt::translation_user_prompt("# Heading\n");
    println!("{system}\n\n{user}");
}
```

### `llm::RequestId` and `llm::TranslationRequest`

`RequestId` identifies one stream so consumers can ignore stale events. `TranslationRequest` carries that ID, a `ProviderConfig`, API key, source and target languages, and source text.

```rust
fn request(
    provider: glossshift::config::ProviderConfig,
    api_key: String,
    text: String,
) -> glossshift::llm::TranslationRequest {
    glossshift::llm::TranslationRequest {
        id: glossshift::llm::RequestId(1),
        provider,
        api_key,
        source_language: "auto".into(),
        target_language: "Japanese".into(),
        text,
    }
}
```

### `llm::TranslationEvent` and `TranslationEvent::request_id`

`TranslationEvent` reports `Started`, streamed `Delta`, `Finished`, or `Failed` for a request, and `request_id()` returns the event's associated `RequestId`.

```rust
fn is_current(event: &glossshift::llm::TranslationEvent) -> bool {
    event.request_id() == glossshift::llm::RequestId(1)
}
```

### `llm::translate`

Streams one `TranslationRequest` through Rig into an `async_channel::Sender<TranslationEvent>` and observes a `CancellationToken`; it returns an error for provider, timeout, or closed-channel failures.

```rust
async fn translate_request(
    request: glossshift::llm::TranslationRequest,
    events: async_channel::Sender<glossshift::llm::TranslationEvent>,
) -> anyhow::Result<()> {
    glossshift::llm::translate(
        request,
        events,
        tokio_util::sync::CancellationToken::new(),
    )
    .await
}
```

### `llm::run_worker`

Consumes bounded translation requests, cancels the previous request when a newer one arrives, and forwards each request's events to the supplied bounded channel.

```rust
fn spawn_worker(
    requests: async_channel::Receiver<glossshift::llm::TranslationRequest>,
    events: async_channel::Sender<glossshift::llm::TranslationEvent>,
) {
    tokio::spawn(glossshift::llm::run_worker(requests, events));
}
```

### `cli::Cli` and `cli::ColorChoice`

`Cli` is the Clap parser for the `gshift` binary: it contains one or more Markdown `files` in input order plus the required `lang`, `force`, `stdout`, and `color` options. `ColorChoice` is `Auto`, `Always`, or `Never`; `ColorChoice::enabled` resolves whether ANSI output is enabled for the current stdout terminal.

```rust
use std::io::IsTerminal as _;

fn main() {
    let color = glossshift::cli::ColorChoice::Auto.enabled(std::io::stdout().is_terminal());
    println!("color enabled: {color}");
}
```

### `cli::normalize_language`

Trims and lowercases a target language code and rejects empty values, leading or trailing hyphens, and non-ASCII alphanumeric or hyphen characters.

```rust
fn normalize() -> anyhow::Result<String> {
    let language = glossshift::cli::normalize_language(" JA ")?;
    assert_eq!(language, "ja");
    Ok(language)
}
```

### `cli::target_path`

Resolves a translated sibling path, preserving `.mbt.md` as a compound extension and replacing an existing `.ja` or `.en` segment.

```rust
fn output_path() -> anyhow::Result<std::path::PathBuf> {
    let output = glossshift::cli::target_path(
        std::path::Path::new("guide.en.mbt.md"),
        "ja",
    )?;
    assert_eq!(output, std::path::Path::new("guide.ja.mbt.md"));
    Ok(output)
}
```

### `cli::ensure_safe_output_paths`

Validates the complete batch before translation starts, rejecting output paths that collide with an input or another output, including existing hard-link aliases and case-only path collisions. Symbolic-link outputs are rejected unless `force` permits replacing the link itself.

```rust
fn validate_batch() -> anyhow::Result<()> {
    let inputs = [
        std::path::Path::new("README.md"),
        std::path::Path::new("AGENTS.md"),
    ];
    let outputs = [
        std::path::Path::new("README.ja.md"),
        std::path::Path::new("AGENTS.ja.md"),
    ];
    glossshift::cli::ensure_safe_output_paths(inputs, outputs, false)
}
```

### `cli::highlight_markdown`

Converts Markdown highlight events into ANSI-styled text using Tree-sitter queries without changing the underlying source characters.

```rust
fn highlight() -> anyhow::Result<String> {
    glossshift::cli::highlight_markdown("# Heading\n")
}
```

### `selection::selected_text`

This desktop-binary helper checks Accessibility permission, reads the focused element's selected text, and falls back to a simulated `Cmd+C` plus pasteboard polling when needed. Its signature is `pub fn selected_text() -> anyhow::Result<String>`; it is private to the desktop binary rather than an external library entry point.

### `ui::PopupView`

This desktop-binary view owns popup state and exposes `new`, `trigger_translation`, `handle_event`, `copy_source`, and `copy_translation` to wire capture, streaming events, and pane copy actions. These are desktop-binary signatures rather than external library entry points.

## Development

For repository structure, development commands, architecture, and the complete CLI reference, see [AGENTS.md](./AGENTS.md).

## License

The package metadata declares MIT, but this repository does not currently include a `LICENSE` file.

_This README was generated from the [share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) and [README template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/readme/template.md)._
