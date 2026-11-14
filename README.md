# GlossShift

GlossShift translates text locally on an Apple Silicon Mac.
Its desktop popup and terminal UI use NSH, TypeScript, and Effect.
The `gshift` batch command uses the same local model and translation service.

## Usage

Open the installed desktop application:

```bash
open ~/.nix-profile/Applications/GlossShift.app
```

Select text in another application and press a configured shortcut.
GlossShift shows the source and streams the translation into the second pane.
Copy always uses the original text, including Markdown syntax.
The **Plain** toggle switches both panes between Markdown preview and plain text.
Code blocks have no syntax highlighting, links do not open, images show alternate text, and HTML remains literal.
Desktop selection capture requires macOS Accessibility permission.
The helper reads the focused application's Accessibility selection before GlossShift activates its popup.
Applications that do not expose selected text through this API report an error.
GlossShift does not simulate `Cmd+C` or replace clipboard contents to capture a selection.

Run the interactive terminal UI:

```bash
gshift
# Explicit interactive mode:
gshift --tui
```

Enter text and a target language, then choose **Translate**.
The terminal UI does not start desktop hotkeys or tray services and does not need Accessibility permission.
Both desktop and terminal modes use NSH's official prebuilt hosts and do not compile custom Rust application code.
Desktop selection capture runs in a separate Swift helper.
Use **Quit** or `Ctrl+C` to exit.

Translate Markdown files in the supplied order:

```bash
gshift document.md notes.mbt.md --lang ja
# Stream plain output without creating sibling files:
gshift document.md --lang en --stdout --color never
```

File mode writes `document.ja.md` and `notes.ja.mbt.md` and reports their paths to stderr.
Plain stdout concatenates translations without inserted separators.
The first translation automatically downloads the official PLaMo 3 Translate 0.8B Q4_K_M GGUF, approximately 573 MB.
Subsequent runs use the verified cached model without downloading it again.
No hosted-model account or API key is required.
Text is processed on the Mac, not sent to a hosted inference service.

> [!IMPORTANT]
> The default model uses the [PLaMo Community License](https://plamo.preferredai.jp/info/plamo-community-license-en), not the application's MIT metadata license.
> Commercial use requires prior registration and eligibility under that license.
> Review the terms before use.
> GlossShift does not register users or accept commercial terms on their behalf.

## Features

- Native macOS popup with global shortcuts and an official NSH terminal UI.
- Local Metal inference through the pinned official llama-server and a real Effect AI `LanguageModel` adapter.
- Automatic model download, pinned default revision, SHA-256 verification, and offline cache reuse.
- Configurable larger GGUF models and explicit context and output limits.
- Shared translation, cancellation, and Markdown/plain behavior across desktop, terminal, and batch modes.
- Ordered Markdown file processing with input/output collision checks and safe symbolic-link replacement.
- TypeScript application, translation, settings, and autostart policy, with a small separate Swift Accessibility helper.

## Prerequisites

- Apple Silicon macOS.
- Nix with flakes enabled.
- Network access and disk space for the first model download.
- Enough available memory for the chosen model and context.
- Accessibility permission only for desktop selection capture.

The Nix package includes Node, the official `llama-server` b12110 executable with its Metal libraries, and the Swift helper.
No compiler, native Node addon, or engine download is required on first use.
Model weights stay in the user's cache rather than the Nix store.
The inference server is private to the application, listens only on loopback, and uses a new authentication key per launch.

## Setup

### Run without installing

```bash
nix run 'github:totto2727-org/glossshift#glossshift'
nix run 'github:totto2727-org/glossshift#gshift' -- --help
```

### Install

```bash
nix profile add 'github:totto2727-org/glossshift#glossshift'
```

The package includes `GlossShift.app` and `gshift`.

### Nix flake

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    glossshift.url = "github:totto2727-org/glossshift";
  };

  outputs = { nixpkgs, glossshift, ... }:
    let
      system = "aarch64-darwin";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      packages.${system}.default = pkgs.buildEnv {
        name = "translation-tools";
        paths = [ glossshift.packages.${system}.glossshift ];
      };
    };
}
```

## Configuration

### Local translation

No configuration is needed for the default 0.8B model.
Optional settings live in `~/.config/glossshift/local.json`, or `$XDG_CONFIG_HOME/glossshift/local.json`.
Set `GLOSSSHIFT_CONFIG` to an absolute file path to select another local configuration.
An explicitly selected file must exist.

```json
{
  "sourceLanguage": "auto",
  "contextSize": 8192,
  "maxTokens": 4096
}
```

`sourceLanguage` defaults to automatic detection.
`contextSize` includes the input, prompt, and generated translation.
`maxTokens` limits generated tokens and must be smaller than the context.
PLaMo configuration cannot exceed the model's 32768-token context.
An oversized source or incomplete output fails instead of producing a successful truncated file.
Translate a smaller section when the configured limits are insufficient.

The default cache is `~/.cache/glossshift/models`, or `$XDG_CACHE_HOME/glossshift/models`.
Set `cacheDirectory` to an absolute directory to override it.
The downloaded file is named with its SHA-256 digest and is verified before loading.

To use the official 2B Q4_K_M model instead, add this model setting:

```json
{
  "model": {
    "uri": "https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/resolve/4f672106b847200bfdc0f6af6c321cd94eba1aed/plamo-3-translate-2b-Q4_K_M.gguf",
    "sha256": "1ffd9073afcc70e35ccc942428aa2b73d7aa2b9ea779bf504b775369e0276c13",
    "prompt": "plamo"
  }
}
```

This model download is approximately 1.81 GB and requires more memory than 0.8B.
Use `prompt: "plamo"` for PLaMo 3 translation models.
For another single-file GGUF, use `prompt: "chat"` only if its metadata provides a valid chat template.
A custom model needs an HTTPS or `file:` URI and its complete SHA-256 digest.
Multipart GGUFs are not supported.
A download URL selects model weights, not a hosted inference endpoint.
Restart the application after changing settings.

The [official default artifact](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/tree/1cf96ae02133958a20074bfdfab76517bb737d00) and its digest are pinned in `node/config.ts`.

### Desktop settings

Window and shortcut settings live in `~/.config/glossshift/config.toml`, honoring `XDG_CONFIG_HOME`:

```toml
[[shortcuts]]
keys = "Ctrl+Super+KeyJ"
target_language = "Japanese"

[window]
width = 560
height = 360
min_width = 320
min_height = 180
```

Shortcut keys must be unique, and each target language must be non-empty.
GlossShift creates this file only if it is absent.
Existing settings and shared `~/.agents` files are not overwritten.
Provider credentials and old provider settings are not used for local translation.
Use `local.json` for the source language and model settings.

## Command reference

```text
gshift
gshift --tui
gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]
```

| Option                    | Behavior                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `<FILES>...`              | Process `.md` and `.mbt.md` inputs in order.                                          |
| `-l`, `--lang <LANGUAGE>` | Select the target language, such as `ja` or `en`.                                     |
| `-f`, `--force`           | Replace existing sibling outputs, but never an input file. Conflicts with `--stdout`. |
| `--stdout`                | Concatenate translations to stdout without writing files.                             |
| `--color <MODE>`          | Set whole-output ANSI styling to `auto`, `always`, or `never`. Requires `--stdout`.   |
| `-h`, `--help`            | Show help without loading a model or configuration.                                   |
| `-V`, `--version`         | Show the version without loading a model or configuration.                            |

File names receive a language suffix before `.md` or `.mbt.md`.
An existing trailing `.ja` or `.en` suffix is replaced.
Input/output collisions, duplicate outputs, and unapproved overwrites fail before loading a model.
With `--force`, a symbolic-link output is replaced without modifying its target.
File output and redirected automatic-color stdout contain no ANSI styling.
Color adds terminal styling only, not Markdown syntax highlighting.
Plain stdout streams deltas, so an inference failure can leave partial text in a pipeline.
File mode writes only completed translations.
Diagnostics go to stderr with a nonzero exit status on failure.

## Development

See [AGENTS.md](./AGENTS.md) for repository structure, architecture, toolchain setup, and validation commands.
Vite+ owns installation, tasks, formatting, and lint.
NSH owns application type checking, execution, tests, bundling, and native packaging.
The Node translation process runs TypeScript directly and shares its service with the batch CLI.
The [runtime architecture](./docs/runtime-architecture.md) describes process ownership and the separate Accessibility helper.
The maintained [upstream difference record](./docs/upstream-differences.md) documents the unchanged NSH release and retained plist validation patch.

## License

The application metadata declares MIT, but this repository does not currently include a `LICENSE` file.
The default model is separate software under the PLaMo Community License.
Built with PLaMo.
