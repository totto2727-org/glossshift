# GlossShift

GlossShiftは、設定、プロンプト、認証情報、OpenAI互換のストリーミングを共有する、GPUIデスクトップポップアップとコマンドラインインターフェースを備えたmacOS専用の翻訳アプリケーションです。

## 使用方法

安定したmacOSアプリケーションとしてデスクトップポップアップを起動します。

```bash
just run
```

アプリケーションバンドルなしで開発する場合は `just dev` を使用してください。macOSはバンドル識別子（`com.totto2727.glossshift`）を識別できるため、Accessibility権限を付与する際にはビルド済みアプリケーションの使用が推奨されます。

別のアプリケーションでテキストを選択し、設定済みのグローバルショートカットを押して選択範囲をキャプチャして翻訳します。既定のショートカットは日本語用の `Ctrl+Super+KeyJ` で、`Super` は `global-hotkey` 構文におけるmacOSのCommand修飾キーを意味します。

ポップアップは閉じても終了せずに非表示になり、標準ショートカットは終了が `Cmd+Q`、非表示が `Cmd+W`、翻訳のコピーが `Cmd+C`、原文のコピーが `Cmd+Shift+C` です。

共有プロバイダー設定で1つのMarkdownファイルを翻訳します。

```bash
just cli README.md --lang ja --force
```

CLIは既定では言語サフィックス付きの兄弟ファイルを書き込み、`--stdout` で翻訳を標準出力に書き出します。完全なフラグ、パス、カラーリファレンスは [AGENTS.md](./AGENTS.md#cli-reference) にあります。

## 主な機能

- アプリケーションを終了せずにリサイズや非表示ができる、ネイティブタイトルバーのGPUIポップアップ。
- ショートカットごとに個別のターゲット言語を設定できるグローバルショートカット。
- フォーカスされた要素が選択テキストをエクスポートしない場合に、シミュレートされた `Cmd+C` フォールバックを使用するmacOS Accessibility選択範囲キャプチャ。
- カスタムベースURLやプロバイダーのリクエストパラメータを含む、OpenAI Chat Completions APIを実装した任意のサーバーによるストリーミング翻訳。
- デスクトップアプリケーションと `gshift` CLIで共有するXDG設定と認証情報。
- パイプライン用のプレーンなストリーミング標準出力と、ターミナル用のオプションのTree-sitter Markdown ANSIハイライト。
- 原文と翻訳テキストの全ペインコピーコントロール。
- ローカル推論ランタイムやllama統合はありません。

## 前提条件

- **macOS**: GlossShiftは現在macOSのみをサポートしています。
- **RustとCargo**: Rust 1.85以降が必要です。
- **Just**: 文書化された `just` レシピが開発、パッケージング、CLIのワークフローを提供します。
- **Nix（オプション）**: `nix develop` は再現可能なDarwin開発シェルでRustツールチェーンとJustを提供します。これらのツールがインストールされていない場合に使用してください。
- **Accessibility権限**: 選択範囲をキャプチャしてフォールバックの `Cmd+C` を送信するアプリケーションバンドルまたはターミナルに権限を付与します。
- **OpenAI互換の認証情報**: Chat Completionsを実装するサーバーを通じてAPIキーとモデルを提供します。
- **Xcode Command Line Tools**: GPUIの `runtime_shaders` 機能は、完全なXcodeインストールのスタンドアロンMetalコンパイラを必要としません。

## セットアップ

1. リポジトリをクローンして移動します。

```bash
git clone https://github.com/totto2727-org/glossshift.git
cd glossshift
```

2. 署名済みのローカルアプリケーションバンドルをビルドして開きます。

```bash
just run
```

3. 初回起動時に `~/.config/glossshift/credentials.toml` を編集して `replace-me` をプロバイダーのAPIキーに置き換え、必要に応じて `~/.config/glossshift/config.toml` を調整します。

4. システム設定 > プライバシーとセキュリティ > アクセシビリティで `GlossShift.app` にAccessibility権限を付与し、別のアプリケーションでテキストを選択して設定済みのショートカットを使用します。

アプリケーションはデフォルトのプロバイダー、日本語ショートカット、ウィンドウ寸法で `config.toml` を作成し、モード `0600` で `credentials.toml` を作成します。プロバイダーと認証情報は名前でリンクされるため、認証情報は通常の設定から分離されたままになります。

設定ルートは既定で `~/.config/glossshift` になり、`XDG_CONFIG_HOME` を尊重します。分離したローカル実行には `just dev` の前に `XDG_CONFIG_HOME=/tmp/glossshift-test` を設定してください。プロバイダーのベースURLには、RigがChat Completionsルートを追記するため、通常 `/v1` のAPIプレフィックスを含める必要があります。

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

完全なスターターファイルは [`examples/config.toml`](examples/config.toml) と [`examples/credentials.toml`](examples/credentials.toml) を参照してください。ターゲット言語ごとに1つの `[[shortcuts]]` テーブルを追加します。すべてのショートカットキーは一意で、すべてのターゲット言語は空であってはなりません。

## API

GlossShiftには管理されたAPIレジストリがないため、公開Rust APIは以下にインラインで文書化されています。ライブラリを `glossshift` としてインポートしてください。

### `config::DEFAULT_CONFIG`

`config::load_or_initialize` が使用するデフォルトの `config.toml` テンプレートを提供します。

```rust
fn default_config() -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(glossshift::config::DEFAULT_CONFIG)
}
```

### `config::AppConfig`、`config::ProviderConfig`、`config::TranslationConfig`、`config::ShortcutConfig`、`config::WindowConfig`、`config::LoadedConfig`

これらの公開データ型は、検証済みのアプリケーション設定、プロバイダーのエンドポイントとタイムアウト設定、ソース言語設定、ターゲット言語のショートカット、ポップアップの寸法、読み込まれたAPIキーと設定ディレクトリを表します。`ProviderConfig::request_parameters` はオプションのJSONフィールドを変更せずにRigへ運びます。

```rust
fn active_provider(
    config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    config.provider()
}
```

### `config::AppConfig::provider`

`active_provider` が選択したプロバイダーを返し、その名前が設定されていない場合はエラーを返します。

```rust
fn active_provider(
    app_config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    app_config.provider()
}
```

### `config::parse_config`

TOMLを解析し、アクティブなプロバイダー、ポップアップの寸法、ショートカットリスト、ターゲット言語、重複するホットキーを検証します。

```rust
fn parse(source: &str) -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(source)
}
```

### `config::load_or_initialize`

XDG設定ディレクトリを解決し、不足している設定と認証情報のテンプレートを作成し、認証情報モード `0600` を強制し、アクティブなAPIキーを持つ `LoadedConfig` を返します。

```rust
fn load() -> anyhow::Result<glossshift::config::LoadedConfig> {
    glossshift::config::load_or_initialize()
}
```

### `prompt::translation_prompt`

意味、トーン、段落、書式を保ちながら、共有の翻訳専用プロンプトを構築します。

```rust
let prompt = glossshift::prompt::translation_prompt("auto", "Japanese", "# Heading\n");
```

### `llm::RequestId` と `llm::TranslationRequest`

`RequestId` は1つのストリームを識別し、コンシューマーが古いイベントを無視できるようにします。`TranslationRequest` はそのID、`ProviderConfig`、APIキー、ソース言語とターゲット言語、ソーステキストを運びます。

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

`TranslationEvent` はリクエストの `Started`、ストリームされた `Delta`、`Finished`、または `Failed` を報告し、`request_id()` はイベントに関連付けられた `RequestId` を返します。

```rust
fn is_current(event: &glossshift::llm::TranslationEvent) -> bool {
    event.request_id() == glossshift::llm::RequestId(1)
}
```

### `llm::translate`

1つの `TranslationRequest` をRigを通じて `async_channel::Sender<TranslationEvent>` にストリームし、`CancellationToken` を監視します。プロバイダー、タイムアウト、または閉じられたチャネルの失敗に対してエラーを返します。

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

制限付きの翻訳リクエストを消費し、新しいリクエストが到着すると前のリクエストをキャンセルし、各リクエストのイベントを提供された制限付きチャネルに転送します。

```rust
fn spawn_worker(
    requests: async_channel::Receiver<glossshift::llm::TranslationRequest>,
    events: async_channel::Sender<glossshift::llm::TranslationEvent>,
) {
    tokio::spawn(glossshift::llm::run_worker(requests, events));
}
```

### `cli::Cli` と `cli::ColorChoice`

`Cli` は `gshift` バイナリのClapパーサーで、Markdownの `file`、必須の `lang`、`force`、`stdout`、`color` オプションを含みます。`ColorChoice` は `Auto`、`Always`、`Never` のいずれかで、`ColorChoice::enabled` は現在の標準出力ターミナルでANSI出力が有効かどうかを解決します。

```rust
use std::io::IsTerminal as _;

let color = glossshift::cli::ColorChoice::Auto.enabled(std::io::stdout().is_terminal());
```

### `cli::normalize_language`

ターゲット言語コードをトリムして小文字にし、空の値、先頭または末尾のハイフン、非ASCIIの英数字またはハイフン文字を拒否します。

```rust
fn normalize() -> anyhow::Result<String> {
    let language = glossshift::cli::normalize_language(" JA ")?;
    assert_eq!(language, "ja");
    Ok(language)
}
```

### `cli::target_path`

翻訳された兄弟パスを解決し、`.mbt.md` を複合拡張子として保持し、既存の `.ja` または `.en` セグメントを置き換えます。

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

Markdownハイライトイベントを、基礎となるソース文字を変更せずにTree-sitterクエリを使用してANSIスタイル付きテキストに変換します。

```rust
fn highlight() -> anyhow::Result<String> {
    glossshift::cli::highlight_markdown("# Heading\n")
}
```

## 開発

リポジトリ構造、開発コマンド、アーキテクチャ、完全なCLIリファレンスについては、[AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

パッケージメタデータはMITを宣言していますが、このリポジトリには現在 `LICENSE` ファイルは含まれていません。

_This README was generated from the [share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) and [README template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/readme/template.md)._