# GlossShift

## リポジトリ構造

```text
src/lib.rs            共有公開ライブラリモジュール
src/config.rs         XDG設定と認証情報の読み込み
src/prompt.rs         翻訳プロンプトの構築
src/llm.rs            Rigストリーミングワーカーとリクエストイベント
src/cli.rs            公開CLIパス、言語、Markdown描画ヘルパー
src/bin/gshift.rs     Markdown翻訳CLIバイナリ
src/main.rs           GPUIデスクトップバイナリの配線
src/selection.rs      macOSのAccessibilityとクリップボードのフォールバック
src/ui.rs             GPUIポップアップビューとアクション
examples/             スターター用TOML設定と認証情報
packaging/            macOSアプリケーションメタデータ
Justfile              ローカル開発およびパッケージングレシピ
flake.nix             Darwinパッケージ、オーバーレイ、開発シェル
package.nix           Nix Rustパッケージ定義
```

## 開発コマンド

### 実行ルール

- リポジトリルートからコマンドを実行してください。
- プロジェクトが明示的にプラットフォーム範囲を拡大するまで、macOSのみをサポートします。
- 以下に示す名前付きのJustレシピをアドホックなシェルワークフローの代わりに使用してください。レシピが目的のターゲットを表現できない場合にのみ、Cargoを直接使用してください。
- ソースコード、設定例、コミットメッセージ、ソースドキュメントは英語で記述してください。`README.md` と `AGENTS.md` が正規の文書であり、その日本語翻訳は `mdt` で生成されます。
- 別の `CLAUDE.md` を作成せず、`AGENTS.md` を正規のエージェント文書として維持してください。
- 明示的に要求されない限り、本物の認証情報をコミットせず、APIキーをログに記録せず、失敗しているテストやlintを弱めず、リモートを変更せず、ブランチをプッシュせず、このリポジトリからプルリクエストを作成しないでください。

### 標準タスク

- `just fix` — フォーマットとClippy修正を適用します。
- `just fix-format` — `cargo fmt --all` で全てのRustソースをフォーマットします。
- `just fix-lint` — 全ターゲット・機能・警告拒否を有効にしてClippy修正を適用します。
- `just check` — フォーマットとClippyチェックを実行します。
- `just check-format` — ファイルを変更せずにRustのフォーマットをチェックします。
- `just check-lint` — すべてのターゲットと機能に対して厳格なClippyチェックを実行します。
- `just test` — Rustユニットテストを実行します。
- `just build` — デバッグバイナリをビルドします。
- `just ci` — 完全なローカルチェック、テスト、ビルドのゲートを実行します。
- `just dev` — Cargoでデスクトップバイナリを直接実行します。
- `just run` — `target/GlossShift.app` をビルド、アドホック署名、検証、起動します。
- `just package-app` — アプリケーションバンドルを開かずにビルドおよび検証します。
- `just cli README.md --lang ja` — 指定された引数でCargoを通じて `gshift` を実行します。
- `mdt --lang ja --force README.md` — 日本語READMEソース出力を再生成します。
- `mdt --lang ja --force AGENTS.md` — 日本語AGENTSソース出力を再生成します。

### CLIリファレンス

リポジトリルートから `just cli FILE --lang LANGUAGE [OPTIONS]` でCLIを実行してください。同等の直接コマンドは `cargo run --bin gshift -- FILE --lang LANGUAGE [OPTIONS]` です。`gshift` バイナリは常にデスクトップアプリケーションのXDG設定、アクティブなプロバイダー、ソース言語、タイムアウト値、名前付き認証情報を再利用します。個別のモデル、プロンプト、トークン設定はありません。

位置引数 `FILE` は `.md` または `.mbt.md` 拡張子を持つMarkdownでなければなりません。`--lang`/`-l` は必須で、文字、数字、内部ハイフンのみを含む空でないASCII言語コードを受け付けます。使用前にトリムされ、小文字化されます。`--force`/`-f` は既存の兄弟出力の置き換えを許可し、`--stdout` と競合します。`--stdout` はファイルの代わりに標準出力へ翻訳を書き込みます。`--color auto|always|never` はANSI Markdownハイライトを制御し、`--stdout` が必要で、デフォルトは `auto` です。

`--stdout` がない場合、CLIは `.md` の前に `.<language>` を挿入して兄弟パスを作成し、複合 `.mbt.md` 拡張子を保持し、既存の末尾の `.ja` または `.en` セグメントを置き換えます。`--force` が存在しない限り既存の出力を拒否し、ファイルにANSIエスケープを書き込むことはありません。

`--stdout --color auto` の場合、リダイレクトされた標準出力はバイトプレーンのままで、各プロバイダーデルタは即座にフラッシュされます。一方、ターミナル標準出力は完了までバッファリングされ、その後Tree-sitter Markdown ANSIスタイルで描画されます。`--color never` はターミナル上でも出力をプレーンなままストリーミングします。`--color always` は完了した翻訳をバッファリングし、標準出力がリダイレクトされていてもANSIスタイルを出力します。

例:

```bash
just cli docs/guide.md --lang ja
just cli docs/guide.mbt.md --lang ja --force
just cli README.md --lang ja --stdout
just cli README.md --lang ja --stdout --color always
```

### 設定と認証情報

共有設定ルートは `xdg::BaseDirectories` を通じて解決され、デフォルトは `~/.config/glossshift` で、`XDG_CONFIG_HOME` を尊重します。`config.toml` は `active_provider` を名前付きプロバイダーにリンクし、各プロバイダーを `credentials.toml` 内の名前付き認証情報にリンクします。認証情報の権限は常に `0600` にリセットされます。ショートカット文字列、TOMLコンテンツ、Accessibilityの値、HTTPレスポンスは信頼できない境界入力として扱ってください。

アクティブなプロバイダーは空でない `base_url` と `model` を必要とします。タイムアウトのデフォルトは、最初のチャンクで15秒、ストリームアイドル期間で30秒です。オプションの `[providers.<name>.request_parameters]` JSONフィールドはRigを通じて変更されずに転送されます。ショートカットには一意のホットキーと空でないターゲット言語が必要で、ウィンドウ寸法は正で、設定された最小値以上でなければなりません。

## アーキテクチャ

### 共有ライブラリ境界

再利用可能なライブラリはXDG設定、プロンプト構築、プロバイダーストリーミングを所有しているため、デスクトップとCLIのバイナリは同じプロバイダー契約を使用します。`config.rs` はトークンを通常のTOMLから分離し、`prompt.rs` は翻訳専用のプロンプトを構築し、`llm.rs` はリクエストスコープの `TranslationEvent` 値を出力します。

### デスクトップ境界

GPUIアプリケーションスレッドは、ポップアップエンティティ、グローバルホットキーマネージャー、ウィンドウアクション、共有の2ワーカーTokioランタイムを所有します。`selection.rs` はmacOSのAccessibilityとクリップボードAPIにアクセスする唯一のモジュールであり、`ui.rs` はGPUIビューの状態を変更する唯一のモジュールです。ポップアップは閉じられたときもウィンドウを存続させ、新しいショートカットが開始されたときに古いストリームをキャンセルし、`RequestId` が古いイベントを無視します。

### CLI境界

`cli.rs` は言語検証、Markdown兄弟パス解決、Tree-sitter ANSI描画を所有します。`gshift` はファイル/標準出力のI/Oを所有し、共有の `llm::translate` 関数に供給します。有界チャネルがデスクトップUIとストリーミングワーカーを分離し、キャンセルはプロバイダーストリーム境界で監視されます。

### パッケージング境界

両方のバイナリがRustおよびNixパッケージ出力に含まれています。デフォルトのflakeオーバーレイは、一致する `meta.mainProgram` 値を持つ `glossshift` と `gshift` を公開し、パッケージ導出は安定した `GlossShift.app` バンドルレイアウトを通じてデスクトップバイナリを公開します。

## 開発ツール

- **RustとCargo**: `unsafe_code` の禁止と厳格なClippy lintを使用して、2024エディションのパッケージをコンパイル、テスト、フォーマット、lintします。
- **Just**: リポジトリの名前付き開発、検証、CLI、macOSパッケージングワークフローを提供します。
- **Nix flakes**: Darwinパッケージ出力、再利用可能なオーバーレイ、開発シェルを提供します。
- **GPUI**: ネイティブタイトルバー付きのリサイズ可能なデスクトップポップアップとアプリケーションスレッドUIモデルを提供します。
- **Rig**: カスタム互換ベースURLを含むOpenAI Chat Completionsストリーミングを提供します。
- **global-hotkeyおよびmacOS Accessibilityクレート**: グローバルショートカット登録と安全な選択範囲キャプチャ境界を提供します。
- **Tree-sitter**: 色付きターミナル出力のためのMarkdown構文ハイライトを提供します。

## パッケージ固有のルール

- 実用的な範囲で本番ソースファイルを250行未満に保ち、既存のモジュール責任境界を維持してください。
- コールバック、UI、CLI、ネットワーク境界全体で有界チャネルを使用し、すべてのストリーミングイベントにリクエストIDを添付してください。
- 新しい翻訳を開始する前にアクティブなストリームをキャンセルし、古いイベントが現在のUI状態を上書きしないようにしてください。
- 自動カラーモードでは、生成ファイルとリダイレクトされた標準出力からANSIエスケープを排除してください。
- どちらかのソース文書が変更された後、英語ソースの隣に `README.ja.md` と `AGENTS.ja.md` を再生成してコミットしてください。
- 両方のソース文書の相対リンクと、各英語ソースの末尾にある共有アーティファクトの出典フッターを正確に保持してください。

_このAGENTS.mdは、[share-artifactスキル](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md)と[AGENTSテンプレート](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/agents/template.md)から生成されました。_