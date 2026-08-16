# GlossShift

## リポジトリ構成

```text
src/lib.rs            Shared public library modules
src/config.rs         XDG configuration and credential loading
src/prompt.rs         Translation prompt construction
src/llm.rs            Rig streaming worker and request events
src/cli.rs            Public CLI path, language, and Markdown rendering helpers
src/bin/gshift.rs     Markdown translation CLI binary
src/main.rs           GPUI desktop binary wiring
src/selection.rs      macOS Accessibility and clipboard fallback
src/ui.rs             GPUI popup view and actions
examples/              Starter TOML configuration and credentials
packaging/             macOS application metadata
Justfile               Local development and packaging recipes
flake.nix              Darwin packages, overlay, and development shell
package.nix            Nix Rust package definition
```

## 開発コマンド

### 実行ルール

- リポジトリのルートからコマンドを実行する。
- プロジェクトで対応範囲を明示的に拡張するまで、macOS のみをサポートする。
- アドホックなシェルワークフローではなく、以下で指定された Just レシピを使用する。レシピで必要なターゲットを表現できない場合のみ、Cargo を直接使用する。
- ソースコード、設定例、コミットメッセージ、ソースドキュメントは英語で記述する。`README.md` と `AGENTS.md` は正規ファイルであり、日本語訳は `mdt` で生成する。
- 個別の `CLAUDE.md` は作成せず、`AGENTS.md` を正規のエージェントドキュメントとして維持する。
- 実際の認証情報のコミット、API キーのログ出力、失敗したテストや lint の弱体化、リモートの変更、ブランチの push、またはこのリポジトリからのプルリクエスト作成は、明示的に依頼されない限り決して行わない。

### 標準タスク

- `just fix` — フォーマットと Clippy の修正を適用する。
- `just fix-format` — すべての Rust ソースを `cargo fmt --all` でフォーマットする。
- `just fix-lint` — すべてのターゲット、機能、警告を deny する設定で Clippy の修正を適用する。
- `just check` — フォーマットと Clippy のチェックを実行する。
- `just check-format` — Rust のフォーマットを変更せずにチェックする。
- `just check-lint` — すべてのターゲットと機能に対して厳格な Clippy チェックを実行する。
- `just test` — Rust のユニットテストを実行する。
- `just build` — デバッグバイナリをビルドする。
- `just ci` — ローカルの完全なチェック、テスト、ビルドゲートを実行する。
- `just dev` — Cargo からデスクトップバイナリを直接実行する。
- `just run` — ビルド、アドホック署名、検証を行い、`target/GlossShift.app` を開く。
- `just package-app` — ローカルアプリケーションバンドルを開かずにビルドして検証する。
- `mdt --lang ja --force README.md` — 日本語の README ソース出力を再生成する。
- `mdt --lang ja --force AGENTS.md` — 日本語の AGENTS ソース出力を再生成する。

### CLI リファレンス

リポジトリのルートから `just cli FILE --lang LANGUAGE [OPTIONS]` で CLI を実行する。対応する直接コマンドは `cargo run --bin gshift -- FILE --lang LANGUAGE [OPTIONS]` である。`gshift` バイナリは常にデスクトップアプリケーションの XDG 設定、アクティブなプロバイダー、ソース言語、タイムアウト値、名前付き認証情報を再利用する。個別のモデル、プロンプト、トークン設定は存在しない。

位置引数の `FILE` は `.md` または `.mbt.md` 拡張子を持つ Markdown でなければならない。`--lang`/`-l` は必須であり、空でない ASCII 言語コードを受け付ける。言語コードには英数字と内部ハイフンのみを使用でき、使用前にトリミングして小文字化する。`--force`/`-f` は既存の兄弟出力の置き換えを許可し、`--stdout` と競合する。`--stdout` は翻訳をファイルではなく標準出力に書き込む。`--color auto|always|never` は ANSI Markdown ハイライトを制御し、`--stdout` が必要で、デフォルトは `auto` である。

`--stdout` なしの場合、CLI は `.md` の前に `.<language>` を挿入して兄弟パスを作成し、複合拡張子 `.mbt.md` を保持し、末尾に既存の `.ja` または `.en` セグメントがある場合は置き換える。`--force` が指定されていない限り、既存の出力を拒否し、ファイルには ANSI エスケープを書き込まない。

`--stdout --color auto` の場合、リダイレクトされた stdout はバイト単位でプレーンなままとなり、各プロバイダーデルタは直ちに flush される。一方、ターミナル stdout は完了までバッファリングされ、その後 Tree-sitter Markdown の ANSI スタイルでレンダリングされる。`--color never` はターミナル上でも出力をプレーンなままストリーミングする。`--color always` は完了した翻訳をバッファリングし、stdout がリダイレクトされている場合でも ANSI スタイルを出力する。

例:

```bash
just cli README.md --lang ja --force
just cli AGENTS.md --lang ja --force
just cli README.md --lang ja --stdout
just cli README.md --lang ja --stdout --color always
```

### 設定と認証情報

共有設定ルートは `xdg::BaseDirectories` を通じて解決され、デフォルトは `~/.config/glossshift` であり、`XDG_CONFIG_HOME` を尊重する。`config.toml` は `active_provider` を名前付きプロバイダーに、各プロバイダーを `credentials.toml` 内の名前付き認証情報にリンクする。認証情報の権限は常に `0600` にリセットされる。ショートカット文字列、TOML コンテンツ、Accessibility の値、HTTP レスポンスは、信頼できない境界入力として扱う。

アクティブなプロバイダーには空でない `base_url` と `model` が必要である。タイムアウトのデフォルト値は、最初のチャンクが 15 秒、ストリームのアイドル期間が 30 秒である。オプションの `[providers.<name>.request_parameters]` JSON フィールドは、変更せずに Rig 経由で転送される。ショートカットには一意のホットキーと空でない対象言語が必要であり、ウィンドウの寸法は正の値で、設定された最小値以上でなければならない。

## アーキテクチャ

### 共有ライブラリ境界

再利用可能なライブラリは XDG 設定、プロンプト構築、プロバイダーストリーミングを所有し、デスクトップと CLI のバイナリが同じプロバイダー契約を使用できるようにする。`config.rs` はトークンを通常の TOML から分離して保持し、`prompt.rs` は翻訳のみのプロンプトを構築し、`llm.rs` はリクエストスコープの `TranslationEvent` 値を出力する。

### デスクトップ境界

GPUI アプリケーションスレッドは、ポップアップエンティティ、グローバルホットキーマネージャー、ウィンドウアクション、共有の 2 ワーカー Tokio ランタイムを所有する。`selection.rs` は macOS Accessibility API とクリップボード API にアクセスする唯一のモジュールであり、`ui.rs` は GPUI ビューの状態を変更する唯一のモジュールである。ポップアップは閉じられた後もウィンドウを保持し、新しいショートカットが開始されると古いストリームをキャンセルし、`RequestId` が古いイベントを無視する。

### CLI 境界

`cli.rs` は言語の検証、Markdown 兄弟パスの解決、Tree-sitter ANSI レンダリングを所有する。`gshift` はファイルおよび stdout の I/O を所有し、共有の `llm::translate` 関数に入力する。境界付きチャネルはデスクトップ UI とストリーミングワーカーを分離し、キャンセルはプロバイダーストリームの境界で監視される。

### パッケージング境界

両方のバイナリは Rust および Nix のパッケージ出力に含まれる。デフォルトの flake オーバーレイは、一致する `meta.mainProgram` 値を持つ `glossshift` と `gshift` を公開し、パッケージ導出は安定した `GlossShift.app` バンドルレイアウトを通じてデスクトップバイナリを公開する。

## 開発ツール

- **Rust and Cargo**: `unsafe_code` を禁止し、厳格な Clippy lint を適用した 2024 エディションのパッケージをコンパイル、テスト、フォーマット、lint する。
- **Just**: リポジトリで定義された開発、検証、CLI、macOS パッケージングのワークフローを提供する。
- **Nix flakes**: Darwin パッケージ出力、再利用可能なオーバーレイ、Rust ツールチェーンと Just を備えた開発シェルを提供する。これらのツールがローカルにインストールされていない場合は、定義済みレシピの前に `nix develop` を実行する。
- **mdt**: 設定済みの OpenCode または Codex アダプターを使用して、日本語のソースドキュメント翻訳を生成する。
- **GPUI**: ネイティブタイトルバー、サイズ変更可能なデスクトップポップアップ、アプリケーションスレッドの UI モデルを提供する。
- **Rig**: カスタム互換ベース URL を含む OpenAI Chat Completions ストリーミングを提供する。
- **global-hotkey and macOS Accessibility crates**: グローバルショートカットの登録と安全な選択キャプチャ境界を提供する。
- **Tree-sitter**: 色付きターミナル出力向けの Markdown 構文ハイライトを提供する。

## パッケージ固有のルール

- 可能な限り本番ソースファイルを 250 行未満に保ち、既存のモジュール責務の境界を維持する。
- コールバック、UI、CLI、ネットワークの境界では境界付きチャネルを使用し、すべてのストリーミングイベントにリクエスト ID を付与する。
- 新しい翻訳を開始する前にアクティブなストリームをキャンセルし、古いイベントが現在の UI 状態を上書きできないようにする。
- 自動カラーモードでは、生成ファイルとリダイレクトされた stdout に ANSI エスケープを含めない。
- いずれかのソースドキュメントを変更した後は、`mdt --lang ja --force README.md` と `mdt --lang ja --force AGENTS.md` を使用して、英語ソースの横に `README.ja.md` と `AGENTS.ja.md` を再生成してコミットする。
- 両方のソースドキュメント内の相対リンクと、各英語ソース末尾にある正確な share-artifact provenance フッターを保持する。

_この AGENTS.md は [share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) と [AGENTS template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/agents/template.md) から生成されました。_