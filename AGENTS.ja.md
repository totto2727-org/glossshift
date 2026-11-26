# GlossShift

## リポジトリ構造

```text
app/desktop/App.tsx                 NSH entry beside nsh.json
app/desktop/src/                    Popup domain, controller, views, and desktop adapters
app/desktop/runtime/                GUI environment composition
app/desktop/packaging/              macOS metadata and icon assets
app/desktop/*.test.ts               Official NSH application and inference suites
app/cli/src/main.ts                 Native Node.js 26 CLI entry
app/cli/src/program.ts              Command dispatch, help, version, and output presentation
app/cli/src/commands/translate.ts   Declarative Effect 4 translation command
app/cli/src/commands/autostart.ts   Private desktop autostart command
app/cli/src/translate-batch.ts       Ordered translation and stdout rendering
app/cli/src/translation-plan.ts      Language validation and sibling output planning
app/cli/src/translation-files.ts     Collision preflight and atomic file operations
app/cli/src/*.test.ts               Native CLI unit and contract tests
package/runtime/src/               Shared configuration, model, and inference policy
package/runtime/src/desktop-config.ts  Non-destructive TOML settings and validation
package/runtime/src/autostart.ts    Safe macOS LaunchAgent file operations
package/nsh-platform/platform.ts    Public application-independent NSH Effect composition
package/nsh-platform/platform/      NSH service adapters and boundary tests
package/nsh-platform/App.tsx        NSH platform test host beside nsh.json
helper/                            One-shot Swift Accessibility helper
nix/gshift.nix                     Independent CLI package without NSH or Swift
nix/macos-helper.nix               Production-only Swift helper build
flake.nix                          Pinned tools, Metal-enabled llama-cpp, and Darwin outputs
package.nix                        Native desktop application packaging
package.json                       Workspace root tooling dependencies
pnpm-workspace.yaml                app/* and package/* membership, catalogs, and release policy
tsconfig.base.json                 Common strict TypeScript policy and project discovery
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

| コマンド                                  | 責任                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `vp install --frozen-lockfile`           | ロック済みパッケージグラフを Vite+ 経由でインストールします。                               |
| `vp run check`                           | セカンドタイプチェッカーなしでフォーマットとリントをチェックします。                       |
| `vp run fix`                             | Vite+ のフォーマットおよびリント修正を適用します。                                        |
| `vp run typecheck`                       | すべてのワークスペースプロジェクトのホスト固有の TypeScript プログラムを再帰的にチェックします。 |
| `vp run dev`                             | 開発とリロードを NSH の macOS ホストに委任します。                          |
| `vp run run`                             | アプリケーションを NSH 経由で実行します。                                              |
| `vp run build`                           | インストール可能なアプリケーションではなく、NSH リリースバンドルを生成します。               |
| `vp run package`                         | ネイティブ macOS アプリケーションを NSH 経由でパッケージ化します。                             |
| `vp run test`                            | 公式 NSH テストホスト経由でアプリケーションテストを実行します。                     |
| `vp run test-platform`                   | 外部ツールなしで、注入されたプラットフォームサービスの動作をテストします。           |
| `vp run test-inference`                  | フィクスチャで構成、プロンプト、トークン予算、および HTTP/SSE ロジックをチェックします。  |
| `vp run test-cli`                        | ネイティブ CLI コントラクトとファイルシステムテストを Vite+ および Vitest 経由で実行します。       |
| `vp run cli -- FILES... --lang LANGUAGE` | Node.js 26 でネイティブ Effect 4 CLI を実行します。                                    |
| `vp run ci`                              | 最小限のフォーマットとリントゲートを実行します。                                     |

Vite+ は、Vitest を通じたインストール、タスクオーケストレーション、フォーマット、リント、およびネイティブ CLI テストを所有します。
GUI のバンドル、実行、および動作テストには NSH を使用し、Vite のバンドルや第2の GUI ホストには使用しないでください。
`tsconfig.base.json` を単一の共通ポリシーファイルとして保持し、最も厳格な設定と Node-TS プリセットを `target: ESNext` および `noEmit` で拡張します。
`app/*` にアプリケーション、`package/*` に再利用可能なライブラリ、パッケージマニフェスト、`workspace:*` 依存関係、およびカタログ管理の外部依存関係を持つ、真の PNPM モノレポを使用して、周囲のワークスペースの他のプロジェクトと整合性を保ちます。
共有モジュールは `@glossshift/runtime/*` および `@glossshift/nsh-platform` のソースエクスポートで解決し、パスエイリアスやプロジェクトをまたぐ相対インポートは行いません。
パッケージの TypeScript 設定は、プロジェクト固有の `include`、`exclude`、または `files` リストを使用せず、最小限に留めてください。
共通ベースにある単一の広範な `include: ["${configDir}/**/*"]` ルールを使用して、テストや新規追加ファイルを含む、各消費プロジェクトの完全なディレクトリを検出します。
これをファイル単位やサブディレクトリ単位の選択で置き換えないでください。
NSH の生成された構成は `files` を通じてアンビエントルートを宣言しており、`include` が指定されていない場合に暗黙的なデフォルト検出を無効にします。
共有検出ルールを削除すると、アプリケーションソースをチェックせずに `nsh check .` がパスされます。
各ホストプロジェクトで未インポートのタイプエラーを追加し、公開タイプチェックの失敗を確認した後、一時的なプローブを削除して成功を確認することで、検出の変更を検証します。
ファイングレインなファイルリストを維持するのではなく、関連するソース、テスト、およびホスト環境が自然に包含されるディレクトリおよびパッケージ境界を選択してください。
NSH プロジェクトは、生成された `.nsh/tsconfig.json` と共通ベースを拡張し、Node CLI およびランタイムプロジェクトは Node タイプを選択します。
単一の統合された NSH と Node タイプのプログラムをテストしたところ、互換性のないアンビエント `Response`、`URL`、`process`、およびファイルシステム宣言で失敗しました。
キャストとの競合をバイパスしたり、チェック全体をスキップしたりせず、環境固有のプログラムを保持してください。
すべてのプロジェクトは独自の `typecheck` スクリプトを宣言します。NSH プロジェクトには `nsh check .`、Node プロジェクトには `vp exec tsc --project .` を使用します。
ルートの `vp run typecheck` は `vp run -r typecheck` に委任されるため、新しいワークスペースプロジェクトは自動的にスクリプトを通じて参加します。
ルートのフォーマットおよびリントゲートは `typeAware` と `typeCheck` を無効に保ち、プロジェクトのタイプチェックを置き換えません。
ルートの NSH 開発、実行、ビルド、およびパッケージ、アプリケーションテストタスクは `app/desktop` を、プラットフォームテストは `package/nsh-platform` をターゲットとします。
公開の開発、ビルド、およびパッケージングのエントリーポイントは安定させてください。
廃止されたテストタスクは、削除されたスイートと共に削除してください。
Just エイリアスは、コマンドラインの `just ci` エントリーポイントを含む互換性のために存在します。
Nix は小さな Swift ヘルパーを個別にコンパイルし、GUI を公式 NSH ホストでバンドルします。
`nix/gshift.nix` は、NSH や Swift なしで Node.js 26 のプロダクション `app/cli` および `package/runtime` ツリーとプロダクション依存関係をパッケージ化します。
統合された `glossshift` パッケージはこのスタンドアロン CLI をリンクするため、そのクロージャには GUI が Node を起動しなくても Node が含まれます。
これは、別途ピン留めされた Nixpkgs の不安定な入力から得られた、修正されていない `llama-cpp` パッケージを使用します。
ピンを変更する前に、バイナリキャッシュから正確な macOS arm64 の派生版が利用可能であることを確認してください。
ローカルビルドの好みを変更するためだけにパッケージを上書きしないでください。そうするとその代替品の有効性が損なわれる可能性があります。
配布ソースの入力には、すべてのテスト、テストヘルパー、およびフィクスチャが除外されます。
パッケージの派生パス外で、すべてのタイプチェックとテストを実行します。
Nix の派生パスにチェックまたはテストフェーズを追加しないでください。
Ruby は許可されていません。
スタンドアロンのテストスクリプトや、ハンドメンテナンスされた JavaScript テストバンドルを追加しないでください。
GUI の動作には公式 NSH テストフレームワークを、CLI の動作には Vite+ 経由の真の Vitest を、再利用可能な `.test` ヘルパーを使用してください。
テスト専用のモジュールとアセットには、`.test.fixture` モジュールやテスト専用ディレクトリを含む `.test` をマークしてください。
これらの名称はプロダクションソースの入力外に保持してください。
動作テストは、アプリケーションロジックと注入されたサービスの動作に焦点を当てて保持してください。
ビルドアーティファクト、シグネチャ、パッケージクロージャ、修正済みアセット、またはサードパーティ API のみのテストを追加しないでください。
CLI、インファンティングサーバー、coreutils、curl、またはコンパイル済みヘルパーを直接開始するテストは、ここでのメンテナンスではなく、Projektor のフォローアップに回されます。
ワークフローの変更は、ユーザーによって明示的に承認されたランナー内、およびタイムアウトの変更内に保持してください。
新しいリクエストなしに、macOS ジョブ、アプリケーションビルド、システム全体の評価、または flake チェックを GitHub Actions に追加しないでください。

## アプリケーションアーキテクチャ

### TS アプリケーション境界

`index.ts` または `index.tsx` モジュールを作成しないでください。
子ディレクトリの名前付きモジュール（`platform.ts` や `platform/nsh-file-system.ts` など）を使用してください。
フレームワークで必須の名前（NSH の `App.tsx` など）を除き、kebab-case のソース、テスト、およびフィクスチャ名を使用してください。
各 CLI コマンドは、`app/cli/src/commands/` 配下の個別のモジュールに配置し、共有のプランニングおよびファイル操作は明示的に名前付けされたモジュールで行ってください。
アプリケーションタイプやスキーマで `_tag` フィールドを宣言する代わりに、Effect の `Data.TaggedError`、`Data.TaggedEnum`、および `Schema.TaggedStruct` を使用してください。
Platform の実装は GlossShift ポリシーから独立させ、ライブラリとして抽出できるようにしてください。
ワーキングディレクトリ、ツール、構成プロバイダー、および Stdio レイヤーは `platform.ts` を通じて明示的にパスしてください。
アプリケーション環境の解釈は `app/desktop/runtime/platform.ts` に保持してください。
サポートされているサービスおよび NSH の明示的な制限は、`package/nsh-platform/platform/README.md` で文書化してください。
公開コンポーネントモジュールは `package/nsh-platform/platform.ts` です。

TypeScript は、ポップアップ状態、表示モード、リクエストの置換、古くなったイベントおよびターミナルイベントの処理、コピーアクション、およびビューレンダリングを所有します。
手動の Promise オーケストレーションや JavaScript 標準ライブラリのコレクションヘルパーではなく、Effect サービス、スコープ付きファイバー、検証済みスキーマ、および Effect コレクションと文字列ユーティリティを使用してください。
不可避な NSH Promise および UI API は境界アダプターに保持してください。
アプリケーションライフタイムランタイムを1つ使用し、ティアダウン時にスコープを破棄し、レンダリングごとにランタイムを作成しないでください。
プロバイダーのデルタは、制限付きのロスレストランスポートを使用してください。
完全なビュースナップショットはマージされる可能性がありますが、リジェクションや置換はフルデルタキューの後ろで待機してはいけません。

公式 NSH コンポーネントとネイティブ Tailwind `class` サポートを使用してください。
ブラウザのオーバーフロー動作ではなく、NSH の `Scroll` を使用してください。
Markdown は標準の NSH `TextView` を使用し、リテラル HTML、無効化された数学、オープンしないリンク、alt のみの画像、および構文ハイライトのないプレーンコードブロックレンダリングを使用します。
プレーンモードは、保存されたソースや翻訳テキストを変更せずに両方のペインを切り替えます。
コピーは常に生のドメインテキストを使用し、レンダリングされた Markdown は使用しません。
アプリケーションの CSS スタイルシート、カスタム Markdown パーサー、またはブラウザレンダラーを再導入しないでください。

### ローカル翻訳境界

TypeScript は、翻訳、モデル選択、自動ダウンロード、プロンプトのフォーマット、ストリーミング、リジェクション、およびバッチ CLI を所有します。
パッケージ化された公式 llama-server には、装飾的な AI 依存関係ではなく、真の `effect/ai` `LanguageModel` アダプターを使用してください。
GUI の構成と翻訳は、再利用可能な Effect Platform レイヤーを通じて NSH で直接実行してください。
NSH や Swift をインポートせずに、ネイティブ Node Effect サービスを通じて独立した CLI を実行してください。
互換性のある NSH モジュールは、動作が公式ホストで検証されている場合にのみ使用してください。
NSH 0.5.0 は完全な Node ランタイムではありません。大容量ファイルストリーム、安全な排他ファイルシステム作成、および親 CLI ハンドルが欠落しています。
制限付きのモデル I/O および狭いアトミックファイル操作には、固定パッケージ化された curl/coreutils コマンドを使用してください。
完全な GGUF を JS ヒープにロードしたり、ファイル全体を読み取りながらストリーミングをエミュレートしたりしないでください。
サポートされていない Platform メソッドは明示的に失敗しなければなりません。
GUI は、ランタイム Node プロセス、カスタム JavaScript ホスト、またはカスタム Rust モジュールを必要としません。
JSON サイドカープロトコルなしで、スコープ付きストリームのバックプレッシャーと独立したリジェクションを保持してください。
ダウンロード通知と診断情報は stderr に記述し、プロトコルやバッチ翻訳の stdout には決して記述しないでください。
アプリケーションのティアダウンでは、アクティブな HTTP リクエストと所有されたインファンティングサーバーを解放しなければなりません。
サーバーはカーネル選択されたポートの `127.0.0.1` にのみバインドされます。
サーバーごとに新しいランダム認証キーを使用し、コマンドライン引数ではなくプライベートの一時ファイルに保存してください。
サーバーの診断情報は、プロトコルの stdout や公開失敗に含めないでください。
呼び出し元が選択した、またはホストされたインファンティングエンドポイントに接続しないでください。

デフォルトの公式 PFN GGUF リビジョンと SHA-256 をピン留めしてください。
サポートされている PLaMo 0.8B, 2B, 8B, および 31B プリセットは、変更不可能な URL、完全なダイジェスト、およびモデルごとの実際のコンテキスト制限を持つコードで保持してください。
プロンプトのトークン化後、残りのコンテキストから完了予算を計算し、必要に応じて明示的な出力制限で短縮してください。
人工的な 8192 トークンのコンテキストデフォルト、4096 トークンの出力デフォルト、またはグローバルな 32768 トークンの上限を復元しないでください。
プリセットのメタデータを確認するためだけに、より大きなモデルをダウンロードしたり実行したりしないでください。
組み込みモデルを選択するために構成ファイルを必要としないでください。
デフォルトの PLaMo 予算を借り受けるのではなく、未知のカスタムモデルダイジェストに明示的な `contextSize` を要求してください。
ダイジェストによって既知のプリセットアーティファクトを特定し、`file:` URI で選択された一致するアーティファクトは、依然としてフルモデルの最大値をデフォルトとします。
サポートされているバイトレンジのモデルダウンロードを自動的に再開し、キャッシュに公開する前に完全なアーティファクトを検証してください。
モデルの重みは、Nix ストアやリポジトリではなく、ユーザーのキャッシュに保持してください。
オフラインキャッシュヒットが Hugging Face に接触してはいけません。
パッケージ化された llama-server パスを正確に使用し、暗黙的なエンジンのコンパイルやダウンロードを無効にしてください。
信頼できないソーステキストは信頼できる PFML3 特殊トークンと分離し、BOS を1回追加し、プロトコルのストップトークンを抑制してください。
サポートされていない言語、コンテキストのオーバーフロー、および出力の切り捨てを拒否し、成功した部分ファイルの報告は避けてください。
ユーザーを登録したり、代わりに商用規約を受け入れたりせずに、パブリッシャーのモデルライセンス通知を使用してください。

### macOS ヘルパー境界

アクセシビリティは、NSH や Node ではなく、別の単一実行の Swift 実行ファイルで動作します。
サードパーティの ABI ブリッジを使用せず、Apple の ApplicationServices API を直接使用してください。
ヘルパーは、プロンプトを必要としない許可の検査と、制限付き JSON レスポンスによる選択されたテキストのキャプチャをサポートします。
別の GUI ループをインストールしたり、プライバシー設定を変更したり、コピーキーストロークをシミュレートしたり、クリップボードを変更したりしてはいけません。
ネイティブのエラー詳細ではなく、安定した公開エラーコードを返してください。
ポップアップを表示するか有効化する前に、前のアプリケーションの選択内容をキャプチャしてください。
プロセスランチャーは注入可能であり、別の OS 実装で置き換えられるようにしてください。

TypeScript は、NSH 内部のデスクトップ構成のパース、検証、デフォルトファイルの作成、および自動起動ファイル操作を所有します。
標準的なクリップボード、ウィンドウ、アプリケーション、ショートカット、およびトレイコントロールは、NSH の JavaScript API を使用します。
インストールされたランチャーは、呼び出し元のワーキングディレクトリに依存せず、変更不可能な実行ファイルパスを設定します。
NSH のプロセス機能で必要な実行ファイルのみを許可してください。
ランタイム、キャッシュ、および構成パスに必要な環境変数のみを転送してください。
接続ごとに名前空間の翻訳リクエスト ID を管理し、リロードされたコントローラーが以前のリクエストをエイリアスできないようにしてください。
接続スコープが閉じると、子プロセスやショートカットの登録を解放してください。
遅延した古いスコープは、新しいスコープのリソースを登録解除してはいけません。

### ネイティブ CLI

Node サービスの選択とプログラムの開始には、`app/cli/src/main.ts` のみを使用してください。
`app/cli/src/program.ts` はコマンドをディスパッチし、ヘルプ、バージョン、および呼び出しエラーを提示します。
宣言的な Effect 4 の翻訳コマンドは `app/cli/src/commands/translate.ts` に、プライベートの自動起動ディスパッチは `app/cli/src/commands/autostart.ts` に記述してください。
`translate-batch.ts` は順序付き翻訳を実行し、`translation-plan.ts` は言語と出力のプランニングを定義し、`translation-files.ts` はファイルの安全性を所有します。
`package/runtime/src` に再利用可能な翻訳ポリシーを保持してください。
NSH、Swift、AppKit、グローバルホットキー、およびトレイリソースは、CLI の依存関係グラフやパッケージクロージャの外に保持してください。
ネイティブ引数、ワーキングディレクトリ、標準ストリーム、シグナル、および終了ステータスを使用してください。
シェルキャプチャブリッジ、`gshift-launcher.sh`、Nix バッチランチャー、または削除された `batch/` および `terminal/` 製品は復元しないでください。
引数はヘルプを表示せず、`--tui` は拒否されます。
デスクトップランタイムは分離して保持してください。
ランタイムの特定の Platform 実装を保持しつつ、翻訳および構成ポリシーは透過的に共有してください。
Vite+ および Vitest を使用して、再利用可能な `.test` ヘルパーで完全な出力をテストしてください。

### macOS ライフサイクル

プラットフォームスコープが明示的に拡張されるまで、Apple Silicon macOS のみをサポートします。
NSH の AppKit イベントループとデリゲートを保持してください。
メンテナンスされている [依存関係互換性レコード](docs/dependency-compatibility.md) には、正確なリリースと保持されたプリスパースパーサーのパッチが記載されています。
公式 NSH 実行ファイルとランタイムソースは変更されていません。
カスタムネイティブセットアップフックの代わりに、標準的なウィンドウ属性とスコープ付きの JS コントロールを使用してください。
ポップアップを閉じるとエンジンを破棄せずに非表示になり、再度開くと保持された状態が表示されます。
バックグラウンド起動でウィンドウを短時間起動して非表示にしないでください。

## 構成

NSH の TypeScript は、ウィンドウおよびショートカット設定に `XDG_CONFIG_HOME` を反映して `~/.config/glossshift/config.toml` を読み取ります。
デスクトップ TypeScript アダプターは、登録前に構成されたショートカットを NSH の標準的なショートカット表記に変換します。
共有ランタイムは、`XDG_CONFIG_HOME` または明示的な絶対 `GLOSSSHIFT_CONFIG` パスを反映して、`~/.config/glossshift/local.json` からローカル翻訳設定を読み取ります。
ローカルモデルキャッシュは `XDG_CACHE_HOME` を反映し、ローカル設定で変更できます。
`~/.agents` やレガシープロバイダーの認証情報を読み取りまたは変更しないでください。
構成、ショートカット、ネイティブ選択、プロセスフレーム、モデルメタデータ、およびモデル出力は、信頼できない境界入力として扱ってください。
テストは隔離された一時設定と合成ソーステキストを使用して行い、開発者のプライベート構成や選択されたコンテンツを決して使用しないでください。

## CLI コントラクト

引数なしの `gshift` は、構成やモデルをロードせずにヘルプを表示します。
`--tui` は、インタラクティブホストの起動ではなく拒否されます。
宣言的な Effect 4 コマンドは、ネイティブ Node 引数、ワーキングディレクトリ、標準ストリーム、および完了ステータスを使用します。
ファイルシステム呼び出しの前に、注入された Path サービスを通じて相対入力を解決してください。
診断情報およびターミナル制御シーケンスは、プレーンな翻訳 stdout に含めないでください。
`gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]` は、既存の動作を保持します。
構成またはモデルをロードする前に、すべての兄弟出力を解決し、入力/出力の衝突を拒否してください。
順序付きの `.md` および `.mbt.md` の処理、正規化された言語サフィックス、およびターゲットを変更せずに安全に強制置換されたシンボリックリンクを保持してください。
ファイル出力およびリダイレクトされた自動色 stdout は、ANSI エスケープ文字が含まれないようにしてください。
プレーンな翻訳には挿入されたセパレータが含まれません。
ターミナルの自動色および強制色バッファは、レンダリング前に各翻訳を完了させます。
色は、Markdown をパースしたり構文ハイライトを追加したりすることなく、完全な出力を色付けします。
デスクトップおよびネイティブ CLI は、同じローカルモデル、ソース言語、プロンプト形式、およびトークン予算ポリシーを共有します。

## 遅延統合テスト

Projektor の `GLOSSSHIFT-1`  issue は、アプリケーションまたはヘルパーバイナリを直接起動するテストの後続作業を追跡します。
これには、サブプロセス CLI の動作、真のモデルの推論とクリーンアップ、外部ツールアダプター、およびアプリケーションの動作に統合が必要な Swift 選択ヘルパーが含まれます。
その作業は現在のプロセス内ロジックテストから分離してください。
そのフォローアップの一環として、ビルドアーティファクト、シグネチャ、パッケージクロージャ、修正済みアセット、またはサードパーティ専用のチェックを復元しないでください。

## 検証とメンテナンス

- NSH による GUI 動作テスト、および Vite+ や Vitest によるネイティブ CLI テストを実行してください。コピーされたコントローラーハーネスを使用しないでください。
- 注入されたストリーム、一時的なファイルシステムデータ、および明示的なサービスレイヤーを使用して、アプリケーションの動作をテストしてください。
- ビルド、パッケージレイアウト、シグネチャ、アセット形式、または直接の外部バイナリ実行テストは行わないでください。
- プロジェクトウェアロジックテストとは別に、直接バイナリ統合のカバレッジをプロジェクトウェアで遅延させて保持してください。
- 合成プロトコルテストを、実際のモデル推論やヘッドレスレイアウトとネイティブなビジュアルレビューから区別してください。
- アクセシビリティまたはスクリーン権限がエンドユーザーのチェックをブロックする場合、境界を報告し、バイパスの試みを停止してください。
- ヘルパービルドは TypeScript バンドルから分離し、生成された NSH Rust ワークスペースへの依存をなくしてください。
- 実行可能な場合は、プロダクションソースファイルのサイズを 250 行未満に保ち、モジュールの責任を保持してください。
- テンプレートのパッケージマネージャーピン、リリース年齢の待機期間、厳格な年齢チェック、および拒否されたライフサイクルビルドを保持してください。
- 認証情報、生成された `.nsh`、`node_modules`、ターゲットディレクトリ、ベンチマークフィクスチャ、または一時的なレポートをコミットしないでください。
- ソース、構成、コミットメッセージ、および正書法ドキュメントは英語で記述してください。
- GlossShift CLI を使用して日本語ドキュメントを再生成してください：`gshift README.md AGENTS.md --lang ja --force`。
- CLI がインストールされていない場合は、プロジェクトタスクを使用してください：`vp run cli -- README.md AGENTS.md --lang ja --force`。
- このリポジトリの翻訳に `mdt` を使用しないでください。
- 生成がブロックされた場合は、手動で生成された出力を記録する代わりに、記録してください。
- `AGENTS.md` を正書法として保持し、別の `CLAUDE.md` を作成しないでください。

_この AGENTS.md は、[share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) と [AGENTS template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/agents/template.md) から生成されました。_
