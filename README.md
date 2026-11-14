# GlossShift

GlossShift translates text locally on an Apple Silicon Mac.
Its desktop popup uses NSH, TypeScript, and Effect.
The standalone `gshift` command runs on Node.js 26 with Effect 4 CLI and shares the local translation service.

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

Show command help:

```bash
gshift
gshift --help
```

The CLI is noninteractive and does not need NSH, Swift, or Accessibility permission.
`--tui` is rejected.
Launch the desktop application separately for the interactive popup.
The desktop uses NSH's official prebuilt host and a separate Swift selection helper without custom Rust application code.

Translate Markdown files in the supplied order:

```bash
gshift document.md notes.mbt.md --lang ja
# Write plain output without creating sibling files:
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

- Native macOS popup with global shortcuts and a separate Effect 4 CLI.
- Local Metal inference through the pinned official llama-server and a real Effect AI `LanguageModel` adapter.
- Automatic model download, pinned default revision, SHA-256 verification, and offline cache reuse.
- Configurable larger GGUF models and explicit context and output limits.
- Shared translation, cancellation, model selection, and token-budget policy across desktop and CLI.
- Ordered Markdown file processing with input/output collision checks and safe symbolic-link replacement.
- TypeScript application, translation, settings, and autostart policy, with a small separate Swift Accessibility helper.

## Prerequisites

- Apple Silicon macOS.
- Nix with flakes enabled.
- Network access and disk space for the first model download.
- Enough available memory for the chosen model and context.
- Accessibility permission only for desktop selection capture.

The standalone `gshift` Nix package includes Node.js 26, production JavaScript dependencies, and the pinned inference and file utilities, without NSH or Swift.
The GUI uses the official NSH host and a small Swift helper, without starting a Node process.
The combined `glossshift` package includes `GlossShift.app` and links the standalone CLI, so its closure also includes Node.
Both packages use Nixpkgs unstable's `llama-cpp` 0.9.0 with Metal support.
The inference dependency has its own exact Nixpkgs pin, without changing the application's main toolchain pin.
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
To install only the CLI, without NSH or Swift:

```bash
nix profile add 'github:totto2727-org/glossshift#gshift'
```

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
The supported PLaMo 3 translation models have built-in presets in `runtime/models.ts`.
Selecting a model also selects its immutable GGUF URL, SHA-256 digest, prompt format, language policy, and supported context limit.
All four built-in presets declare a 262144-token context limit in `runtime/models.ts`, matching the publisher's `max_position_embeddings` metadata.
The completion budget is calculated from the context remaining after prompt tokenization.
Explicit settings may reduce the budget but cannot exceed the model's supported context.

| Model selector                     | Quantization | Download size          |
| ---------------------------------- | ------------ | ---------------------- |
| `plamo-3-translate-0.8b` (default) | Q4_K_M       | Approximately 573 MB   |
| `plamo-3-translate-2b`             | Q4_K_M       | Approximately 1.81 GB  |
| `plamo-3-translate-8b`             | Q4_K_M       | Approximately 5.28 GB  |
| `plamo-3-translate-31b`            | Q4_K_M       | Approximately 19.53 GB |

Larger models and larger contexts require more disk space and memory, including runtime and context buffers beyond the GGUF file size.
Set a smaller explicit `contextSize` if the full context does not fit available memory.
The 31B preset is the largest model in the official PLaMo 3 Translate family.
Real source and installed CLI checks cover cached 0.8B translation with the configured 262144-token context.
A production-server startup check at that context verifies Metal and positive GPU layer offload.
These checks do not validate a 262144-token prompt, larger models, or comparative performance.
Select a built-in model without creating a settings file:

```sh
GLOSSSHIFT_MODEL=plamo-3-translate-2b gshift README.md --lang ja
```

The same environment selection applies to GUI and CLI launches.
An unknown selector fails instead of silently using another model.
Alternatively, set `"model": "plamo-3-translate-2b"` in optional local settings.
`GLOSSSHIFT_MODEL` takes precedence over the file's model, but does not replace explicit cache or token-budget overrides.

Optional settings live in `~/.config/glossshift/local.json`, or `$XDG_CONFIG_HOME/glossshift/local.json`.
Set `GLOSSSHIFT_CONFIG` to an absolute file path to select another local configuration.
An explicitly selected file must exist.

```json
{
  "sourceLanguage": "auto"
}
```

`sourceLanguage` defaults to automatic detection.
For built-in presets, optional `contextSize` includes the input, prompt, and generated translation.
Optional `maxTokens` further limits generated tokens within the dynamically calculated remaining context.
An oversized source or incomplete output fails instead of producing a successful truncated file.
Translate a smaller section when the configured limits are insufficient.

The default cache is `~/.cache/glossshift/models`, or `$XDG_CACHE_HOME/glossshift/models`.
Set `cacheDirectory` to an absolute directory to override it.
The downloaded file is named with its SHA-256 digest and is verified before loading.

Use `prompt: "plamo"` for PLaMo 3 translation models.
For another single-file GGUF, use `prompt: "chat"` only if its metadata provides a valid chat template.
A custom `model` object needs `uri`, `sha256`, and `prompt`, with an HTTPS or `file:` URI and its complete SHA-256 digest.
If that digest is not a known built-in artifact, set `contextSize` explicitly to a supported value for that GGUF.
Unknown custom artifacts do not inherit the default PLaMo context size.
A known preset artifact retains its full model context default even when selected through a custom `file:` URI with the same digest.
Multipart GGUFs are not supported.
A download URL selects model weights, not a hosted inference endpoint.
Restart the application after changing settings.

The [official default artifact](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/tree/1cf96ae02133958a20074bfdfab76517bb737d00) and all preset digests are pinned in `runtime/models.ts`.

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
gshift --help
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
The CLI receives arguments, the working directory, and standard streams directly through Node's native process environment.
No shell capture directory or headless NSH bridge is involved.
An inference failure can still leave output from earlier completed inputs, but an unfinished translation is not published as a completed file.
File mode writes only completed translations.
Diagnostics go to stderr with a nonzero exit status on failure.

## Development

See [AGENTS.md](./AGENTS.md) for repository structure, architecture, toolchain setup, and validation commands.
Vite+ owns installation, tasks, formatting, lint, and native CLI tests through Vitest.
NSH owns GUI execution, tests, bundling, and native packaging.
The CLI runs `cli/main.ts` on Node.js 26 and uses the declarative Effect 4 command in `runtime/main.ts`.
The GUI executes shared configuration and translation policy directly inside NSH through the extraction-ready Effect Platform layer.
The [runtime architecture](./docs/runtime-architecture.md) documents these process and packaging boundaries.
The maintained [dependency compatibility record](./docs/dependency-compatibility.md) documents the unchanged NSH release and retained plist validation patch.
GlossShift is an original application, not a fork.
The [NSH Effect Platform](./platform/README.md) has an explicit, application-independent composition API for reuse in another NSH project.

## License

The application metadata declares MIT, but this repository does not currently include a `LICENSE` file.
The default model is separate software under the PLaMo Community License.
Built with PLaMo.
