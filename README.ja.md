# GlossShift

GlossShift は、GPUI デスクトップポップアップとコマンドラインインターフェースを備えた macOS 専用の翻訳アプリケーションで、設定、プロンプト、資格情報、OpenAI 互換ストリーミングを共有します。

## 使い方

安定した macOS アプリケーション ID でデスクトップポップアップを起動します:

```bash
just run
```

アプリケーションバンドルを使わない開発では `just dev` を使用してください。macOS はバンドル識別子 (`com.totto2727.glossshift`) を識別できるため、アクセシビリティ権限を付与する際はビルド済みのアプリケーションが推奨されます。

別のアプリケーションでテキストを選択し、設定したグローバルショートカットを押すと、テキストを取得して翻訳します。デフォルトのショートカットは日本語用の `Ctrl+Super+KeyJ` で、`Super` は `global-hotkey` 構文における macOS の Command 修飾キーを意味します。

ポップアップは閉じても終了せずに非表示になり、標準ショートカットは `Cmd+Q` で終了、`Cmd+W` で非表示、`Cmd+C` で翻訳をコピー、`Cmd+Shift+C` で原文をコピーです。

共有プロバイダー設定で Markdown ファイルを 1 つ翻訳します:

```bash
just cli README.md --lang ja --force
```

CLI はデフォルトで言語サフィックス付きの兄弟ファイルを書き込むか、`--stdout` で翻訳を標準出力に書き込みます。完全なフラグ、パス、カラーリファレンスは [AGENTS.md](./AGENTS.md#cli-reference) にあります。

## 主な機能

- ネイティブタイトルバーの GPUI ポップアップ。サイズ変更が可能で、アプリケーションを終了せずに非表示にできます。
- ショートカットごとに個別のターゲット言語を持つグローバルショートカット。
- macOS Accessibility の選択範囲キャプチャ。フォーカスされた要素が選択テキストをエクスポートしない場合、シミュレートされた `Cmd+C` にフォールバックします。
- OpenAI Chat Completions API を実装した任意のサーバーによるストリーミング翻訳。カスタムベース URL とプロバイダーリクエストパラメータをサポートします。
- デスクトップアプリケーションと `gshift` CLI の共有 XDG 設定と資格情報。
- パイプライン用のプレーンなストリーム標準出力と、ターミナル用のオプションの Tree-sitter Markdown ANSI ハイライト。
- 原文と翻訳テキスト用のフルペインコピーコントロール。
- ローカル推論ランタイムや llama 統合なし。

## 前提条件

- **macOS**: GlossShift は現在 macOS のみをサポートしています。
- **Rust と Cargo**: Rust 1.85 以降が必要です。このリポジトリは現在 Rust 1.95 でビルドされています。
- **アクセシビリティ権限**: 選択範囲をキャプチャし、フォールバックの `Cmd+C` を送信するアプリケーションバンドルまたはターミナルに権限を付与します。
- **OpenAI 互換の資格情報**: Chat Completions を実装するサーバーを通じて API キーとモデルを提供します。
- **Xcode Command Line Tools**: GPUI の `runtime_shaders` 機能には、完全な Xcode インストールのスタンドアロン Metal コンパイラは必要ありません。

## セットアップ

1. リポジトリをクローンして移動します。

```bash
git clone https://github.com/totto2727-org/glossshift.git
cd glossshift
```

2. 署名付きローカルアプリケーションバンドルをビルドして開きます。

```bash
just run
```

3. 初回起動時に `~/.config/glossshift/credentials.toml` を編集し、`replace-me` をプロバイダーの API キーに置き換え、必要に応じて `~/.config/glossshift/config.toml` を調整します。

4. システム設定 > プライバシーとセキュリティ > アクセシビリティで `GlossShift.app` にアクセシビリティ権限を付与し、別のアプリケーションでテキストを選択して設定したショートカットを使用します。

アプリケーションはデフォルトのプロバイダー、日本語ショートカット、ウィンドウサイズで `config.toml` を作成し、モード `0600` で `credentials.toml` を作成します。プロバイダーと資格情報は名前でリンクされるため、資格情報は通常の設定から分離されたままになります。

設定ルートはデフォルトで `~/.config/glossshift` で、`XDG_CONFIG_HOME` を尊重します。隔離されたローカル実行では、`just dev` の前に `XDG_CONFIG_HOME=/tmp/glossshift-test` を設定してください。Rig が Chat Completions ルートを追加するため、プロバイダーのベース URL には通常 `/v1` である API プレフィックスを含める必要があります。

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

完全なスターターファイルは [`examples/config.toml`](examples/config.toml) と [`examples/credentials.toml`](examples/credentials.toml) を参照してください。ターゲット言語ごとに `[[shortcuts]]` テーブルを 1 つ追加します。すべてのショートカットキーは一意でなければならず、すべてのターゲット言語は空であってはなりません。

## API

GlossShift にはメンテナンスされた API レジストリがないため、公開 Rust API は以下にインラインで文書化されています。ライブラリを `glossshift` としてインポートしてください。

### `config::DEFAULT_CONFIG`

`config::load_or_initialize` が使用するデフォルトの `config.toml` テンプレートを提供します。

```rust
let source = glossshift::config::DEFAULT_CONFIG;
let config = glossshift::config::parse_config(source)?;
```

### `config::AppConfig`、`config::ProviderConfig`、`config::TranslationConfig`、`config::ShortcutConfig`、`config::WindowConfig`、および `config::LoadedConfig`

これらの公開データ型は、検証済みのアプリケーション設定、プロバイダーエンドポイントとタイムアウト設定、ソース言語設定、ターゲット言語ショートカット、ポップアップサイズ、および読み込まれた API キーと設定ディレクトリを表します。`ProviderConfig::request_parameters` は、オプションの JSON フィールドを変更せずに Rig に渡します。

```rust
let provider = config.provider()?;
println!("{} via {}", provider.model, provider.base_url);
```

### `config::AppConfig::provider`

`active_provider` によって選択されたプロバイダーを返します。その名前が設定されていない場合はエラーを返します。

```rust
let provider = app_config.provider()?;
```

### `config::parse_config`

TOML を解析し、アクティブなプロバイダー、ポップアップサイズ、ショートカットリスト、ターゲット言語、重複するホットキーを検証します。

```rust
let app = glossshift::config::parse_config(toml_source)?;
```

### `config::load_or_initialize`

XDG 設定ディレクトリを解決し、不足している設定と資格情報テンプレートを作成し、資格情報モード `0600` を強制し、アクティブな API キーを含む `LoadedConfig` を返します。

```rust
let loaded = glossshift::config::load_or_initialize()?;
```

### `prompt::translation_prompt`

意味、トーン、段落、書式を保持しながら、共有の翻訳専用プロンプトを構築します。

```rust
let prompt = glossshift::prompt::translation_prompt("auto", "Japanese", markdown);
```

### `llm::RequestId` と `llm::TranslationRequest`

`RequestId` は 1 つのストリームを識別し、コンシューマーが古いイベントを無視できるようにします。`TranslationRequest` は、その ID、`ProviderConfig`、API キー、ソース言語とターゲット言語、ソーステキストを保持します。

```rust
let request = glossshift::llm::TranslationRequest {
    id: glossshift::llm::RequestId(1),
    provider: provider.clone(),
    api_key,
    source_language: "auto".into(),
    target_language: "Japanese".into(),
    text: markdown.into(),
};
```

### `llm::TranslationEvent` と `TranslationEvent::request_id`

`TranslationEvent` は、リクエストの `Started`、ストリーミングされた `Delta`、`Finished`、または `Failed` を報告し、`request_id()` はイベントに関連付けられた `RequestId` を返します。

```rust
if event.request_id() == glossshift::llm::RequestId(1) {
    handle_event(event);
}
```

### `llm::translate`

1 つの `TranslationRequest` を Rig 経由で `async_channel::Sender<TranslationEvent>` にストリーミングし、`CancellationToken` を監視します。プロバイダー、タイムアウト、またはチャネルクローズの失敗に対してエラーを返します。

```rust
glossshift::llm::translate(request, events, tokio_util::sync::CancellationToken::new()).await?;
```

### `llm::run_worker`

有界の翻訳リクエストを消費し、新しいリクエストが到着すると以前のリクエストをキャンセルし、各リクエストのイベントを指定された有界チャネルに転送します。

```rust
tokio::spawn(glossshift::llm::run_worker(requests, events));
```

### `cli::Cli` と `cli::ColorChoice`

`Cli` は `gshift` バイナリの Clap パーサーで、Markdown の `file`、必須の `lang`、`force`、`stdout`、`color` オプションを含みます。`ColorChoice` は `Auto`、`Always`、または `Never` です。`ColorChoice::enabled` は、現在の stdout ターミナルで ANSI 出力が有効かどうかを解決します。

```rust
let color = glossshift::cli::ColorChoice::Auto.enabled(std::io::stdout().is_terminal());
```

### `cli::normalize_language`

ターゲット言語コードをトリミングして小文字にし、空の値、先頭または末尾のハイフン、非 ASCII の英数字またはハイフン文字を拒否します。

```rust
let language = glossshift::cli::normalize_language(" JA ")?;
assert_eq!(language, "ja");
```

### `cli::target_path`

翻訳された兄弟パスを解決し、`.mbt.md` を複合拡張子として保持し、既存の `.ja` または `.en` セグメントを置き換えます。

```rust
let output = glossshift::cli::target_path(std::path::Path::new("guide.en.mbt.md"), "ja")?;
assert_eq!(output, std::path::Path::new("guide.ja.mbt.md"));
```

### `cli::highlight_markdown`

Tree-sitter クエリを使用して、基になるソース文字を変更せずに Markdown ハイライトイベントを ANSI スタイルのテキストに変換します。

```rust
let ansi = glossshift::cli::highlight_markdown("# Heading\n")?;
```

## 開発

リポジトリ構造、開発コマンド、アーキテクチャ、完全な CLI リファレンスについては、[AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

MIT

_この README は [share-artifact スキル](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) と [README テンプレート](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/readme/template.md) から生成されました。_
