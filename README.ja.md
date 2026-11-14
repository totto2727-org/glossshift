# GlossShift

GlossShiftは、TypeScriptとEffectで書かれた[NSH](https://nsh.dev/)デスクトップポップアップおよび対話型ターミナルUIを備えたmacOS翻訳アプリケーションであり、OpenAI互換のプロバイダー、プロンプト、認証情報、ストリーミングトランスポートを共有する`gshift`バッチコマンドも含みます。

## 使い方

```bash
open ~/.nix-profile/Applications/GlossShift.app
```

任意のmacOSアプリケーションでテキストを選択し、設定済みのショートカットを押します。
ポップアップはキャプチャしたテキストを**Source**に配置し、結果を**Translation**にストリーミングし、どちらのペインもコピーできるようにします。
**Plain**トグルは両方のペインをMarkdownプレビューと元のプレーンテキストの間で切り替えます。
プレビューはNSH標準のMarkdown `TextView`を使用し、見出し、リスト、表、インライン強調、引用ブロック、およびシンタックスハイライトなしのプレーンコードブロックを含みます。
リンクは外部ページを開かず、画像は取得せずに代替テキストを表示し、HTMLはそのまま表示されます。
コピーコントロールは表示モードに関係なく、Markdown構文を含む元のテキストを常にコピーします。

引数なしで`gshift`を実行すると、対話型ターミナルUIが開きます:

```bash
gshift
```

ソーステキストとターゲット言語を入力し、**Translate**を選択します。
ターミナルUIはデスクトップアプリケーションのMarkdown/プレーントグル、生コピーコントロール、キャンセル、プロバイダー設定、および認証情報を共有します。
デスクトップホットキー、トレイ、選択キャプチャを初期化せず、アクセシビリティ権限も必要としません。
**Quit**または`Ctrl+C`で終了し、ターミナルを復元します。
インストールされたラッパーは`gshift --tui`も受け付け、対話モードを明示的に選択できます。

バッチモードでファイルを翻訳するには:

```bash
gshift document.md notes.mbt.md --lang ja
```

ANSIスタイリングなしで翻訳を標準出力に書き出すには:

```bash
gshift document.md --lang ja --stdout --color never
```

初回呼び出し時に、`gshift`はGlossShift XDG設定ディレクトリにアプリケーション設定を作成し、共有プロバイダー設定を`~/.agents`に作成してから、プレースホルダーのAPIキーが置き換えられるまで終了します。設定後、最初のコマンドは`document.ja.md`と`notes.ja.mbt.md`を書き出し、それらのパスを標準エラーに報告します。2番目のコマンドはファイルを作成せずに、翻訳されたプレーンな本文を標準出力に出力します。複数の入力は常にコマンドラインの順序で処理されます。

## 主な機能

- グローバルショートカット、サイズ変更可能なウィンドウ、公式NSHコンポーネント、ネイティブTailwindクラス、および生テキストコピーコントロールを備えたネイティブmacOSポップアップ。
- 対話型翻訳用の公式NSHターミナルバックエンド。デスクトップホットキー、トレイ、選択キャプチャを初期化せずに、TypeScript/Effectの状態とプロバイダートランスポートを共有します。
- 固定されたNSH 0.5.0リリースと、それに対応するソースおよびターミナルコンポーネント。
- ネイティブサービスを注入したTypeScript/Effectアプリケーション状態。RustはmacOS統合、共有認証情報解決、および既存の翻訳トランスポートを維持します。
- プレーンテキストトグルを備えた読み取り専用Markdownプレビュー。シンタックスハイライトなし、外部コンテンツの自動読み込みなし。
- カスタムベースURLとリクエストパラメーターを含む、OpenAI Chat Completions APIを実装するサーバーを介したストリーミング翻訳。
- アプリケーション固有のXDG設定に加え、独立した`llm-profiles`クレートを通じて他のアプリケーションが再利用できる`~/.agents`の共有プロバイダーと認証情報。
- 兄弟ファイルまたは標準出力モードによる、順序付けられた複数ファイルMarkdown翻訳。
- パイプライン向けのプレーンなストリーミング出力と、ターミナル向けのオプションのTree-sitter Markdown ANSIハイライト。
- 分離されたシステムプロンプトとユーザードキュメントにより、ソースコンテンツは不活性のままとなり、その構造は翻訳契約を変更するのではなく一対一で翻訳されます。
- デスクトップポップアップでのリクエスト置換により、新しいショートカットが古い翻訳をキャンセルして置き換えます。

## 前提条件

- **Apple Silicon Mac専用**: Intel Macはサポートされていません。
- **flakesを有効にしたNix**
- **OpenAI互換プロバイダーの認証情報**: Chat Completionsを実装するサーバーのAPIキー、モデル、およびベースURLを用意します。
- **デスクトップアプリのアクセシビリティ権限**: グローバル選択キャプチャとそのシミュレートされた`Cmd+C`フォールバックを使用する際にアクセスを許可します。

## セットアップ

### インストールせずに実行

```bash
nix run 'github:totto2727-org/glossshift#glossshift'
nix run 'github:totto2727-org/glossshift#gshift' -- --help
```

### インストール

```bash
nix profile add 'github:totto2727-org/glossshift#glossshift'
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
        paths = [
          glossshift.packages.${system}.glossshift
          glossshift.packages.${system}.gshift
        ];
      };
    };
}
```

## 設定

GlossShiftは翻訳、ショートカット、およびウィンドウ設定を`~/.config/glossshift/config.toml`に、`XDG_CONFIG_HOME`が設定されている場合は`$XDG_CONFIG_HOME/glossshift/config.toml`に保持します。
プロバイダー定義は別途`~/.agents/config.toml`にあり、名前付きAPIキーはUnixパーミッション`0600`で`~/.agents/credentials.toml`にあります。
公開されている[`llm-profiles`](https://crates.io/crates/llm-profiles)クレートが、読み込み、検証、認証情報解決、およびRigへの変換を担います。
他のアプリケーションはGlossShiftに依存せずにこれらの同じファイルを読み取り、任意の名前付きプロバイダーを選択できます。

`AGENTS_CONFIG`を絶対設定ファイルパスに設定すると、別の共有設定を選択できます。
その`credentials.toml`は同じディレクトリから読み取られます。
ローダーはカレントディレクトリを検索したり、プロジェクトの`.agents`ディレクトリを暗黙的に使用したりしないため、異なるディレクトリからデスクトップとCLIを起動してもプロバイダーは変わりません。

### 共有プロバイダー

例えば、`~/.agents/config.toml`はOpenAIとOpenCode Goの両方を保持できます:

```toml
active_provider = "opencode-go"

[providers.openai]
base_url = "https://api.openai.com/v1"
model = "gpt-4.1-mini"
credential = "openai"
first_chunk_timeout_seconds = 30
stream_idle_timeout_seconds = 60

[providers.opencode-go]
base_url = "https://opencode.ai/zen/go/v1"
model = "kimi-k2.5"
credential = "opencode-go"
first_chunk_timeout_seconds = 30
stream_idle_timeout_seconds = 60

[providers.opencode-go.headers]
x-opencode-session = "${session_id}"
User-Agent = "glossshift/0.2.0"

# Optional provider-specific JSON-compatible request fields:
# [providers.opencode-go.request_parameters]
# reasoning_effort = "none"
```

プロバイダーアカウントで利用可能なChat Completionsモデルを選択してください。
ベースURLには`/v1`や`/zen/go/v1`などのAPIプレフィックスを含める必要があります。
`active_provider`はGlossShiftが使用するプロバイダーを選択し、各プロバイダーの`credential`は認証情報ファイル内のエントリを参照します。
プロバイダー名と認証情報名は同一である必要はありません。
両方のタイムアウト値はそれぞれデフォルトで30秒と60秒であり、正の値である必要があります。
追加のリクエストパラメーターはRigを通じて転送されます。
ヘッダー値内の`${session_id}`は、翻訳ごとに1つのUUIDに展開され、その翻訳内のすべてのリクエストで共有されます。
リテラル値およびその他のプレースホルダーは変更されません。

`~/.agents/credentials.toml`に対応するエントリを作成し、プレースホルダーを置き換えます:

```toml
[credentials.openai]
api_key = "replace-me"

[credentials.opencode-go]
api_key = "replace-me"
```

この認証情報ファイルや実際のシークレットヘッダー値を決してコミットしないでください。

### アプリケーション設定

GlossShiftのXDG `config.toml`はアプリケーション設定のみを含みます:

```toml
[translation]
source_language = "auto"

[[shortcuts]]
keys = "Ctrl+Super+KeyJ"
target_language = "Japanese"

[window]
width = 560
height = 360
min_width = 320
min_height = 180
```

ショートカットキーは一意である必要があり、すべてのターゲット言語は空でない必要があります。
スターターファイルについては、`examples/config.toml`、`examples/agents-config.toml`、および`examples/credentials.toml`を参照してください。

### 既存のインストール

選択された共有設定がまだ存在しない場合、GlossShiftはXDG設定からレガシーのプロバイダー定義とアクティブプロバイダーをインポートし、共有認証情報ファイルが存在しない場合はレガシー認証情報をコピーします。
既存の共有ファイルは決して上書きされず、元のレガシーファイルは保持されます。
共有設定が存在すると、古いGlossShift設定のプロバイダー設定は共有プロバイダーを選択または変更しなくなります。
今後のプロバイダー変更には共有ファイルを編集し、その後デスクトップアプリケーションを再起動するかCLIを再実行してください。

## 権限

システム設定 > プライバシーとセキュリティ > アクセシビリティで、インストールされた`GlossShift.app`へのアクセスを許可します。この権限により、グローバルショートカットが選択テキストをキャプチャし、アプリケーションが選択範囲を直接公開しない場合にシミュレートされた`Cmd+C`フォールバックを使用できるようになります。

## API

サポートされるエンドユーザーインターフェースは、パッケージ化された`GlossShift.app`と`gshift`コマンドです。ソースパッケージで公開されているRustモジュールは、これらのバイナリ間で実装を共有します。GlossShiftは、別途サポートされるRustライブラリAPIやレジストリ参照を公開していません。

### `gshift`

インストールされた`gshift`ラッパーは、引数なしまたは`--tui`付きで呼び出された場合に公式NSHターミナルホストを選択します。
ファイルおよびオプションの呼び出しは、引き続き以下のバッチインターフェースを使用します。
NSH 0.5.0は`nsh package --target tui`を提供しないため、NixパッケージはNSHの生成されたターミナルホストをそのアプリケーションバンドルとともにインストールします。

```text
gshift
gshift --tui
gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]
```

| 入力またはオプション           | 意味                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `<FILES>...`                   | 1つ以上の`.md`または`.mbt.md`ファイル。指定された順序で順次翻訳されます。                                                   |
| `-l`, `--lang <LANGUAGE>`      | 必須のターゲット言語コード。トリムされ、小文字化され、ASCII英字、数字、および内部ハイフンのみを含む必要があります。       |
| `-f`, `--force`                | 既存の兄弟出力を置き換えます。`--stdout`と競合します。                                                                      |
| `--stdout`                     | 区切り文字を挿入せずに、入力順に翻訳を標準出力に連結します。                                                                |
| `--color <MODE>`               | バッチstdoutのANSI Markdownハイライトを制御します: `auto`、`always`、または`never`。デフォルトは`auto`で、`--stdout`が必要です。 |
| `-h`, `--help`                 | 生成されたコマンドリファレンスを出力します。                                                                                |
| `-V`, `--version`              | インストールされたバージョンを出力します。                                                                                  |

`--stdout`なしの場合、`gshift`は`.md`の前に`.<language>`を挿入し、複合拡張子`.mbt.md`を保持し、既存の末尾の`.ja`または`.en`言語セグメントを置き換えます。入力または別の出力と衝突する出力パスは拒否されます。既存のファイルおよびシンボリックリンクは、`--force`が設定されていない限り拒否されます。強制されたシンボリックリンク出力は、そのターゲットを変更せずにリンク自体を置き換えます。

`--stdout --color auto`の場合、リダイレクトされた出力はプレーンでストリーミングされますが、ターミナル出力は翻訳ごとにバッファリングされ、ANSIハイライトされます。`--color never`は常にプレーン出力をストリーミングし、`--color always`はリダイレクトされた場合でもANSIスタイリングを出力します。ファイル出力にはANSIエスケープが含まれることはありません。

設定、入力、プロバイダー、タイムアウト、および出力の失敗は、`gshift failed:`プレフィックスと終了ステータス`1`を付けて標準エラーに書き込まれます。ヘルプおよびバージョンの出力は、設定を読み込まずに正常終了します。

```bash
# Replace existing Japanese sibling outputs.
gshift first.md second.md --lang ja --force

# Stream plain English output for a pipeline.
gshift document.md --lang en --stdout --color never
```

## 開発

リポジトリ構造、アーキテクチャ、および開発コマンドについては、[AGENTS.md](./AGENTS.md)を参照してください。

```bash
nix develop
vp install --frozen-lockfile
vp run typecheck
vp run test
vp run test-tui
vp run tui
# Start the desktop development host separately:
vp run dev
```

Vite+はタスクランナー、インストーラー、フォーマッター、およびリンターです。
型チェック、アプリケーション実行、テスト、バンドル、およびネイティブパッケージングは、ViteやNode/ブラウザレンダラーではなくNSHに委任されます。
`vp run build`はNSHバンドルを作成し、`vp run package`はネイティブmacOSアプリケーションを作成します。
アプリケーションは、状態遷移、スコープ付きリクエストキャンセル、検証済みネイティブ境界、および有界ストリーミングにEffectを使用します。
Rustは`llm-profiles`、既存のRigプロバイダー契約、macOSサービス、およびバッチ`gshift` CLIを維持します。
ローカルNSHコマンドは、Rust入力が変更されていない場合に`target`のCargoキャッシュを再利用するため、TSビューの変更でそれらの実装を再コンパイルする必要はありません。
変更されたNixアプリケーションderivationは新しいサンドボックスでビルドされ、その作業ディレクトリキャッシュを再利用しません。
この移行は、コールドRustビルドや変更されたNixパッケージをインクリメンタルにするものではありません。

開発環境は、固定されたNSHソース依存関係を`.nsh/upstream`に準備します。
小さく保守された[上流互換パッチ](./docs/upstream-differences.md)は、NSHのAppKitループを置き換えることなく、アクティベーション前のネイティブセットアップ、非表示スタートアップ、保持ウィンドウの可視性、およびシャットダウンフックを提供します。
アプリケーションCSSスタイルシートやカスタムMarkdownパーサーは不要です。
アプリケーションテストは、注入されたサービスと合成認証情報を使用してNSHの公式テストホストで実行されます。
他のアプリケーション間でのネイティブ選択には、引き続きmacOSアクセシビリティ権限が必要です。

## ライセンス

パッケージメタデータはMITを宣言していますが、このリポジトリには現在`LICENSE`ファイルが含まれていません。

_このREADMEは、[share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md)および[READMEテンプレート](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/readme/template.md)から生成されました。_