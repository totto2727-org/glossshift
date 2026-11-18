# GlossShift

GlossShiftは、Apple Silicon搭載Mac上でテキストをローカル翻訳します。
デスクトップポップアップでは、NSH、TypeScript、Effectを使用しています。
スタンドアロンの`gshift`コマンドは、Node.js 26上でEffect 4 CLIと共に動作し、ローカル翻訳サービスを共有します。

## 使用方法

インストール済みのデスクトップアプリケーションを開きます：

```bash
open ~/.nix-profile/Applications/GlossShift.app
```

別のアプリケーションでテキストを選択し、設定済みのショートカットを押します。
GlossShift はソースを表示し、翻訳を 2 つ目のペインにストリーミングします。
Copy は常に Markdown 構文を含む元のテキストを使用します。
**Plain** トグルで、両方のペインを Markdown プレビューとプレーンテキストで切り替えます。
コードブロックには構文ハイライトがなく、リンクは開かず、画像は代替テキストが表示され、HTML はリテラルのままです。
デスクトップ選択のキャプチャには macOS のアクセシビリティ権限が必要です。
ヘルパーは、GlossShift がポップアップを有効にする前に、フォーカスされているアプリケーションのアクセシビリティ選択を読み取ります。
この API を通じて選択したテキストを公開していないアプリケーションは、エラーを報告します。
GlossShift は `Cmd+C` をシミュレートしたり、クリップボードの内容を置き換えて選択をキャプチャしたりしません。

コマンドヘルプを表示します：

```bash
gshift
gshift --help
```

CLI は非対話型であり、NSH、Swift、またはアクセシビリティ権限を必要としません。
`--tui` は拒否されます。
対話型ポップアップ用に、デスクトップアプリケーションを別途起動します。
デスクトップは NSH の公式プリビルドホストと、カスタム Rust アプリケーションコードを必要としない別の Swift 選択ヘルパーを使用します。

提供された順序で Markdown ファイルを翻訳します：

```bash
gshift document.md notes.mbt.md --lang ja
# 兄弟ファイルを作成せずにプレーン出力を記述します：
gshift document.md --lang en --stdout --color never
```

ファイルモードは `document.ja.md` と `notes.ja.mbt.md` を書き込み、そのパスを stderr に報告します。
プレーン stdout は、区切り文字を挿入せずに翻訳を連結します。
最初の翻訳は、公式の PLaMo 3 Translate 0.8B Q4_K_M GGUF（約 573 MB）を自動的にダウンロードします。
それ以降の実行では、検証済みのキャッシュモデルを使用し、再度ダウンロードすることはありません。
ホスト型モデルのアカウントや API キーは不要です。
テキストは Mac で処理され、ホスト型推論サービスには送信されません。

> [!IMPORTANT]
> デフォルトモデルは [PLaMo Community License](https://plamo.preferredai.jp/info/plamo-community-license-en) を使用しており、アプリケーションの MIT メタデータライセンスではありません。
> 商用利用には、そのライセンスに基づく事前の登録と適格性が必要です。
> 使用前に利用規約を確認してください。
> GlossShift はユーザーを登録したり、ユーザーに代わって商用利用規約を受け入れたりすることはありません。

## 機能

- グローバルショートカットと独立したEffect 4 CLIを備えたmacOSネイティブポップアップ。
- 固定された公式Llamaサーバーと実際のEffect AI `LanguageModel`アダプターによるローカルMetal推論。
- モデルの自動ダウンロード、固定されたデフォルトリビジョン、SHA-256検証、およびオフラインキャッシュの再利用。
- より大規模なGGUFモデルの設定が可能で、コンテキストと出力の制限も明示的に指定可能。
- デスクトップとCLI間で共通の翻訳、キャンセル、モデル選択、およびトークン予算ポリシー。
- 入出力の衝突チェックと安全なシンボリックリンク置換を備えた、順序付きMarkdownファイル処理。
- TypeScriptアプリケーション、翻訳、設定、および自動起動ポリシー。別途、小規模なSwift Accessibilityヘルパーを搭載。

## 前提条件

- Apple Silicon macOS。
- フレークを有効にした Nix。
- 初回モデルダウンロード用のネットワークアクセス権およびディスク容量。
- 選択したモデルおよびコンテキストで利用可能な十分なメモリ。
- デスクトップ選択キャプチャのみのアクセシビリティ権限。

スタンドアロンの `gshift` Nix パッケージには、NSH や Swift を使用せず、Node.js 26、本番環境向け JavaScript 依存関係、およびピン留めされた推論・ファイルユーティリティが含まれています。
GUI は Node プロセスを起動することなく、公式の NSH ホストと小規模な Swift ヘルパーを使用します。
統合された `glossshift` パッケージには `GlossShift.app` が含まれており、スタンドアロン CLI をリンクしているため、そのクロージャにも Node が含まれています。
両パッケージとも、Metal サポートを備えた Nixpkgs unstable の `llama-cpp` 0.9.0 を使用しています。
推論依存関係には独自の Nixpkgs ピンが割り当てられており、アプリケーションのメインツールチェーンピンは変更されません。
初回使用時に、コンパイラ、ネイティブ Node アドオン、またはエンジンのダウンロードは不要です。
モデルの重みは Nix ストアではなく、ユーザーのキャッシュに保持されます。
推論サーバーはアプリケーション専用で、ループバックでのみ待機し、起動ごとに新しい認証キーを使用します。

## セットアップ

### インストールなしで実行

```bash
nix run 'github:totto2727-org/glossshift#glossshift'
nix run 'github:totto2727-org/glossshift#gshift' -- --help
```

### インストール

```bash
nix profile add 'github:totto2727-org/glossshift#glossshift'
```

このパッケージには `GlossShift.app` と `gshift` が含まれています。
NSH や Swift を使用せず、CLI のみをインストールする場合は：

```bash
nix profile add 'github:totto2727-org/glossshift#gshift'
```

### Nix のフラケ

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

## 設定

### ローカル翻訳

デフォルトの 0.8B モデルでは設定は不要です。
サポートされている PLaMo 3 翻訳モデルには、`package/runtime/src/models.ts` にプリセットが組み込まれています。
モデルを選択すると、その不変の GGUF URL、SHA-256 ダイジェスト、プロンプト形式、言語ポリシー、およびサポートされているコンテキスト制限も選択されます。
4 つの組み込みプリセットはすべて、`package/runtime/src/models.ts` で 262144 トークンのコンテキスト制限を宣言しており、パブリッシャーの `max_position_embeddings` メタデータと一致しています。
補完予算は、プロンプトのトークン化後に残ったコンテキストから算出されます。
明示的な設定によって予算を削減できますが、モデルのサポートされているコンテキストを超えることはできません。

| モデルセレクタ                     | 量子化 | ダウンロードサイズ          |
| ---------------------------------- | ------------ | ---------------------- |
| `plamo-3-translate-0.8b` (デフォルト) | Q4_K_M       | 約 573 MB   |
| `plamo-3-translate-2b`             | Q4_K_M       | 約 1.81 GB  |
| `plamo-3-translate-8b`             | Q4_K_M       | 約 5.28 GB  |
| `plamo-3-translate-31b`            | Q4_K_M       | 約 19.53 GB |

大規模なモデルやコンテキストでは、GGUF のファイルサイズを超えるランタイムおよびコンテキストバッファを含め、より多くのディスク容量とメモリが必要になります。
フルコンテキストが利用可能なメモリに収まらない場合は、より小さい明示的な `contextSize` を設定してください。
31B プリセットは、公式の PLaMo 3 Translate ファミリーで最大のモデルです。
メンテナンスされたテストは、注入されたサービスや分離されたファイルシステムデータを通じてアプリケーションロジックをカバーします。
アプリケーション、推論、外部ツール、またはヘルパーバイナリを直接起動するテストは、Projektor の issue `GLOSSSHIFT-1` に委譲されます。
設定ファイルを作成せずに組み込みモデルを選択する場合：

```sh
GLOSSSHIFT_MODEL=plamo-3-translate-2b gshift README.md --lang ja
```

GUI および CLI の起動にも同様の環境選択が適用されます。
未知のセレクタが失敗し、別のモデルがサイレントに使用される場合があります。
あるいは、オプションのローカル設定で `"model": "plamo-3-translate-2b"` を設定してください。
`GLOSSSHIFT_MODEL` はファイルのモデルよりも優先されますが、明示的なキャッシュやトークン予算のオーバーライドは置き換えません。

オプション設定は `~/.config/glossshift/local.json` または `$XDG_CONFIG_HOME/glossshift/local.json` に配置されます。
別のローカル設定を選択するには、`GLOSSSHIFT_CONFIG` を絶対ファイルパスに設定してください。
明示的に選択されたファイルが存在する必要があります。

```json
{
  "sourceLanguage": "auto"
}
```

`sourceLanguage` はデフォルトで自動検出されます。
組み込みプリセットの場合、オプションの `contextSize` には入力、プロンプト、および生成された翻訳が含まれます。
オプションの `maxTokens` は、動的に計算される残りのコンテキスト内で生成されるトークンをさらに制限します。
サイズが大きすぎるソースや不完全な出力は、正常に切り詰められたファイルを生成する代わりに失敗します。
設定された制限が不十分な場合は、より小さなセクションを翻訳してください。

デフォルトのキャッシュは `~/.cache/glossshift/models` または `$XDG_CACHE_HOME/glossshift/models` です。
`cacheDirectory` を絶対ディレクトリに設定してオーバーライドしてください。
ダウンロードされるファイルは SHA-256 ダイジェスト付きで命名され、ロード前に検証されます。

PLaMo 3 翻訳モデルには `prompt: "plamo"` を使用してください。
別の単一ファイル GGUF の場合、メタデータに有効なチャットテンプレートが提供されている場合にのみ `prompt: "chat"` を使用してください。
カスタム `model` オブジェクトには `uri`、`sha256`、および `prompt` が必要で、HTTPS または `file:` URI とその完全な SHA-256 ダイジェストが必要です。
そのダイジェストが既知の組み込みアーティファクトでない場合は、その GGUF のサポートされている値に `contextSize` を明示的に設定してください。
未知のカスタムアーティファクトは、デフォルトの PLaMo コンテキストサイズを継承しません。
既知のプリセットアーティファクトは、同じダイジェストを持つカスタム `file:` URI で選択された場合でも、モデルコンテキストのデフォルト値を保持します。
マルチパート GGUF はサポートされていません。
ダウンロード URL で選択されるのはモデルの重みであり、ホストされた推論エンドポイントではありません。
設定変更後はアプリケーションを再起動してください。

[公式のデフォルトアーティファクト](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/tree/1cf96ae02133958a20074bfdfab76517bb737d00) およびすべてのプリセットダイジェストは `package/runtime/src/models.ts` にピン留めされています。

### デスクトップ設定

ウィンドウおよびショートカット設定は `~/.config/glossshift/config.toml` に配置され、`XDG_CONFIG_HOME` に準拠しています：

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

ショートカットキーは一意である必要があり、各ターゲット言語は空であってはなりません。
GlossShift はこのファイルが存在しない場合にのみ作成します。
既存の設定や共有の `~/.agents` ファイルは上書きされません。
プロバイダーの認証情報や古いプロバイダー設定はローカル翻訳に使用されません。
ソース言語およびモデル設定には `local.json` を使用してください。

## コマンドリファレンス

```text
gshift
gshift --help
gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]
```

| オプション                    | 動作                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `<FILES>...`              | `.md` および `.mbt.md` の入力を順に処理します。                                          |
| `-l`, `--lang <LANGUAGE>` | `ja` や `en` など、対象言語を選択します。                                     |
| `-f`, `--force`           | 既存の兄弟出力を置き換えますが、入力ファイルは決して置き換えません。`--stdout` との競合が発生します。 |
| `--stdout`                | ファイルを書き出さずに、翻訳結果を stdout に連結します。                             |
| `--color <MODE>`          | 出力全体の ANSI スタイルを `auto`、`always`、または `never` に設定します。`--stdout` が必要です。   |
| `-h`, `--help`            | モデルや設定を読み込まずにヘルプを表示します。                                   |
| `-V`, `--version`         | モデルや設定を読み込まずにバージョンを表示します。                            |

ファイル名の `.md` または `.mbt.md` の前に言語サフィックスが付与されます。
既存の末尾の `.ja` または `.en` サフィックスは置き換えられます。
入出力の衝突、重複出力、および未承認の上書きは、モデルを読み込む前に失敗します。
`--force` を使用すると、シンボリックリンク出力のターゲットを変更せずに置き換えます。
ファイル出力およびリダイレクトされた自動色付き stdout には ANSI スタイルは含まれません。
color はターミナルスタイルのみを追加し、Markdown の構文ハイライトは追加しません。
CLI は、Node のネイティブプロセス環境を通じて、引数、作業ディレクトリ、および標準ストリームを直接受け取ります。
シェルキャプチャディレクトリやヘッドレス NSH ブリッジは関与しません。
推論失敗が発生した場合でも、以前に完了した入力からの出力は残りますが、未完了の翻訳は完了ファイルとして公開されません。
ファイルモードでは、完了した翻訳のみが書き込まれます。
失敗時の診断出力は stderr に出力され、終了ステータスは 0 以外となります。

## 開発

リポジトリの構造、アーキテクチャ、ツールチェーンの設定、およびバリデーションコマンドについては、[AGENTS.md](./AGENTS.md) を参照してください。
Vite+ は、Vitest を通じてインストール、タスク、フォーマット、リント、およびネイティブ CLI テストを管理します。
NSH は、GUI 実行、テスト、バンドル、およびネイティブパッケージングを管理します。
CLI は Node.js 26 上で `app/cli/src/main.ts` を実行し、`app/cli/src/commands/translate.ts` で宣言的な Effect 4 コマンドを使用します。
PNPM ワークスペースは、周囲のワークスペースの他のプロジェクトで採用されているロールベースのレイアウトに従い、`app/*` 内のアプリケーションと `package/*` 内の再利用可能なライブラリを分離します。
`@glossshift/desktop` および `@glossshift/cli` は `workspace:*` 依存関係を通じて `@glossshift/runtime` を消費し、デスクトップは `@glossshift/nsh-platform` も消費します。
パッケージソースのエクスポートでは、TypeScript のパスエイリアスを使用せずにこれらの依存関係を解決します。
依存関係のバージョンは、既存のリリース時のセーフガードに従い、PNPM カタログに一元管理されます。
`tsconfig.base.json` には共通の厳格なポリシーが保持され、最小限のパッケージ構成では Node または生成された NSH タイプが選択されます。
`vp run typecheck` は各ワークスペースパッケージの `typecheck` スクリプトを再帰的に実行するため、新しいパッケージはルートリストに追加するのではなく、そのスクリプトを宣言することで参加します。
各パッケージは、共通ベースの単一の `include: ["${configDir}/**/*"]` ルールを通じてディレクトリ全体をスキャンし、プロジェクトごとのファイルリストや除外設定は行いません。
この広範なルールが必要なのは、NSH の生成された設定で `files` が宣言されており、そうでなければ暗黙的な検出が無効になり、アプリケーションソースがチェックされないためです。
新しいソースファイルおよびテストファイルは、登録なしでプロジェクトの typecheck に参加します。
`vp run check` はフォーマットとリントのみの処理に留まります。
デスクトップの開発、実行、バンドル、およびパッケージングは `app/desktop` を対象とし、公開タスク名は変更されません。
GUI は、抽出可能な Effect Platform レイヤーを通じて、共有の設定および翻訳ポリシーを NSH 内部で直接実行します。
[ランタイムアーキテクチャ](./docs/runtime-architecture.md) では、これらのプロセスとパッケージングの境界が文書化されています。
メンテナンスされている [依存関係互換性レコード](./docs/dependency-compatibility.md) では、変更されていない NSH リリースおよび保持された plist バリデーションパッチが文書化されています。
GlossShift はオリジナルのアプリケーションであり、フォークではありません。
[NSH Effect Platform](./package/nsh-platform/platform/README.md) には、別の NSH プロジェクトで再利用するための、アプリケーションに依存しない明示的なコンポジション API が用意されています。

## ライセンス

アプリケーションのメタデータには MIT が宣言されていますが、このリポジトリには現在 `LICENSE` ファイルが含まれていません。
デフォルトのモデルは PLaMo Community License に基づく別個のソフトウェアです。
PLaMo でビルドされています。
