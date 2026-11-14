# GlossShift

GlossShift は、Apple Silicon Mac 上でテキストをローカルに翻訳します。
デスクトップのポップアップおよびターミナル UI では、NSH、TypeScript、Effect が使用されます。
`gshift` バッチコマンドは、同じローカルモデルと翻訳サービスを使用します。

## 使用方法

インストール済みのデスクトップアプリケーションを起動します。

```bash
open ~/.nix-profile/Applications/GlossShift.app
```

別のアプリケーションでテキストを選択し、設定済みのショートカットを押します。
GlossShift はソースを表示し、翻訳を 2 つ目のペインにストリーミングします。
copy は常に、Markdown 構文を含む元のテキストを使用します。
**Plain** トグルにより、両方のペインを Markdown プレビューとプレーンテキストで切り替えます。
コードブロックには構文ハイライトがなく、リンクは開かず、画像は代替テキストを表示し、HTML はリテラルのままです。
デスクトップ選択のキャプチャには macOS Accessibility 権限が必要です。
ヘルパーは、GlossShift がポップアップを有効にする前に、フォーカスされているアプリケーションの Accessibility 選択を読み取ります。
この API を通じて選択されたテキストを公開しないアプリケーションは、エラーを報告します。
GlossShift は `Cmd+C` をシミュレートしたり、クリップボードの内容を置き換えて選択をキャプチャしたりしません。

インタラクティブなターミナル UI を実行します。

```bash
gshift
# 明示的なインタラクティブモード:
gshift --tui
```

テキストとターゲット言語を入力し、**Translate** を選択します。
ターミナル UI はデスクトップのホットキーやトレイサービスを起動せず、Accessibility 権限も必要としません。
デスクトップモードとターミナルモードはどちらも NSH の公式プリビルドホストを使用し、カスタムの Rust アプリケーションコードをコンパイルしません。
デスクトップ選択のキャプチャは、別の Swift ヘルパーで実行されます。
**Quit** または `Ctrl+C` で終了します。

指定された順序で Markdown ファイルを翻訳します。

```bash
gshift document.md notes.mbt.md --lang ja
# 兄弟ファイルを作成せずにプレーン出力をストリーミングする:
gshift document.md --lang en --stdout --color never
```

ファイルモードは `document.ja.md` と `notes.ja.mbt.md` を書き込み、パスを stderr に報告します。
プレーン stdout は、区切り文字を挿入せずに翻訳を連結します。
最初の翻訳は、公式の PLaMo 3 Translate 0.8B Q4_K_M GGUF（約 573 MB）を自動的にダウンロードします。
後続の実行では、再ダウンロードせずに検証済みのキャッシュモデルを使用します。
ホスト型モデルのアカウントや API キーは不要です。
テキストは Mac で処理され、ホスト型の推論サービスには送信されません。

> [!IMPORTANT]
> デフォルトモデルは [PLaMo Community License](https://plamo.preferredai.jp/info/plamo-community-license-en) を使用し、アプリケーションの MIT メタデータライセンスは使用しません。
> 商用利用には、事前の登録と当該ライセンスに基づく資格が必要です。
> 使用前に利用規約を確認してください。
> GlossShift はユーザーを登録せず、またユーザーに代わって商用規約を受け入れることもありません。

## 機能

- グローバルショートカットと公式 NSH ターミナル UI を備えたネイティブ macOS ポップアップ。
- ピン留めされた公式 llama サーバーと本物の Effect AI `LanguageModel` アダプターによるローカル Metal 推論。
- モデルの自動ダウンロード、ピン留めされたデフォルトリビジョン、SHA-256 検証、およびオフラインキャッシュの再利用。
- より大規模な GGUF モデルの設定、および明示的なコンテキストと出力制限。
- デスクトップ、ターミナル、バッチモードにわたる共有翻訳、キャンセル、および Markdown/プレーンの動作。
- 入力/出力の衝突チェックと安全なシンボリックリンク置換を伴う、順序付き Markdown ファイル処理。
- TypeScript アプリケーション、翻訳、設定、および自動起動ポリシー（小さな別個の Swift Accessibility ヘルパー付き）。

## 前提条件

- Apple Silicon macOS。
- flakes を有効にした Nix。
- 最初のモデルダウンロード用のネットワークアクセスとディスク容量。
- 選択したモデルとコンテキストに十分な空きメモリ。
- デスクトップ選択キャプチャにのみ Accessibility 権限。

Nix パッケージには、Node、Metal ライブラリを含む公式 `llama-server` b12110 実行ファイル、および Swift ヘルパーが含まれています。
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
オプション設定は `~/.config/glossshift/local.json` または `$XDG_CONFIG_HOME/glossshift/local.json` にあります。
`GLOSSSHIFT_CONFIG` を絶対ファイルパスに設定すると、別のローカル設定を選択できます。
明示的に選択されたファイルが存在する必要があります。

```json
{
  "sourceLanguage": "auto",
  "contextSize": 8192,
  "maxTokens": 4096
}
```

`sourceLanguage` はデフォルトで自動検出されます。
`contextSize` には入力、プロンプト、および生成された翻訳が含まれます。
`maxTokens` は生成されるトークンを制限し、コンテキストよりも小さくする必要があります。
PLaMo の設定は、モデルの 32768 トークンのコンテキストを超えることはできません。
サイズが大きすぎるソースや不完全な出力は、正常な切り捨てファイルを生成せずに失敗します。
設定された制限が不足している場合は、小さなセクションを翻訳します。

デフォルトのキャッシュは `~/.cache/glossshift/models` または `$XDG_CACHE_HOME/glossshift/models` です。
`cacheDirectory` を絶対ディレクトリに設定して上書きします。
ダウンロードされたファイルは SHA-256 ダイジェスト付きで命名され、ロード前に検証されます。

代わりに公式の 2B Q4_K_M モデルを使用するには、このモデル設定を追加します。

```json
{
  "model": {
    "uri": "https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/resolve/4f672106b847200bfdc0f6af6c321cd94eba1aed/plamo-3-translate-2b-Q4_K_M.gguf",
    "sha256": "1ffd9073afcc70e35ccc942428aa2b73d7aa2b9ea779bf504b775369e0276c13",
    "prompt": "plamo"
  }
}
```

このモデルのダウンロードは約 1.81 GB で、0.8B よりも多くのメモリを必要とします。
PLaMo 3 翻訳モデルには `prompt: "plamo"` を使用してください。
別の単一ファイル GGUF を使用する場合、メタデータに有効なチャットテンプレートが提供されている場合のみ `prompt: "chat"` を使用してください。
カスタムモデルには HTTPS または `file:` URI と完全な SHA-256 ダイジェストが必要です。
マルチパート GGUF はサポートされていません。
ダウンロード URL はホスト型の推論エンドポイントではなく、モデルの重みを選択します。
設定変更後はアプリケーションを再起動してください。

[公式のデフォルトアーティファクト](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/tree/1cf96ae02133958a20074bfdfab76517bb737d00) とそのダイジェストは `node/config.ts` にピン留めされています。

### デスクトップ設定

ウィンドウおよびショートカットの設定は `~/.config/glossshift/config.toml` にあり、`XDG_CONFIG_HOME` に準拠しています。

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
プロバイダーの認証情報および古いプロバイダー設定はローカル翻訳に使用されません。
ソース言語とモデル設定には `local.json` を使用してください。

## コマンドリファレンス

```text
gshift
gshift --tui
gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]
```

| オプション                    | 動作                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `<FILES>...`              | `.md` と `.mbt.md` の入力を順に処理します。                                          |
| `-l`, `--lang <LANGUAGE>` | ターゲット言語（`ja` や `en` など）を選択します。                                     |
| `-f`, `--force`           | 既存の兄弟出力を置き換えますが、入力ファイルは置き換えません。`--stdout` と競合します。 |
| `--stdout`                | ファイルを書き出さずに翻訳を stdout に連結します。                             |
| `--color <MODE>`          | 全出力の ANSI スタイリングを `auto`, `always`, `never` に設定します。`--stdout` が必要です。   |
| `-h`, `--help`            | モデルや設定をロードせずにヘルプを表示します。                                   |
| `-V`, `--version`         | モデルや設定をロードせずにバージョンを表示します。                            |

ファイル名は `.md` または `.mbt.md` の前に言語サフィックスが付きます。
既存の末尾の `.ja` または `.en` サフィックスは置き換えられます。
入力/出力の衝突、重複出力、および未承認のオーバーライトはモデルのロード前に失敗します。
`--force` を使用すると、ターゲットを変更せずにシンボリックリンク出力が置き換えられます。
ファイル出力およびリダイレクトされた自動色 stdout には ANSI スタイリングは含まれません。
色はターミナルのスタイリングのみを追加し、Markdown 構文ハイライトは追加しません。
プレーン stdout はデルタをストリーミングするため、推論の失敗によりパイプラインに一部のテキストが残ることがあります。
ファイルモードは完成した翻訳のみを書き込みます。
診断出力は stderr となり、失敗した場合は非ゼロの終了ステータスになります。

## 開発

リポジトリの構造、アーキテクチャ、ツールチェーンのセットアップ、および検証コマンドについては [AGENTS.md](./AGENTS.md) を参照してください。
Vite+ がインストール、タスク、フォーマット、およびリントを担当します。
NSH がアプリケーションタイプのチェック、実行、テスト、バンドル、およびネイティブパッケージングを担当します。
Node 翻訳プロセスは TypeScript を直接実行し、バッチ CLI とサービスを共有します。
[ランタイムアーキテクチャ](./docs/runtime-architecture.md) では、プロセスの所有権と個別の Accessibility ヘルパーについて説明しています。
メンテナンスされている [アップストリーム差分レコード](./docs/upstream-differences.md) では、変更されていない NSH リリースと保持された plist 検証パッチについて記述されています。

## ライセンス

アプリケーションのメタデータでは MIT を宣言していますが、このリポジトリには現在 `LICENSE` ファイルが含まれていません。
デフォルトモデルは PLaMo Community License の下での別個のソフトウェアです。
Built with PLaMo.
