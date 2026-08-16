# GlossShift

GlossShift は、設定、プロンプト、認証情報、OpenAI 互換のストリーミングを共有する GPUI デスクトップポップアップとコマンドラインインターフェースを備えた、macOS 専用の翻訳アプリケーションです。

## 使い方

安定した macOS アプリケーション ID でデスクトップポップアップを起動します。

```bash
just run
```

アプリケーションバンドルを使用しない開発では `just dev` を使用してください。macOS はバンドル識別子（`com.totto2727.glossshift`）を識別できるため、アクセシビリティ権限を付与する際はビルド済みアプリケーションが推奨されます。

別のアプリケーションでテキストを選択し、設定済みのグローバルショートカットを押してキャプチャと翻訳を実行します。デフォルトのショートカットは日本語用の `Ctrl+Super+KeyJ` で、`Super` は `global-hotkey` 構文における macOS の Command 修飾キーを意味します。

ポップアップは閉じても終了せず非表示になり、標準ショートカットは `Cmd+Q`（終了）、`Cmd+W`（非表示）、`Cmd+C`（翻訳をコピー）、`Cmd+Shift+C`（原文をコピー）です。

共有プロバイダー設定で 1 つの Markdown ファイルを翻訳します。

```bash
just cli README.md --lang ja --force
```

CLI はデフォルトでは言語サフィックス付きの同名ファイルを書き出し、`--stdout` で翻訳を標準出力に書き出します。完全なフラグ、パス、カラーのリファレンスは [AGENTS.md](./AGENTS.md#cli-reference) を参照してください。

## 主な機能

- ネイティブタイトルバーを持つ GPUI ポップアップ。アプリケーションを終了せずにリサイズや非表示が可能です。
- ショートカットごとに個別のターゲット言語を設定できるグローバルショートカット。
- macOS アクセシビリティによる選択範囲のキャプチャ。フォーカスされた要素が選択テキストを公開しない場合は、シミュレートされた `Cmd+C` にフォールバックします。
- OpenAI Chat Completions API を実装するあらゆるサーバー（カスタム base URL やプロバイダーリクエストパラメータを含む）によるストリーミング翻訳。
- デスクトップアプリケーションと `gshift` CLI の共有 XDG 設定と認証情報。
- パイプライン用のプレーンなストリーミング標準出力と、ターミナル用のオプションの Tree-sitter Markdown ANSI ハイライト。
- 原文と翻訳テキストの全画面コピーコントロール。
- ローカル推論ランタイムや llama 統合はありません。

## 前提条件

- **macOS**: GlossShift は現在 macOS のみをサポートしています。
- **Rust と Cargo**: Rust 1.85 以降が必要です。
- **Just**: ドキュメント化された `just` レシピが、開発、パッケージング、CLI のワークフローを提供します。
- **Nix（任意）**: `nix develop` が Rust ツールチェーンと Just を再現可能な Darwin 開発シェルで提供します。これらのツールが未インストールの場合に使用してください。
- **アクセシビリティ権限**: 選択範囲をキャプチャし、フォールバックの `Cmd+C` を送信するアプリケーションバンドルまたはターミナルに権限を付与してください。
- **OpenAI 互換の認証情報**: Chat Completions を実装するサーバーを通じて API キーとモデルを提供してください。
- **Xcode Command Line Tools**: GPUI の `runtime_shaders` 機能は、完全な Xcode インストールに含まれるスタンドアロンの Metal コンパイラを必要としません。

## セットアップ

1. リポジトリをクローンしてディレクトリに入ります。

```bash
git clone https://github.com/totto2727-org/glossshift.git
cd glossshift
```

2. 署名付きローカルアプリケーションバンドルをビルドして開きます。

```bash
just run
```

3. 初回起動時に `~/.config/glossshift/credentials.toml` を編集して `replace-me` をプロバイダーの API キーに置き換え、必要に応じて `~/.config/glossshift/config.toml` を調整します。

4. システム設定 > プライバシーとセキュリティ > アクセシビリティで `GlossShift.app` にアクセシビリティ権限を付与し、別のアプリケーションでテキストを選択して設定済みのショートカットを使用します。

アプリケーションはデフォルトのプロバイダー、日本語ショートカット、ウィンドウ寸法で `config.toml` を作成し、モード `0600` で `credentials.toml` を作成します。プロバイダーと認証情報は名前でリンクされるため、認証情報は通常の設定から分離されたままになります。

設定ルートはデフォルトで `~/.config/glossshift` になり、`XDG_CONFIG_HOME` を尊重します。隔離されたローカル実行には `just dev` の前に `XDG_CONFIG_HOME=/tmp/glossshift-test` を設定してください。Rig は Chat Completions ルートを追加するため、プロバイダーの base URL には通常 `/v1` である API プレフィックスを含める必要があります。

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

完全なスターターファイルについては [`examples/config.toml`](examples/config.toml) と [`examples/credentials.toml`](examples/credentials.toml) を参照してください。ターゲット言語ごとに 1 つの `[[shortcuts]]` テーブルを追加してください。すべてのショートカットキーは一意で、すべてのターゲット言語は空でない必要があります。

## API

GlossShift には管理された API レジストリがないため、公開 Rust API は以下にインラインで文書化されています。ライブラリを `glossshift` としてインポートしてください。

### `config::DEFAULT_CONFIG`

`config::load_or_initialize` が使用するデフォルトの `config.toml` テンプレートを提供します。

```rust
fn default_config() -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(glossshift::config::DEFAULT_CONFIG)
}
```

### `config::AppConfig`、`config::ProviderConfig`、`config::TranslationConfig`、`config::ShortcutConfig`、`config::WindowConfig`、`config::LoadedConfig`

これらの公開データ型は、検証済みのアプリケーション設定、プロバイダーのエンドポイントとタイムアウト設定、ソース言語設定、ターゲット言語ショートカット、ポップアップ寸法、および読み込まれた API キーと設定ディレクトリを表します。`ProviderConfig::request_parameters` はオプションの JSON フィールドを変更せずに Rig へ渡します。

```rust
fn active_provider(
    config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    config.provider()
}
```

### `config::AppConfig::provider`

`active_provider` で選択されたプロバイダーを返し、その名前が設定されていない場合はエラーを返します。

```rust
fn active_provider(
    app_config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    app_config.provider()
}
```

### `config::parse_config`

TOML を解析し、アクティブプロバイダー、ポップアップ寸法、ショートカットリスト、ターゲット言語、重複したホットキーを検証します。

```rust
fn parse(source: &str) -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(source)
}
```

### `config::load_or_initialize`

XDG 設定ディレクトリを解決し、欠落している設定と認証情報テンプレートを作成し、認証情報モード `0600` を強制し、アクティブな API キーとともに `LoadedConfig` を返します。

```rust
fn load() -> anyhow::Result<glossshift::config::LoadedConfig> {
    glossshift::config::load_or_initialize()
}
```

### `prompt::translation_prompt`

意味、トーン、段落、フォーマットを保持しながら、共有の翻訳専用プロンプトを構築します。

```rust
fn main() {
    let prompt = glossshift::prompt::translation_prompt("auto", "Japanese", "# Heading\n");
    println!("{prompt}");
}
```

### `llm::RequestId` と `llm::TranslationRequest`

`RequestId` は 1 つのストリームを識別し、コンシューマーが古いイベントを無視できるようにします。`TranslationRequest` はその ID、`ProviderConfig`、API キー、ソース言語とターゲット言語、およびソーステキストを保持します。

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

### `llm::TranslationEvent` と `TranslationEvent::request_id`

`TranslationEvent` はリクエストの `Started`、ストリーミングされた `Delta`、`Finished`、または `Failed` を報告し、`request_id()` はイベントに関連付けられた `RequestId` を返します。

```rust
fn is_current(event: &glossshift::llm::TranslationEvent) -> bool {
    event.request_id() == glossshift::llm::RequestId(1)
}
```

### `llm::translate`

1 つの `TranslationRequest` を Rig を通じて `async_channel::Sender<TranslationEvent>` へストリーミングし、`CancellationToken` を監視します。プロバイダー、タイムアウト、またはクローズされたチャネルの失敗時にはエラーを返します。

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

制限付きの翻訳リクエストを消費し、新しいリクエストが到着したときに前のリクエストをキャンセルし、各リクエストのイベントを指定された制限付きチャネルへ転送します。

```rust
fn spawn_worker(
    requests: async_channel::Receiver<glossshift::llm::TranslationRequest>,
    events: async_channel::Sender<glossshift::llm::TranslationEvent>,
) {
    tokio::spawn(glossshift::llm::run_worker(requests, events));
}
```

### `cli::Cli` と `cli::ColorChoice`

`Cli` は `gshift` バイナリ用の Clap パーサーで、Markdown の `file`、必須の `lang`、`force`、`stdout`、`color` オプションを含みます。`ColorChoice` は `Auto`、`Always`、`Never` のいずれかで、`ColorChoice::enabled` は現在の stdout ターミナルで ANSI 出力が有効かどうかを解決します。

```rust
use std::io::IsTerminal as _;

fn main() {
    let color = glossshift::cli::ColorChoice::Auto.enabled(std::io::stdout().is_terminal());
    println!("color enabled: {color}");
}
```

### `cli::normalize_language`

ターゲット言語コードをトリムして小文字化し、空の値、先頭または末尾のハイフン、非 ASCII の英数字またはハイフン文字を拒否します。

```rust
fn normalize() -> anyhow::Result<String> {
    let language = glossshift::cli::normalize_language(" JA ")?;
    assert_eq!(language, "ja");
    Ok(language)
}
```

### `cli::target_path`

翻訳された同名ファイルのパスを解決し、`.mbt.md` を複合拡張子として保持し、既存の `.ja` または `.en` セグメントを置き換えます。

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

### `cli::highlight_markdown`

Tree-sitter クエリを使用して Markdown ハイライトイベントを ANSI スタイルのテキストに変換します。基になるソース文字は変更されません。

```rust
fn highlight() -> anyhow::Result<String> {
    glossshift::cli::highlight_markdown("# Heading\n")
}
```

### `selection::selected_text`

このデスクトップバイナリのヘルパーは、アクセシビリティ権限をチェックし、フォーカスされた要素の選択テキストを読み取り、必要な場合はシミュレートされた `Cmd+C` とペーストボードのポーリングにフォールバックします。シグネチャは `pub fn selected_text() -> anyhow::Result<String>` で、外部ライブラリのエントリポイントではなくデスクトップバイナリのプライベート関数です。

### `ui::PopupView`

このデスクトップバイナリのビューはポップアップ状態を所有し、`new`、`trigger_translation`、`handle_event`、`copy_source`、`copy_translation` を公開して、キャプチャ、ストリーミングイベント、ペインのコピーアクションを配線します。これらは外部ライブラリのエントリポイントではなく、デスクトップバイナリのシグネチャです。

## 開発

リポジトリ構造、開発コマンド、アーキテクチャ、完全な CLI リファレンスについては [AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

パッケージメタデータは MIT を宣言していますが、このリポジトリには現在 `LICENSE` ファイルは含まれていません。

_この README は [share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) と [README template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/readme/template.md) から生成されました。_