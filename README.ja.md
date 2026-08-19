# GlossShift

GlossShiftは、設定、プロンプト、認証情報、OpenAI互換ストリーミングを共有する、macOS専用の翻訳アプリケーションです。GPUIデスクトップポップアップとコマンドラインインターフェースを備えています。

## 使用方法

安定したmacOSアプリケーション識別子でデスクトップポップアップを起動します。

```bash
just run
```

アプリケーションバンドルを使わずに開発する場合は`just dev`を使用します。macOSがバンドル識別子（`com.totto2727.glossshift`）を識別できるため、Accessibility権限を付与する際にはビルド済みアプリケーションが推奨されます。

別のアプリケーションでテキストを選択し、設定したグローバルショートカットを押すと、そのテキストを取得して翻訳できます。デフォルトのショートカットは日本語用の`Ctrl+Super+KeyJ`です。`Super`は`global-hotkey`構文におけるmacOSのCommand修飾キーを意味します。

ポップアップは閉じたときに終了せず非表示になります。標準ショートカットは、終了が`Cmd+Q`、非表示が`Cmd+W`、翻訳のコピーが`Cmd+C`、原文のコピーが`Cmd+Shift+C`です。

共有プロバイダー設定で1つ以上のMarkdownファイルを翻訳します。

```bash
just cli README.md AGENTS.md --lang ja --force
```

CLIは入力順にファイルを処理します。デフォルトでは入力ごとに言語サフィックス付きの同階層ファイルを書き込みます。`--stdout`を指定すると、区切り文字を挿入せず、その順序で翻訳を連結します。フラグ、パス、色に関する完全なリファレンスは[AGENTS.md](./AGENTS.md#cli-reference)にあります。

## 主な機能

- アプリケーションを終了せずにサイズ変更および非表示にできる、ネイティブタイトルバー付きのGPUIポップアップ。
- ショートカットごとに個別の対象言語を設定できるグローバルショートカット。
- macOS Accessibilityによる選択範囲の取得。フォーカスされた要素が選択テキストを提供しない場合は、シミュレートした`Cmd+C`によるフォールバックを使用。
- カスタムベースURLやプロバイダーリクエストパラメーターを含む、OpenAI Chat Completions APIを実装する任意のサーバーを通じたストリーミング翻訳。
- デスクトップアプリケーションと`gshift` CLIで共有するXDG設定および認証情報。
- パイプライン用のプレーンなストリーミングstdoutと、ターミナル向けのオプションのTree-sitter Markdown ANSIハイライト。
- 原文と翻訳テキストをペイン全体からコピーする操作。
- ローカル推論ランタイムやllama統合はありません。

## 前提条件

- **macOS**: GlossShiftは現在macOSのみをサポートしています。
- **RustとCargo**: Rust 1.85以降が必要です。
- **Just**: ドキュメント化された`just`レシピが開発、パッケージング、CLIのワークフローを提供します。
- **Nix（オプション）**: `nix develop`は再現可能なDarwin開発シェルでRustツールチェーンとJustを提供します。これらがまだインストールされていない場合に使用してください。
- **Accessibility権限**: 選択範囲を取得し、フォールバックの`Cmd+C`を送信するアプリケーションバンドルまたはターミナルに権限を付与してください。
- **OpenAI互換認証情報**: Chat Completionsを実装するサーバーを通じてAPIキーとモデルを提供してください。
- **Xcode Command Line Tools**: GPUIの`runtime_shaders`機能には、完全なXcodeインストールに含まれる単独のMetalコンパイラーは必要ありません。

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

3. 初回起動時に`~/.config/glossshift/credentials.toml`を編集し、`replace-me`をプロバイダーAPIキーに置き換えます。必要に応じて`~/.config/glossshift/config.toml`も調整してください。

4. システム設定 > Privacy & Security > Accessibilityで`GlossShift.app`にAccessibility権限を付与し、別のアプリケーションでテキストを選択して設定済みのショートカットを使用します。

アプリケーションは、デフォルトプロバイダー、日本語ショートカット、ウィンドウ寸法を含む`config.toml`を作成し、モード`0600`の`credentials.toml`を作成します。プロバイダーと認証情報は名前でリンクされるため、認証情報は通常の設定とは分離されたままになります。

設定ルートはデフォルトで`~/.config/glossshift`となり、`XDG_CONFIG_HOME`を使用します。分離されたローカル実行には、`just dev`の前に`XDG_CONFIG_HOME=/tmp/glossshift-test`を設定してください。RigがChat Completionsのルートを追加するため、プロバイダーのベースURLには通常`/v1`などのAPIプレフィックスを含める必要があります。

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

完全なスターターファイルについては、[`examples/config.toml`](examples/config.toml)と[`examples/credentials.toml`](examples/credentials.toml)を参照してください。対象言語ごとに`[[shortcuts]]`テーブルを1つ追加します。すべてのショートカットキーは一意であり、すべての対象言語は空でない必要があります。

## API

GlossShiftには保守されたAPIレジストリがないため、公開Rust APIは以下にインラインで記載されています。ライブラリは`glossshift`としてインポートします。

### `config::DEFAULT_CONFIG`

`config::load_or_initialize`が使用するデフォルトの`config.toml`テンプレートを提供します。

```rust
fn default_config() -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(glossshift::config::DEFAULT_CONFIG)
}
```

### `config::AppConfig`、`config::ProviderConfig`、`config::TranslationConfig`、`config::ShortcutConfig`、`config::WindowConfig`、`config::LoadedConfig`

これらの公開データ型は、検証済みのアプリケーション設定、プロバイダーのエンドポイントとタイムアウト設定、原言語設定、対象言語ショートカット、ポップアップ寸法、読み込まれたAPIキーおよび設定ディレクトリを表します。`ProviderConfig::request_parameters`はオプションのJSONフィールドを変更せずにRigへ渡します。

```rust
fn active_provider(
    config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    config.provider()
}
```

### `config::AppConfig::provider`

`active_provider`で選択されたプロバイダーを返します。その名前が設定されていない場合はエラーを返します。

```rust
fn active_provider(
    app_config: &glossshift::config::AppConfig,
) -> anyhow::Result<&glossshift::config::ProviderConfig> {
    app_config.provider()
}
```

### `config::parse_config`

TOMLを解析し、アクティブなプロバイダー、ポップアップ寸法、ショートカット一覧、対象言語、重複するホットキーを検証します。

```rust
fn parse(source: &str) -> anyhow::Result<glossshift::config::AppConfig> {
    glossshift::config::parse_config(source)
}
```

### `config::load_or_initialize`

XDG設定ディレクトリを解決し、不足している設定および認証情報テンプレートを作成し、認証情報のモード`0600`を強制し、アクティブなAPIキーを含む`LoadedConfig`を返します。

```rust
fn load() -> anyhow::Result<glossshift::config::LoadedConfig> {
    glossshift::config::load_or_initialize()
}
```

### `prompt::translation_system_prompt`および`prompt::translation_user_prompt`

システムメッセージとして翻訳契約を構築し、入力ドキュメントを唯一のユーザーコンテンツとして渡します。ドキュメントは不活性なコンテンツとして扱われ、構造を変更せずに一対一で翻訳されます。原言語が`auto`の場合、モデルに言語の検出を指示します。

```rust
fn main() {
    let system = glossshift::prompt::translation_system_prompt("auto", "Japanese");
    let user = glossshift::prompt::translation_user_prompt("# Heading\n");
    println!("{system}\n\n{user}");
}
```

### `llm::RequestId`および`llm::TranslationRequest`

`RequestId`は1つのストリームを識別し、コンシューマーが古いイベントを無視できるようにします。`TranslationRequest`は、そのID、`ProviderConfig`、APIキー、原言語と対象言語、原文を保持します。

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

### `llm::TranslationEvent`および`TranslationEvent::request_id`

`TranslationEvent`はリクエストについて`Started`、ストリーミングされた`Delta`、`Finished`、または`Failed`を報告し、`request_id()`はイベントに関連付けられた`RequestId`を返します。

```rust
fn is_current(event: &glossshift::llm::TranslationEvent) -> bool {
    event.request_id() == glossshift::llm::RequestId(1)
}
```

### `llm::translate`

1つの`TranslationRequest`をRigを通じて`async_channel::Sender<TranslationEvent>`へストリーミングし、`CancellationToken`を監視します。プロバイダー、タイムアウト、またはクローズされたチャネルによる失敗の場合はエラーを返します。

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

有界の翻訳リクエストを消費し、新しいリクエストが到着したときに以前のリクエストをキャンセルし、各リクエストのイベントを指定された有界チャネルへ転送します。

```rust
fn spawn_worker(
    requests: async_channel::Receiver<glossshift::llm::TranslationRequest>,
    events: async_channel::Sender<glossshift::llm::TranslationEvent>,
) {
    tokio::spawn(glossshift::llm::run_worker(requests, events));
}
```

### `cli::Cli`および`cli::ColorChoice`

`Cli`は`gshift`バイナリのClapパーサーです。入力順の1つ以上のMarkdown`files`と、必須の`lang`、`force`、`stdout`、`color`オプションを含みます。`ColorChoice`は`Auto`、`Always`、または`Never`です。`ColorChoice::enabled`は、現在のstdoutターミナルでANSI出力を有効にするかどうかを解決します。

```rust
use std::io::IsTerminal as _;

fn main() {
    let color = glossshift::cli::ColorChoice::Auto.enabled(std::io::stdout().is_terminal());
    println!("color enabled: {color}");
}
```

### `cli::normalize_language`

対象言語コードの前後の空白を取り除いて小文字化し、空の値、先頭または末尾のハイフン、ASCII英数字またはハイフン以外の文字を拒否します。

```rust
fn normalize() -> anyhow::Result<String> {
    let language = glossshift::cli::normalize_language(" JA ")?;
    assert_eq!(language, "ja");
    Ok(language)
}
```

### `cli::target_path`

翻訳された同階層パスを解決します。`.mbt.md`を複合拡張子として保持し、既存の`.ja`または`.en`セグメントを置き換えます。

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

翻訳開始前にバッチ全体を検証し、既存のハードリンク別名や大文字小文字のみが異なるパスの衝突を含め、入力または別の出力と衝突する出力パスを拒否します。シンボリックリンク出力は、`force`がリンク自体の置き換えを許可しない限り拒否されます。

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

基礎となる原文の文字を変更せず、Tree-sitterクエリを使用してMarkdownハイライトイベントをANSIスタイル付きテキストに変換します。

```rust
fn highlight() -> anyhow::Result<String> {
    glossshift::cli::highlight_markdown("# Heading\n")
}
```

### `selection::selected_text`

このデスクトップバイナリヘルパーはAccessibility権限を確認し、フォーカスされた要素の選択テキストを読み取ります。必要に応じて、シミュレートした`Cmd+C`とペーストボードのポーリングにフォールバックします。シグネチャは`pub fn selected_text() -> anyhow::Result<String>`です。外部ライブラリエントリーポイントではなく、デスクトップバイナリに対してプライベートです。

### `ui::PopupView`

このデスクトップバイナリビューはポップアップ状態を所有し、取得、ストリーミングイベント、ペインのコピー操作を接続するために`new`、`trigger_translation`、`handle_event`、`copy_source`、`copy_translation`を公開します。これらは外部ライブラリエントリーポイントではなく、デスクトップバイナリのシグネチャです。

## 開発

リポジトリ構造、開発コマンド、アーキテクチャ、完全なCLIリファレンスについては、[AGENTS.md](./AGENTS.md)を参照してください。

## ライセンス

パッケージメタデータではMITが宣言されていますが、このリポジトリには現在`LICENSE`ファイルが含まれていません。

_このREADMEは、[share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md)および[README template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/readme/template.md)から生成されました。_