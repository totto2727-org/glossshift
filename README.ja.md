# GlossShift

GlossShift は、OpenAI 互換プロバイダー、プロンプト、認証情報、ストリーミング動作を共有する GPUI デスクトップポップアップと `gshift` コマンドを備えた macOS 用翻訳アプリケーションです。

## 使い方

インストール済みのデスクトップアプリを開きます。

```bash
open ~/.nix-profile/Applications/GlossShift.app
```

任意の macOS アプリケーションでテキストを選択して、設定済みのショートカットを押します。ポップアップは取得したテキストを **SOURCE** に表示し、結果を **TRANSLATION** へストリーミングし、どちらのペインもコピーできます。

![アクセシビリティ権限の状態、空の原文・翻訳ペイン、コピー操作を表示するGlossShiftデスクトップポップアップ](./docs/assets/glossshift-desktop.png)

パッケージ化された CLI で 1 つ以上の Markdown ファイルを翻訳します。

```bash
gshift document.md notes.mbt.md --lang ja
```

ANSI スタイルを付けずに翻訳を標準出力へ書き込みます。

```bash
gshift document.md --lang ja --stdout --color never
```

`gshift` は初回実行時に GlossShift の XDG 設定ディレクトリへ `config.toml` と `credentials.toml` を作成し、プレースホルダーの API キーが置換されるまで終了します。設定後、最初のコマンドは `document.ja.md` と `notes.ja.mbt.md` を書き込み、そのパスを標準エラー出力へ表示します。2 番目のコマンドはファイルを作成せず、プレーンな翻訳本文を標準出力へ出力します。複数の入力は常にコマンドラインの指定順に処理されます。

## 主な機能

- グローバルショートカット、サイズ変更可能なウィンドウ、原文と翻訳文のコピー操作を備えたネイティブ macOS ポップアップ。
- カスタムベース URL とリクエストパラメーターを含む、OpenAI Chat Completions API を実装するサーバー経由のストリーミング翻訳。
- デスクトップアプリケーションと `gshift` CLI で共有する XDG 設定と認証情報。
- 同階層ファイルまたは標準出力を選べる、順序を保持した複数 Markdown ファイル翻訳。
- パイプ向けのプレーンなストリーミング出力と、ターミナル向けの任意の Tree-sitter Markdown ANSI ハイライト。
- システムプロンプトとユーザードキュメントを分離し、原文を不活性な内容として扱い、その構造を翻訳契約の変更なしで一対一に翻訳。
- 新しいショートカットが古い翻訳をキャンセルして置き換える、デスクトップポップアップのリクエスト置換。

## 前提条件

- **macOS**: GlossShift は Darwin flake 出力を通じて Apple Silicon と Intel の macOS をサポートします。
- **flakes を有効にした Nix**: 現在はソースからビルドする `glossshift` と `gshift` の flake パッケージを配布しており、リリース成果物は公開していません。
- **OpenAI 互換プロバイダーの認証情報**: Chat Completions を実装するサーバーの API キー、モデル、ベース URL を用意してください。
- **デスクトップアプリのアクセシビリティ権限**: グローバルな選択テキスト取得と、そのフォールバックである `Cmd+C` シミュレーションを使用するときに付与してください。

## セットアップ

GlossShift の flake パッケージをデフォルトの Nix プロファイルへインストールします。このパッケージには `GlossShift.app` と `gshift` コマンドが含まれます。

```bash
nix profile add 'github:totto2727-org/glossshift#glossshift'
```

## 設定

GlossShift は初回利用時に `~/.config/glossshift/config.toml` と `~/.config/glossshift/credentials.toml` を作成します。`XDG_CONFIG_HOME` が設定されている場合は `$XDG_CONFIG_HOME/glossshift` を使用します。`credentials.toml` のプレースホルダー API キーを置換してください。GlossShift は常にこのファイルのモードを `0600` に戻します。

```toml
[credentials.default]
api_key = "your-api-key"
```

デフォルトが利用するプロバイダーと一致しない場合は、`config.toml` のアクティブプロバイダー、モデル、ショートカットを調整します。

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

GlossShift が Chat Completions のルートを追加するため、プロバイダーのベース URL には通常 `/v1` である API プレフィックスを含める必要があります。プロバイダー名と認証情報名は一致し、ショートカットキーは一意で、すべてのターゲット言語は空でない必要があります。

両方のファイルを保存した後、「使い方」に示したコマンドを再実行します。

## 権限

システム設定 > プライバシーとセキュリティ > アクセシビリティで、インストール済みの `GlossShift.app` にアクセスを許可します。この権限により、グローバルショートカットで選択テキストを取得し、アプリケーションが選択範囲を直接公開しない場合に `Cmd+C` シミュレーションへフォールバックできます。

## API

サポート対象のエンドユーザーインターフェースは、パッケージ化された `GlossShift.app` と `gshift` コマンドです。ソースパッケージで公開されている Rust モジュールは 2 つのバイナリ間で実装を共有するためのものであり、GlossShift は独立してサポートする Rust ライブラリ API やレジストリ参照を公開していません。

### `gshift`

```text
gshift <FILES>... --lang <LANGUAGE> [--force | --stdout [--color <MODE>]]
```

| 入力またはオプション | 意味 |
| --- | --- |
| `<FILES>...` | 1 つ以上の `.md` または `.mbt.md` ファイル。指定順に逐次翻訳します。 |
| `-l`, `--lang <LANGUAGE>` | 必須のターゲット言語コード。前後の空白を除去して小文字化され、ASCII 英数字と内部のハイフンだけを使用できます。 |
| `-f`, `--force` | 既存の同階層出力を置換します。`--stdout` とは同時に指定できません。 |
| `--stdout` | 区切りを追加せず、入力順に翻訳を標準出力へ連結します。 |
| `--color <auto|always|never>` | `--stdout` の ANSI Markdown ハイライトを制御します。デフォルトは `auto` で、`--stdout` が必要です。 |
| `-h`, `--help` | 生成されたコマンドリファレンスを表示します。 |
| `-V`, `--version` | インストールされたバージョンを表示します。 |

`--stdout` を指定しない場合、`gshift` は `.md` の前に `.<language>` を挿入し、複合拡張子 `.mbt.md` を維持し、末尾に既存の `.ja` または `.en` 言語セグメントがあれば置換します。入力または別の出力と衝突する出力パスは拒否されます。既存ファイルとシンボリックリンクは `--force` なしでは拒否されます。強制指定したシンボリックリンク出力は、リンク先を変更せずリンク自体を置換します。

`--stdout --color auto` では、リダイレクトされた出力はプレーンなままストリーミングされ、ターミナル出力は翻訳ごとにバッファリングされて ANSI ハイライトされます。`--color never` は常にプレーン出力をストリーミングし、`--color always` はリダイレクト時にも ANSI スタイルを出力します。ファイル出力に ANSI エスケープは含まれません。

設定、入力、プロバイダー、タイムアウト、出力の失敗は `gshift failed:` プレフィックス付きで標準エラーへ書き込まれ、終了ステータス `1` を返します。ヘルプとバージョンは設定を読み込まず正常終了します。

```bash
# 既存の日本語同階層出力を置換します。
gshift first.md second.md --lang ja --force

# パイプ向けにプレーンな英語出力をストリーミングします。
gshift document.md --lang en --stdout --color never
```

## 開発

リポジトリ構造、アーキテクチャ、開発コマンドについては [AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

パッケージメタデータでは MIT を宣言していますが、現在このリポジトリには `LICENSE` ファイルが含まれていません。

_This README was generated from the [share-artifact skill](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/SKILL.md) and [README template](https://raw.githubusercontent.com/totto2727-org/agent/refs/heads/main/plugins/totto2727-coding/skills/share-artifact/readme/template.md)._
