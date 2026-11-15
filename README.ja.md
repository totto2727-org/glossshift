# GlossShift

GlossShift は、Apple Silicon Mac 上でテキストをローカルに翻訳します。
デスクトップのポップアップでは NSH、TypeScript、Effect が使用されます。
スタンドアロンの `gshift` コマンドは Node.js 26 上で動作し、Effect 4 CLI とローカル翻訳サービスを共有します。

## 使用方法

インストール済みのデスクトップアプリケーションを起動します：

```bash
open ~/.nix-profile/Applications/GlossShift.app
```

別のアプリケーションでテキストを選択し、設定済みのショートカットを押します。
GlossShift はソースを表示し、翻訳内容を 2 つ目のペインにストリーミングします。
コピーは常に、Markdown 構文を含む元のテキストを使用します。
**Plain** トグルで、両方のペインを Markdown プレビューとプレーンテキストで切り替えます。
コードブロックにはシンタックスハイライトがなく、リンクは開かず、画像は代替テキストを表示し、HTML はリテラルのままです。
デスクトップ選択のキャプチャには macOS Accessibility 権限が必要です。
ヘルパーは、GlossShift がポップアップを有効にする前に、フォーカスされているアプリケーションの Accessibility 選択を読みます。
この API を通じて選択されたテキストを公開しないアプリケーションは、エラーを報告します。
GlossShift は `Cmd+C` をシミュレートしたり、クリップボードの内容を置き換えて選択をキャプチャしたりしません。

コマンドヘルプを表示します：

```bash
gshift
gshift --help
```

CLI は非対話的であり、NSH、Swift、Accessibility 権限は不要です。
`--tui` は拒否されます。
インタラクティブなポップアップ用にデスクトップアプリケーションを別途起動します。
デスクトップでは、NSH の公式プリビルドホストと、カスタム Rust アプリケーションコードを必要としない別の Swift 選択ヘルパーを使用します。

提供された順序で Markdown ファイルを翻訳します：

```bash
gshift document.md notes.mbt.md --lang ja
# 兄弟ファイルを作成せずにプレーンな出力を書き出す：
gshift document.md --lang en --stdout --color never
```

ファイルモードでは、`document.ja.md` と `notes.ja.mbt.md` を書き出し、それらのパスを stderr に報告します。
プレーンな stdout は、区切り文字を挿入せずに翻訳内容を連結します。
最初の翻訳は、公式の PLaMo 3 Translate 0.8B Q4_K_M GGUF（約 573 MB）を自動的にダウンロードします。
後続の実行では、再ダウンロードせずに検証済みのキャッシュモデルを使用します。
ホスト型モデルのアカウントや API キーは不要です。
テキストは Mac で処理され、ホスト型の推論サービスには送信されません。

> [!IMPORTANT]
> デフォルトモデルは [PLaMo Community License](https://plamo.preferredai.jp/info/plamo-community-license-en) を使用しており、アプリケーションの MIT メタデータライセンスではありません。
> 商用利用には、当該ライセンスに基づく事前の登録と資格が必要です。
> 使用前に利用規約を確認してください。
> GlossShift はユーザーを登録せず、またユーザーに代わって商用規約を受け入れることもありません。

## 機能

- グローバルショートカットと別の Effect 4 CLI を備えたネイティブ macOS ポップアップ。
- ピン留めされた公式 llama サーバーと本物の Effect AI `LanguageModel` アダプターによるローカル Metal 推論。
- モデルの自動ダウンロード、ピン留めされたデフォルトリビジョン、SHA-256 検証、およびオフラインキャッシュの再利用。
- より大規模な GGUF モデルの設定可能、および明示的なコンテキストと出力制限。
- デスクトップと CLI にわたる翻訳、キャンセル、モデル選択、およびトークン予算ポリシーの共有。
- 入力/出力の衝突チェックと安全なシンボリックリンク置換を伴う、順序付き Markdown ファイル処理。
- TypeScript アプリケーション、翻訳、設定、および自動起動ポリシー（少数の独立した Swift Accessibility ヘルパーを含む）。

## 前提条件

- Apple Silicon macOS。
- flakes を有効にした Nix。
- 初回モデルダウンロード用のネットワークアクセスとディスク容量。
- 選択したモデルとコンテキストに十分な空きメモリ。
- デスクトップ選択のキャプチャにのみ Accessibility 権限。

スタンドアロンの `gshift` Nix パッケージには、NSH や Swift を必要としない Node.js 26、プロダクション向け JavaScript 依存関係、およびピン留めされた推論・ファイルユーティリティが含まれています。
GUI は公式 NSH ホストと少数の Swift ヘルパーを使用し、Node プロセスを起動しません。
統合された `glossshift` パッケージには `GlossShift.app` が含まれており、スタンドアロン CLI をリンクしているため、そのクロージャには Node も含まれます。
両パッケージとも、Metal サポート付きの Nixpkgs の unstable 版 `llama-cpp` 0.9.0 を使用しています。
推論依存関係には、アプリケーションのメインツールチェーンピンを変更することなく、独自の正確な Nixpkgs ピンが付与されています。
初回使用時にコンパイラ、ネイティブ Node アドオン、またはエンジンのダウンロードは不要です。
モデルの重みは、Nix ストアではなくユーザーのキャッシュに保持されます。
推論サーバーはアプリケーションにとってプライベートであり、ループバックでのみ待機し、起動ごとに新しい認証キーを使用します。

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

パッケージには `GlossShift.app` と `gshift` が含まれています。
NSH や Swift を使用せず、CLI のみをインストールする場合：

```bash
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
        paths = [ glossshift.packages.${system}.glossshift ];
      };
    };
}
```

## 設定

### ローカル翻訳

デフォルトの 0.8B モデルに設定は不要です。
サポートされている PLaMo 3 翻訳モデルには、`package/runtime/src/models.ts` にプリセットが組み込まれています。
モデルを選択すると、その変更不可能な GGUF URL、SHA-256 ダイジェスト、プロンプト形式、言語ポリシー、およびサポートされているコンテキスト制限も選択されます。
4 つのプリセットすべてが、`package/runtime/src/models.ts` で 262144 トークンのコンテキスト制限を宣言しており、パブリッシャーの `max_position_embeddings` メタデータと一致しています。
完了予算は、プロンプトのトークン化後に残存するコンテキストから計算されます。
明示的な設定で予算を削減できますが、モデルのサポートされているコンテキストを超えることはできません。

| モデルセレクター                     | 量子化 | ダウンロードサイズ          |
| ---------------------------------- | ------------ | ---------------------- |
| `plamo-3-translate-0.8b` (デフォルト) | Q4_K_M       | 約 573 MB   |
| `plamo-3-translate-2b`             | Q4_K_M       | 約 1.81 GB  |
| `plamo-3-translate-8b`             | Q4_K_M       | 約 5.28 GB  |
| `plamo-3-translate-31b`            | Q4_K_M       | 約 19.53 GB |

大規模なモデルや大規模なコンテキストでは、GGUF ファイルサイズを超えてランタイムやコンテキストバッファを含む、より多くのディスク容量とメモリが必要になります。
フルコンテキストが利用可能なメモリに収まらない場合は、小さな明示的な `contextSize` を設定してください。
31B プリセットは、公式 PLaMo 3 Translate ファミリーで最大のモデルです。
実際のソースとインストール済み CLI チェックにより、設定済みの 262144 トークンコンテキストでキャッシュされた 0.8B の翻訳をカバーします。
そのコンテキストでのプロダクションサーバー起動チェックにより、Metal およびポジティブな GPU レイヤーオフロードが検証されます。
これらのチェックは、262144 トークンのプロンプト、大規模モデル、または比較性能を検証するものではありません。
設定ファイルを作成せずに組み込みモデルを選択してください：

```sh
GLOSSSHIFT_MODEL=plamo-3-translate-2b gshift README.md --lang ja
```

同じ環境選択が GUI および CLI 起動にも適用されます。
未知のセレクターは、別のモデルをサイレントに使用せずに失敗します。
あるいは、オプションのローカル設定で `"model": "plamo-3-translate-2b"` を設定してください。
`GLOSSSHIFT_MODEL` はファイルのモデルより優先されますが、明示的なキャッシュやトークン予算のオーバーライドは置き換えません。

オプション設定は `~/.config/glossshift/local.json` または `$XDG_CONFIG_HOME/glossshift/local.json` に保存されます。
別のローカル設定を選択するには、`GLOSSSHIFT_CONFIG` を絶対ファイルパスに設定してください。
明示的に選択されたファイルが存在する必要があります。

```json
{
  "sourceLanguage": "auto"
}
```

`sourceLanguage` はデフォルトで自動検出されます。
組み込みプリセットの場合、オプションの `contextSize` には入力、プロンプト、および生成された翻訳が含まれます。
オプションの `maxTokens` は、動的に計算される残りのコンテキスト内の生成トークンをさらに制限します。
サイズが大きすぎるソースや不完全な出力は、成功した切り詰めファイルを生成せずに失敗します。
設定された制限が不十分な場合は、小規模なセクションを翻訳してください。

デフォルトのキャッシュは `~/.cache/glossshift/models` または `$XDG_CACHE_HOME/glossshift/models` です。
`cacheDirectory` を絶対ディレクトリに設定してオーバーライドしてください。
ダウンロードされたファイルは SHA-256 ダイジェストで命名され、ロード前に検証されます。

PLaMo 3 翻訳モデルには `prompt: "plamo"` を使用してください。
別の単一ファイル GGUF の場合は、メタデータに有効なチャットテンプレートが提供されている場合にのみ `prompt: "chat"` を使用してください。
カスタム `model` オブジェクトには `uri`、`sha256`、および `prompt` が必要で、HTTPS または `file:` URI とその完全な SHA-256 ダイジェストが必要です。
そのダイジェストが既知の組み込みアーティファクトでない場合は、その GGUF のサポートされている値に `contextSize` を明示的に設定してください。
未知のカスタムアーティファクトは、デフォルトの PLaMo コンテキストサイズを継承しません。
既知のプリセットアーティファクトは、同じダイジェストを持つカスタム `file:` URI で選択した場合でも、フルモデルのコンテキストデフォルトを保持します。
マルチパート GGUF はサポートされていません。
ダウンロード URL はモデルの重みを選択しますが、ホスト型の推論エンドポイントを選択しません。
設定変更後はアプリケーションを再起動してください。

[公式のデフォルトアーティファクト](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/tree/1cf96ae02133958a20074bfdfab76517bb737d00) およびすべてのプリセットダイジェストは、`package/runtime/src/models.ts` にピン留めされています。

### デスクトップ設定

ウィンドウおよびショートカット設定は `~/.config/glossshift/config.toml` にあり、`XDG_CONFIG_HOME` に準拠しています：

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
プロバイダーの認証情報および古いプロバイダー設定は、ローカル翻訳には使用されません。
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
| `-l`, `--lang <LANGUAGE>` | ターゲット言語（`ja` や `en` など）を選択します。                                     |
| `-f`, `--force`           | 既存の兄弟出力を置き換えますが、入力ファイルは置き換えません。`--stdout` と競合します。 |
| `--stdout`                | ファイルを書き出さずに翻訳を stdout に連結します。                             |
| `--color <MODE>`          | 全出力の ANSI スタイリングを `auto`, `always`, または `never` に設定します。`--stdout` が必要です。   |
| `-h`, `--help`            | モデルや設定をロードせずにヘルプを表示します。                                   |
| `-V`, `--version`         | モデルや設定をロードせずにバージョンを表示します。                            |

ファイル名は、`.md` または `.mbt.md` の前に言語サフィックスが付与されます。
既存の末尾の `.ja` または `.en` サフィックスは置き換えられます。
入力/出力の衝突、重複出力、および未承認のオーバーライトは、モデルのロード前に失敗します。
`--force` を使用すると、ターゲットを変更せずにシンボリックリンク出力が置き換えられます。
ファイル出力およびリダイレクトされた自動色 stdout には ANSI スタイリングは含まれません。
色はターミナルのスタイリングのみを追加し、Markdown 構文ハイライトは追加しません。
CLI は引数、ワーキングディレクトリ、および標準ストリームを直接 Node のネイティブプロセス環境から受け取ります。
シェルキャプチャディレクトリやヘッドレス NSH ブリッジは関与しません。
推論の失敗により、以前完了した入力からの出力が残ることがありますが、未完了の翻訳は完了ファイルとして公開されません。
ファイルモードは完了した翻訳のみを書き込みます。
失敗時の診断出力は stderr となり、終了ステータスは 0 になります。

## 開発

リポジトリの構造、アーキテクチャ、ツールチェーンのセットアップ、および検証コマンドについては [AGENTS.md](./AGENTS.md) を参照してください。
Vite+ は、Vitest を通じてインストール、タスク、フォーマット、リント、およびネイティブ CLI テストを提供しています。
NSH は、GUI 実行、テスト、バンドル、およびネイティブパッケージングを提供しています。
CLI は Node.js 26 上で `app/cli/src/main.ts` を実行し、`app/cli/src/command.ts` で宣言的 Effect 4 コマンドを使用します。
PNPM ワークスペースは、`app/*` 内のアプリケーションと、`package/*` 内の再利用可能なライブラリを分離しており、周囲のワークスペースの他のプロジェクトで使用されているロールベースのレイアウトに従っています。
`@glossshift/desktop` および `@glossshift/cli` は `workspace:*` の依存関係を通じて `@glossshift/runtime` を消費し、デスクトップも `@glossshift/nsh-platform` を消費します。
パッケージソースのエクスポートは、これらの依存関係を TypeScript パスエイリアスなしで解決します。
依存関係のバージョンは、既存のリリース時のセーフガードにより、PNPM カタログで一元管理されます。
`tsconfig.base.json` は共通の厳格なポリシーを保持し、最小限のパッケージ構成では Node または生成された NSH タイプを選択します。
`vp run typecheck` は各ワークスペースパッケージの `typecheck` スクリプトを再帰的に実行するため、新しいパッケージはルートリストにファイルを追加するのではなく、そのスクリプトを宣言することで結合されます。
各パッケージは、共通のベースの単一 `include: ["${configDir}/**/*"]` ルールを通じて完全なディレクトリをスキャンし、プロジェクトごとのファイルリストや除外は行いません。
この広範なルールが必要なのは、NSH の生成された設定が `files` を宣言しており、そうしないと暗黙的な検出が無効になり、アプリケーションソースがチェックされないためです。
新しいソースおよびテストファイルは、登録なしでプロジェクトのタイプチェックに結合されます。
`vp run check` はフォーマットとリントのみを保持します。
デスクトップの開発、実行、バンドル、およびパッケージングは `app/desktop` をターゲットにし、パブリックタスク名は変更されません。
GUI は、抽出準備が整った Effect Platform レイヤーを通じて、NSH 内部で共有の設定および翻訳ポリシーを直接実行します。
[ランタイムアーキテクチャ](./docs/runtime-architecture.md) では、これらのプロセスおよびパッケージングの境界が文書化されています。
メンテナンスされている [依存関係互換性レコード](./docs/dependency-compatibility.md) では、変更されていない NSH リリースと保持されたプリス検証パッチが文書化されています。
GlossShift はオリジナルのアプリケーションであり、フォークではありません。
[NSH Effect Platform](./package/nsh-platform/platform/README.md) は、別の NSH プロジェクトで再利用するための、アプリケーションに依存しない明示的な構成 API を備えています。

## ライセンス

アプリケーションのメタデータでは MIT を宣言していますが、このリポジトリには現在 `LICENSE` ファイルが含まれていません。
デフォルトモデルは、PLaMo Community License の下での別個のソフトウェアです。
PLaMo で構築されています。
