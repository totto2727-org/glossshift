# GlossShift

## リポジトリ構造

```text
app/desktop/App.tsx                 NSH entry beside nsh.json
app/desktop/src/                    Popup domain, controller, views, and desktop adapters
app/desktop/runtime/                GUI environment composition and test fixtures
app/desktop/packaging/              macOS metadata and icon assets
app/desktop/*.test.ts               Official NSH application and inference suites
app/cli/src/main.ts                 Native Node.js 26 CLI entry
app/cli/src/command.ts              Declarative Effect 4 CLI definition
app/cli/src/cli.ts                  Batch translation policy
app/cli/src/cli-files.ts            Ordered file validation and safe output operations
app/cli/src/*.test.ts               Native CLI unit and contract tests
app/cli/packaging.test/             Installed CLI, distribution, and real-model suites
package/runtime/src/               Shared configuration, model, and inference policy
package/runtime/src/desktop-config.ts  Non-destructive TOML settings and validation
package/runtime/src/autostart.ts    Safe macOS LaunchAgent file operations
package/nsh-platform/platform.ts    Public application-independent NSH Effect composition
package/nsh-platform/platform/      NSH service adapters and boundary tests
package/nsh-platform/App.tsx        NSH platform test host beside nsh.json
helper/                            One-shot Swift Accessibility helper and contract tests
nix/gshift.nix                     Independent CLI package without NSH or Swift
nix/macos-helper.nix               Production-only Swift helper build
flake.nix                          Pinned tools, Metal-enabled llama-cpp, and Darwin outputs
package.nix                        Native desktop application packaging
package.json                       Workspace root tooling dependencies
pnpm-workspace.yaml                app/* and package/* membership, catalogs, and release policy
tsconfig.base.json                 Common strict TypeScript policy only
vite.config.ts                     Formatting, lint, and delegated development tasks
patches/                           LaunchAgent plist dictionary validation patch
Justfile                           Compatibility aliases into Vite+ tasks
```

## 開発コマンド

リポジトリルートからコマンドを実行します。
`nix develop` を入力して Node.js 26、GUI 用のピン留めされた公式 NSH 0.5.0 ツール、Swift ヘルパー、公式 llama-server、curl、coreutils、および Vite+ を準備します。
公式 NSH リリースコンポーネントは、コンテンツハッシュと共に同一のリビジョンで保持してください。
その後、`vp install --frozen-lockfile` で JavaScript 依存関係をインストールします。
すべてのアプリケーションマニフェストは `rust` を省略するため、NSH は公式のプリビルド済みホストを使用します。
別途ヘルパーや標準 JS API で提供できる API を復元するために、カスタム Rust ホスト依存関係や生成されたソースチェックアウトを追加しないでください。

| コマンド                                  | 責務                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `vp install --frozen-lockfile`           | ロックされたパッケージグラフを Vite+ 経由でインストールします。                                      |
| `vp run check`                           | セカンドタイプチェッカーなしでフォーマットとリントをチェックします。                              |
| `vp run fix`                             | Vite+ のフォーマットおよびリント修正を適用します。                                               |
| `vp run typecheck`                       | すべてのワークスペースプロジェクトのホスト固有の TypeScript プログラムを再帰的にチェックします。        |
| `vp run dev`                             | 開発とリロードを NSH の macOS ホストに委任します。                                 |
| `vp run run`                             | アプリケーションを NSH 経由で実行します。                                                     |
| `vp run build`                           | インストール可能なアプリケーションではなく、NSH リリースバンドルを生成します。                      |
| `vp run package`                         | ネイティブ macOS アプリケーションを NSH 経由でパッケージ化します。                                    |
| `vp run test`                            | 公式 NSH テストホスト経由でアプリケーションテストを実行します。                            |
| `vp run test-platform`                   | NSH における隔離されたファイルシステム、設定、プロセス、およびキャプチャの境界を演習します。 |
| `vp run test-inference`                  | NSH における互換性のある暗号および直接 HTTP/SSE の動作を確認します。                         |
| `vp run test-cli`                        | Vite+ と Vitest 経由でネイティブ CLI コントラクトとファイルシステムテストを実行します。              |
| `vp run test-packaging`                  | インストール済みパッケージの境界とネイティブ CLI の実行を確認します。                         |
| `vp run test-local-model`                | 隔離された設定で real-model への翻訳をオプトインします。                        |
| `vp run cli -- FILES... --lang LANGUAGE` | Node.js 26 でネイティブ Effect 4 CLI を実行します。                                           |
| `vp run ci`                              | 最小限のフォーマットとリントゲートを実行します。                                            |

Vite+ は、Vitest を通じたインストール、タスクオーケストレーション、フォーマット、リント、およびネイティブ CLI テストを所有します。
GUI のバンドル、実行、および動作テストには NSH を使用し、Vite のバンドルやセカンド GUI ホストには使用しないでください。
`tsconfig.base.json` を単一の共通ポリシーファイルとして保持し、最も厳格な設定と Node-TS プリセットを `target: ESNext` および `noEmit` で拡張します。
`app/*` にアプリケーション、`package/*` に再利用可能なライブラリ、パッケージマニフェスト、`workspace:*` 依存関係、およびカタログ管理の外部依存関係を持つ、真の PNPM モノレポを使用して、周囲のワークスペースの他のプロジェクトと一致させます。
共有モジュールは `@glossshift/runtime/*` および `@glossshift/nsh-platform` のソースエクスポートで解決し、パスエイリアスやプロジェクトをまたぐ相対インポートは使用しないでください。
パッケージの TypeScript 設定は最小限に保ち、`include`、`exclude`、または `files` リストのないデフォルトのディスカバリを使用してください。
詳細なファイルリストを保持するのではなく、関連するソース、テスト、およびホスト環境が自然に包含されるディレクトリおよびパッケージ境界を選択してください。
NSH プロジェクトは、生成された `.nsh/tsconfig.json` と共通ベースを拡張し、Node CLI およびランタイムプロジェクトは Node タイプを選択します。
単一の統合された NSH と Node タイプのプログラムをテストしましたが、互換性のない ambient `Response`、`URL`、`process`、およびファイルシステム宣言で失敗しました。
キャストとの競合をバイパスしたり、チェック全体をスキップしたりせず、環境固有のプログラムを保存してください。
すべてのプロジェクトは独自の `typecheck` スクリプトを宣言します。NSH プロジェクトには `nsh check .`、Node プロジェクトには `vp exec tsc --project .` を使用します。
ルートの `vp run typecheck` は `vp run -r typecheck` に委任されるため、新しいワークスペースプロジェクトは自動的にスクリプトを通じて参加します。
ルートのフォーマットおよびリントゲートは `typeAware` と `typeCheck` を無効に保ち、プロジェクトのタイプチェックを置き換えません。
ルートの NSH 開発、実行、ビルド、およびパッケージ、アプリケーションテストタスクは `app/desktop` を、プラットフォームテストは `package/nsh-platform` を対象とします。
公開タスク名は保持してください。
Just エイリアスは、既存のワークフローの `just ci` エントリポイントを含む互換性のために存在します。
Nix は小さな Swift ヘルパーを個別にコンパイルし、GUI を公式 NSH ホストでバンドルします。
`nix/gshift.nix` は、NSH や Swift を使用せずに Node.js 26 用のプロダクション `app/cli` および `package/runtime` ツリーとプロダクション依存関係をパッケージ化します。
統合された `glossshift` パッケージはこのスタンドアロン CLI をリンクするため、そのクロージャには GUI が Node を起動しなくても Node が含まれます。
これは、別途ピン留めされた Nixpkgs の不安定な入力からの、修正されていない `llama-cpp` パッケージを使用します。
ピンを変更する前に、バイナリキャッシュから正確な macOS arm64 の派生版が利用可能であることを確認してください。
ローカルビルドの好みを変更するためだけにパッケージをオーバーライドしないでください。そうするとその代替品の有効性が損なわれる可能性があります。
配布ソースの入力には、すべてのテスト、テストヘルパー、およびフィクスチンが除外されます。
パッケージの派生以外のすべてのタイプチェックおよびテストは、開発タスクを通じて実行します。
Nix の派生にチェックまたはテストフェーズを追加しないでください。
パッケージビルド外の Swift ヘルパーコントラクトテストには `vp run test-helper` を使用してください。
Ruby は許可されていません。
スタンドアロンのテストスクリプトや手管理の JavaScript テストバンドルを追加しないでください。
GUI の動作には公式 NSH テストフレームワークを、CLI の動作には Vite+ 経由のネイティブ Vitest を、再利用可能な `.test` ヘルパーを使用してください。
テスト専用のモジュールとアセットには、`.test.fixture` モジュールやテスト専用ディレクトリを含む `.test` をマークしてください。
これらの名称はプロダクションソースの入力外に保持してください。
ヘルパーのコントラクトテストは合成入力を使用し、他のアプリケーションの選択を読みません。
ワークフローの変更は、ユーザーによって明示的に承認されたランナーおよびタイムアウトの変更内に保持してください。
新しいリクエストなしに、macOS ジョブ、アプリケーションビルド、システム全体の評価、または flake チェックを GitHub Actions に追加しないでください。

## アプリケーションアーキテクチャ

### TS アプリケーション境界

`index.ts` または `index.tsx` モジュールを作成しないでください。
`platform.ts` や `platform/NshFileSystem.ts` などの子ディレクトリの横に名前付きモジュールを使用してください。
Platform の実装は GlossShift ポリシーから独立させ、ライブラリとして抽出できるようにしてください。
ワーキングディレクトリ、ツール、設定プロバイダー、および Stdio レイヤーは `platform.ts` を通じて明示的に渡してください。
アプリケーション環境の解釈は `app/desktop/runtime/platform.ts` で保持してください。
サポートされているサービスおよび NSH の明示的な制限は、`package/nsh-platform/platform/README.md` で文書化してください。
公開コンポーネントモジュールは `package/nsh-platform/platform.ts` です。

TypeScript は、ポップアップ状態、表示モード、リクエストの置換、古くなったイベントおよびターミナルイベントの処理、コピーアクション、およびビューレンダリングを所有します。
手動の Promise オーケストレーションや JavaScript 標準ライブラリのコレクションヘルパーではなく、Effect サービス、スコープ付きファイバー、検証済みスキーマ、および Effect コレクションと文字列ユーティリティを使用してください。
不可避な NSH Promise および UI API は境界アダプターに保持してください。
1 つのアプリケーションライフタイムランタイムを使用し、ティアダウン時にスコープを破棄し、レンダリングごとにランタイムを作成しないでください。
プロバイダーのデルタは、制限されたロスレストランスポートを使用してください。
完全なビュースナップショットはマージできますが、キャンセルおよび置換はフルデルタキューの後ろで待機してはいけません。

公式 NSH コンポーネントとネイティブ Tailwind `class` サポートを使用してください。
ブラウザのオーバーフロー動作ではなく、NSH `Scroll` を使用してください。
Markdown は標準 NSH `TextView` を使用し、リテラル HTML、無効な数学、オープンしないリンク、alt のみの画像、および構文ハイライトなしのプレーンコードブロックレンダリングを使用します。
プレーンモードは、保存されたソースや翻訳テキストを変更せずに両方のペインを切り替えます。
コピーは常に生のドメインテキストを使用し、レンダリングされた Markdown は使用しません。
アプリケーションの CSS スタイルシート、カスタム Markdown パーサー、またはブラウザレンダラーを再導入しないでください。

### ローカル翻訳境界

TypeScript は、翻訳、モデル選択、自動ダウンロード、プロンプトフォーマット、ストリーミング、キャンセル、およびバッチ CLI を所有します。
パッケージ化された公式 llama-server には、装飾的な AI 依存関係ではなく、本物の `effect/ai` `LanguageModel` アダプターを使用してください。
GUI の構成と翻訳は、再利用可能な Effect Platform レイヤーを通じて NSH で直接実行します。
NSH や Swift をインポートせずに、ネイティブ Node Effect サービスを通じて独立した CLI を実行します。
互換性のある NSH モジュールは、それらの動作が公式ホストで検証されている場合にのみ使用してください。
NSH 0.5.0 は完全な Node ランタイムではありません。大容量ファイルストリーム、安全な排他ファイルシステム作成、および親 CLI ハンドルが欠落しています。
制限されたモデル I/O および狭いアトミックファイル操作には、固定パッケージの curl/coreutils コマンドを使用してください。
完全な GGUF を JS ヒープにロードしたり、ファイル全体を読み込みながらストリーミングをエミュレートしたりしないでください。
サポートされていない Platform メソッドは明示的に失敗する必要があります。
GUI は、ランタイム Node プロセス、カスタム JavaScript ホスト、またはカスタム Rust モジュールを必要としません。
JSON サイドカープロトコルなしで、スコープ付きストリームバックプレッシャーと独立したキャンセルを保持してください。
ダウンロード通知と診断情報は stderr に記述し、プロトコルやバッチ翻訳の stdout には決して記述しないでください。
アプリケーションのティアダウンでは、アクティブな HTTP リクエストと所有されたインジェクションサーバーを解放する必要があります。
サーバーはカーネル選択されたポートの `127.0.0.1` にのみバインドされます。
サーバーごとに新しいランダム認証キーを使用し、コマンドライン引数ではなくプライベート一時ファイルに保存します。
サーバーの診断情報は、プロトコルの stdout や公開失敗に含めないでください。
呼び出し元が選択した、またはホストされたインジェクションエンドポイントに接続しないでください。

デフォルトの公式 PFN GGUF リビジョンと SHA-256 をピン留めしてください。
互換性のある PLaMo 0.8B、2B、8B、および 31B プリセットは、変更不可能な URL、完全なダイジェスト、およびモデルごとの実際のコンテキスト制限を持つコードで保持してください。
プロンプトのトークン化後の残りのコンテキストから完了予算を計算し、必要に応じて明示的な出力制限で短縮します。
人工的な 8192 トークンのコンテキストデフォルト、4096 トークンの出力デフォルト、またはグローバルな 32768 トークンの上限を復元しないでください。
プリセットのメタデータを確認するためだけに、より大きなモデルをダウンロードまたは実行しないでください。
組み込みモデルを選択するために構成ファイルを必要としないでください。
デフォルトの PLaMo 予算を借り受けるのではなく、未知のカスタムモデルダイジェストに明示的な `contextSize` を要求してください。
ダイジェストによって既知のプリセットアーティファクトを特定し、`file:` URI で選択された一致するアーティファクトは、依然としてフルモデルの最大値をデフォルトとします。
サポートされているツールレンジのモデルダウンロードを自動的に再開し、キャッシュに公開する前に完全なアーティファクトを検証してください。
モデルの重みは、Nix ストアやリポジトリではなく、ユーザーのキャッシュに保持してください。
オフラインキャッシュヒットを Hugging Face に送信してはいけません。
パッケージ化された llama-server パスを正確に使用し、暗黙的なエンジンのコンパイルやダウンロードを無効にしてください。
信頼できないソーステキストは信頼できる PFML3 特殊トークンと分離し、BOS を 1 回追加し、プロトコルストップトークンを抑制してください。
サポートされていない言語、コンテキストオーバーフロー、および出力の切り捨てを拒否し、成功した部分ファイルの報告は避けてください。
ユーザーを登録したり、代わりに商用条件を受け入れたりせずに、パブリッシャーのモデルライセンス通知を使用してください。

### macOS ヘルパー境界

アクセシビリティは、NSH や Node ではなく、別の単一実行の Swift 実行ファイルで動作します。
サードパーティの ABI ブリッジを使用せず、Apple の ApplicationServices API を直接使用してください。
ヘルパーは、プロンプトを必要としない許可の検査と、制限付き JSON レスポンスによる選択されたテキストのキャプチャをサポートします。
別の GUI ループをインストールしたり、プライバシー設定を変更したり、コピーキーストロークをシミュレートしたり、クリップボードを変更したりしてはいけません。
ネイティブのエラー詳細ではなく、安定した公開エラーコードを返してください。
ポップアップを表示するか有効化する前に、前のアプリケーションの選択をキャプチャしてください。
プロセスランチャーはインジェクタ可能であり、別の OS 実装で置き換えられるようにしてください。

TypeScript は、NSH 内部のデスクトップ構成のパース、検証、デフォルトファイル作成、および自動起動ファイル操作を所有します。
標準的なクリップボード、ウィンドウ、アプリケーション、ショートカット、およびトレイコントロールは、NSH の JavaScript API を使用します。
インストールされたランチャーは、呼び出し元のワーキングディレクトリに依存せず、変更不可能な実行ファイルパスを設定します。
NSH のプロセス機能で必要な実行ファイルのみを許可してください。
ランタイム、キャッシュ、および構成パスに必要な環境変数のみを転送してください。
接続ごとに名前空間の翻訳リクエスト ID を設定し、リロードされたコントローラーが以前のリクエストをエイリアスできないようにしてください。
接続スコープが閉じると、子プロセスとショートカットの登録を解放してください。
遅延した古いスコープは、新しいスコープのリソースを登録解除してはいけません。

### ネイティブ CLI

`app/cli/src/main.ts` を独立した Node.js 26 エントリとして使用し、宣言的な Effect 4 CLI コマンドには `app/cli/src/command.ts` を使用してください。
バッチポリシーとファイル操作は `app/cli/src/cli.ts` および `app/cli/src/cli-files.ts` で保持し、再利用可能な翻訳ポリシーは `package/runtime/src` で保持してください。
NSH、Swift、AppKit、グローバルホットキー、およびトレイリソースは、CLI の依存関係グラフとパッケージクロージャの外に保持してください。
ネイティブ引数、ワーキングディレクトリ、標準ストリーム、シグナル、および終了ステータスを使用してください。
シェルキャプチャブリッジ、`gshift-launcher.sh`、Nix バッチランチャー、または削除された `batch/` および `terminal/` 製品は復元しないでください。
引数はヘルプを示さず、`--tui` は拒否されます。
デスクトップランタイムは分離して保持してください。
翻訳および構成ポリシーは、レンダリング前にホスト固有のプラットフォーム実装を保持したまま共有してください。
Vite+ と Vitest を使用して、生成された出力をテストし、再利用可能な `.test` ヘルパーを使用してください。

### macOS ライフサイクル

プラットフォームスコープが明示的に拡張されるまで、Apple Silicon macOS のみをサポートします。
NSH の AppKit イベントループとデリゲートを保持してください。
メンテナンスされている [依存関係互換性レコード](docs/dependency-compatibility.md) は、正確なリリースと保持された plist パーサーのパッチを特定します。
公式 NSH 実行ファイルとランタイムソースは変更されていません。
カスタムネイティブセットアップフックの代わりに、注入されたストリームフィクスチンとスコープ付き JS コントロールを使用してください。
ポップアップを閉じるとエンジンを破壊せずに非表示になり、再度開くと保持された状態が明らかになります。
バックグラウンド起動でウィンドウを短時間起動して非表示にしてはいけません。

## 構成

NSH の TypeScript は、ウィンドウおよびショートカット設定に `XDG_CONFIG_HOME` を反映して `~/.config/glossshift/config.toml` を読み取ります。
デスクトップ TypeScript アダプターは、設定されたショートカットを登録前に NSH の標準ショートカット表記に変換します。
共有ランタイムは、`XDG_CONFIG_HOME` または明示的な絶対 `GLOSSSHIFT_CONFIG` パスを反映して、`~/.config/glossshift/local.json` からローカル翻訳設定を読み取ります。
ローカルモデルキャッシュは `XDG_CACHE_HOME` を反映し、ローカル設定で変更できます。
`~/.agents` やレガシープロバイダーの認証情報を読み取り、変更しないでください。
構成、ショートカット、ネイティブ選択、プロセスフレーム、モデルメタデータ、およびモデル出力は、信頼できない境界入力として扱ってください。
テストは隔離された一時設定と合成ソーステキストを使用して行い、開発者のプライベート構成や選択されたコンテンツを決して使用しないでください。
実際のデフォルトモデルテストは、ネットワークダウンロードを開示し、推論の受け入れとプロトコルフィクスチンを区別する必要があります。

## CLI コントラクト

引数なしの `gshift` は、構成やモデルをロードせずにヘルプを表示します。
`--tui` は、対話型ホストの起動ではなく拒否されます。
宣言的な Effect 4 コマンドは、ネイティブ Node 引数、ワーキングディレクトリ、標準ストリーム、および完了ステータスを使用します。
ファイルシステム呼び出しの前に、注入された Path サービスを通じて相対入力を解決してください。
診断情報とターミナル制御シーケンスは、プレーンな翻訳 stdout に含めないでください。
`gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]` は、既存の動作を保持します。
構成やモデルをロードする前に、すべての兄弟出力を解決し、入力/出力の衝突を拒否してください。
順序付きの `.md` および `.mbt.md` の処理、正規化された言語サフィックス、およびターゲットを変更せずに安全に強制置換を保存してください。
ファイル出力およびリダイレクトされた自動色 stdout は、ANSI エスケープ文字なしで保持されなければなりません。
プレーンな翻訳には挿入されたセパレータが含まれません。
ターミナルの自動色および強制色バッファは、レンダリング前に各翻訳を完了させます。
色は、Markdown をパースしたり構文ハイライトを追加したりせずに完全な出力を色付けします。
デスクトップおよびネイティブ CLI は、同じローカルモデル、ソース言語、プロンプト形式、およびトークン予算ポリシーを共有します。

## キャッシュされたモデルの受け入れの再現

ロックされた依存関係をインストールした後、`nix develop` 内のリポジトリルートから実行してください。
`app/cli/packaging.test/Inference.test.ts` のオプトインスイートは、隔離された一時設定を使用し、既存の `file:` GGUF URI のみを受け入れるため、モデルの重みをダウンロードできません。
まず、まだキャッシュされていない場合は、通常の検証済みアプリケーションダウンロードを通じて 0.8B のアーティファクトを取得してください。
その初回ダウンロードには、ネットワークアクセスと約 573 MB のディスクスペースが必要です。
このチェックのために、より大きなプリセットをダウンロードしないでください。

`tmp/local-model.test.json` に、キャッシュされたアーティファクトの絶対 `file:` URI、ピン留めされた `sha256`、および `package/runtime/src/models.ts` からの `prompt: "plamo"` を含む `model` オブジェクトを作成した状態で、隔離された JSON 構成を作成してください。
既知の 0.8B ダイジェストのデフォルト 262144 トークンを使用しないでください。
このテストをプライベートユーザー構成に向けないでください。
その後、以下を実行してください。

```bash
GLOSSSHIFT_TEST_MODEL_CONFIG="$PWD/tmp/local-model.test.json" \
GLOSSSHIFT_TEST_LLAMA_SERVER="$(command -v llama-server)" \
GLOSSSHIFT_COREUTILS="$(command -v coreutils)" \
GLOSSSHIFT_TEST_INSTALLED="$(nix build .#gshift --no-link --print-out-paths)/bin/gshift" \
vp run test-local-model
```

ネイティブスイートは、プロダクションサーバー引数、実際の日本語および英語の翻訳、ファイルの安全性、およびキャンセルのクリーンアップで Metal の起動を検証します。
インストールされたスイートは独立してパッケージ化された CLI を実行し、重複してインストールされた GPU 診断は意図的にスキップされます。
オプトイン環境変数がない場合、本物のモデルスイートはウェイトをダウンロードせずにスキップします。
これらのチェックは、コンテキストを 262144 トークンのプロンプトで埋めたり、パフォーマンス結果を確立したりしません。
GUI を個別にチェックし、macOS の権限要件によって選択やインタラクションがブロックされた場合は停止してください。

インストール済みパッケージおよびクロージャのチェックをオプトインするには、以下を実行してください。

```bash
GLOSSSHIFT_TEST_INSTALLED="$(nix build .#gshift --no-link --print-out-paths)/bin/gshift" \
GLOSSSHIFT_TEST_GUI_PACKAGE="$(nix build .#glossshift --no-link --print-out-paths)" \
vp run test-packaging
```

対応するパッケージの `src` 属性の Nix 評価によって得られたフィルタ済みソースパスに、オプションの `GLOSSSHIFT_TEST_GUI_SOURCE` および `GLOSSSHIFT_TEST_CLI_SOURCE` を設定して、テストおよびフィクスチンの除外を確認してください。
オプションの `GLOSSSHIFT_TEST_MACOS_HELPER` を、ビルドされたヘルパーの絶対実行ファイルパスに設定して、プロンプトを必要としない権限の応答を確認してください。
Apple Silicon の場合、`nix eval --raw` で `.#packages.aarch64-darwin.glossshift.src` および `.#packages.aarch64-darwin.gshift.src` を評価し、`.#glossshift-macos-helper` パスの `bin/glossshift-macos-helper` をビルドしてください。
これらのパッケージングチェックは、アクセシビリティ権限を付与したり、実際の選択キャプチャを実行したりしません。

## 検証とメンテナンス

- NSH を通じて GUI の動作テストを、Vite+ と Vitest を通じてネイティブ CLI テストを実行してください。コピーされたコントローラーハーネスは使用しないでください。
- 本物の Vite+ タスクの委任、公式にプリビルドされたホストの選択、ネイティブパッケージング、および保持された CLI を個別に検証してください。
- NSH の成功したバンドルは、ネイティブアプリケーション、CLI パッケージ、または Nix の派生版が動作することの証明ではありません。
- 注入されたストリームフィクスチンを使用して、決定論的なキャンセルおよびバックプレッシャーチェックを行い、その後、インストールされたネイティブ CLI と GUI を通じて本物の GGUF 推論を検証してください。
- インストールされた Nix 実行ファイルは、パッケージングが完了したことを示すのではなく、パッケージ化されたサーバーを起動し、本物のモデルで翻訳することを検証してください。
- 合成プロトコルテストを、実際のモデル推論およびヘッドレスレイアウトをネイティブなビジュアルレビューと区別してください。
- アクセシビリティまたはスクリーン権限がエンドユーザーのチェックをブロックしている場合は、境界を報告し、バイパスの試みを停止してください。
- ヘルパービルドは TypeScript のバンドルとは別に保持し、対応する NSH Rust ワークスペースに依存しないでください。
- 実用的な場合は、プロダクションソースファイルを 250 行未満に保ち、モジュールの責任を保持してください。
- テンプレートのパッケージマネージャーピン、リリースエイジの待機期間、厳格な年齢チェック、および拒否されたライフサイクルビルドを保持してください。
- 認証情報、または生成された `.nsh`、`node_modules`、ターゲットディレクトリ、ベンチマークフィクスチン、または一時レポートをコミットしないでください。
- ソース、構成、コミットメッセージ、および正準ドキュメントは英語で保持してください。
- GlossShift CLI を使用して日本語ドキュメントを再生成してください：`gshift README.md AGENTS.md --lang ja --force`。
- CLI がインストールされていない場合は、プロジェクトタスクを使用してください：`vp run cli -- README.md AGENTS.md --lang ja --force`。
- このリポジトリの翻訳に `mdt` を使用しないでください。
- 生成がブロックされた場合は、手動で生成された出力を記録するのではなく、記録してください。
- `AGENTS.md` を正準として保持し、別の `CLAUDE.md` を作成しないでください。

_この AGENTS.md は、[share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) と [AGENTS template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/agents/template.md) から生成されました。_
