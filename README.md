# Linkex Downloader

Linkex の共有リンクから、共有内のファイルを **1件ずつ安全にローカルへ保存する** Tampermonkey userscript です。

Linkex の自分のストレージを一時作業領域として利用し、各ファイルごとに「一時コピー → 所有権確認 → ローカル保存 → 検証 → 一時コピー削除」を行います。

> [!IMPORTANT]
> 本ツールは **Linkex公式とは無関係の非公式ツール** です。Linkex側のWeb/API仕様変更により動作しなくなる可能性があります。

## このツールが解決する問題

Linkex の共有ファイルをローカルへ保存する際、共有から直接一括保存できず、いったん自分のストレージへ保存してからダウンロードする必要がある場合があります。

Linkex Downloader は、その作業をファイルごとに自動化します。

```text
共有ファイル
  ↓
Linkex 自領域へ一時コピー
  ↓
コピー先 ID を一意に確定
  ↓
署名付き CDN URL からローカルへダウンロード
  ↓
ローカル保存を検証
  ↓
自分で作成した一時コピー ID だけ削除
  ↓
次のファイル
```

一時コピーは1件ずつ処理するため、Linkexのストレージ容量を使い回しながら共有内の複数ファイルを順番に保存できます。

## Version / 配布状態

- `main` source: **v1.2.0**（公開済み / 実機確認済み）
- 最新公開安定版: **v1.2.0**
- 最新公開tag: **`v1.2.0`**
- GitHub Release: **v1.2.0 公開済み（2026-09-15）**
- Release commit: `8bb478fbd320eaed2388427d3e03d1b91769bfc2`
- 現行CI: **GitHub Actions (`.github/workflows/ci.yml`)** — userscript構文、回帰テスト、repository整合性、Release Asset生成を検証
- License: **MIT**

最新の正式配布先は GitHub Releases です。

- https://github.com/Hoyomaru/Linkex-Downloader/releases

安定版を利用する場合は最新公開Releaseのversion固定 `.user.js` Assetを使用してください。リポジトリ直下にはversion固定配布物を置かず、`linkex-downloader.user.js` だけを最新ソースの正本として維持します。version固定 `.user.js` / `.zip` はRelease対象commitから生成し、GitHub Releaseにだけ添付します。

## 主な機能

- `https://l2e.click/d/...` 共有ページ上からURLコピー不要で操作
- **「すべてダウンロード」1操作**で保存先準備 → 自動解析 → Full Queue開始（初回のみ保存先選択）
- 保存先DirectoryHandleを記憶し、権限が残っていれば2回目以降は保存先ダイアログも省略
- `disk.linkex.io` 上での従来の共有URL手入力解析も継続対応
- 共有フォルダの再帰走査
- 全ファイルmanifest作成
- Linkex自領域へ1件ずつ一時コピー
- コピー前後のID差分による `destId` 所有権確定
- signed CDN URLからのローカル保存
- Range Requestによる途中再開
- signed URL失効時（403）のURL再取得
- CDN実サイズ基準のローカル保存検証
- 検証済み一時コピー1件だけの自動削除
- 複数ファイルFull Queue
- 解析後のファイル検索・選択Queue（全件処理も従来どおり利用可能）
- ページ再読み込み後のQueue再開
- 容量不足ファイルの安全なskip
- Windows向けファイル名sanitize / path collision回避
- 別tabとの二重実行防止lease
- Queueの安全停止/再開
- 診断ログJSON出力
- Token / signed URL等の診断ログredaction
- 署名セルフテスト

## 実機確認状況

v1.2.0 までの開発過程で、以下が実機確認済みとして記録されています。

- 共有リンク解析
- 再帰的な全ファイル列挙
- 単一ファイルcopy
- コピー先IDの所有権確定
- CDN download
- Rangeによる再開
- 403時のdownload URL再取得
- ローカル保存サイズ検証
- 確定済み一時コピー1件だけのdelete
- 複数ファイルQueue
- ページ再読み込み後のQueue再開
- 全ファイル連続処理
- 容量不足ファイルの安全なskip
- 診断ログ出力
- 選択ファイルQueueの実行
- 実行中の安全停止 → Queue再開
- 画面高さを超える場合のパネル内部スクロール
- `l2e.click/d/...` 共有ページからの直接操作
- 初回保存先picker後の自動Full Queue開始
- preferred保存先を再利用した1クリック開始
- Share A → B遷移時のstale manifest防止
- コンパクト初期UI / 詳細ログ折りたたみ / error時自動展開

ブラウザ/Linkex側の仕様は変わり得るため、将来の動作を保証するものではありません。

## 動作環境

### 必須

- Windows等のデスクトップ環境
- Chromium系ブラウザ（実機確認: Chrome / Edge）
- Tampermonkey
- File System Access API が利用可能な環境
- Linkexアカウント
- `https://disk.linkex.io/` へのログイン
- Share Page Modeを使う場合、更新後に一度 `disk.linkex.io` を開いて認証連携を準備（access tokenのみ最大12時間のGM storage bridge。refresh tokenは保存しません）
- Linkex API / CDN へのネットワーク接続

### ブラウザについて

現行実装は `showDirectoryPicker()` 等の File System Access API を使用します。

Chrome / Edge 以外は **未確認**です。File System Access API を利用できない環境では動作しません。

### ランタイム / ビルド

Node.js / Python等の外部ランタイムは不要です。

単一のJavaScript userscriptとして実行され、通常利用時にビルドは不要です。

## インストール

### GitHub Releaseから導入する場合（推奨）

1. Chrome / Edge に Tampermonkey をインストールします。
2. GitHub Releases から最新の公開安定版 **v1.2.0** を開きます。
3. v1.2.0では Release Assets の `linkex-downloader_v1.2.0.user.js` を取得します。
4. Tampermonkeyで新規スクリプトを作成し、userscript全文を貼り付けて保存します。
5. Linkexへログインした状態で `https://disk.linkex.io/` を一度開きます。
6. 共有ページ `https://l2e.click/d/...` を開き、右下にLinkex Downloaderパネルが表示されれば導入完了です。

ZIP Asset `linkex_downloader_v1.2.0.zip` は同じuserscriptを1ファイルだけ含む補助配布物です。リポジトリ直下のversion固定コピーは今後作成しません。

`linkex-downloader.user.js` は `main` の正本です。現在はv1.2.0 Releaseと同じversionですが、今後の開発では公開安定版より先行する場合があります。

## 更新

新Versionへ更新する場合は、Tampermonkey内のスクリプト本文をGitHub Releaseの新しいversion固定 `.user.js` で置き換えます。

安定版ではGitHub Release Assetを優先してください。`linkex-downloader.user.js` は `main` の最新ソースで、公開安定版より先行する場合があります。version固定配布物はリポジトリにはコミットしません。

更新前に未完了Queueがある場合は注意してください。GM storage / IndexedDB schemaが将来変わる場合、既存Queueとの互換性が必要になります。

v1.1.0 はv1.0.0の通常Queueとの互換性をできる限り維持していますが、未完了QueueをVersion跨ぎで再開する全パターンは実機網羅していません。更新前に可能ならQueueを完了または安全停止してください。

## アンインストール

通常はTampermonkeyから Linkex Downloader userscriptを削除します。

ローカルへ保存済みのファイルは削除されません。

一方、Queue状態・診断イベント・UI設定等はTampermonkey storageやIndexedDBに保存されます。userscript削除時に各保存領域がどこまで自動削除されるかは **未検証**です。

ブラウザ側で `disk.linkex.io` のサイトデータを削除するとIndexedDB等にも影響しますが、Linkex本体のログイン状態等も消える可能性があるため注意してください。

## 基本的な使い方

### 共有ページから使う（推奨）

1. 更新後の初回だけ、Linkexへログインした状態で `https://disk.linkex.io/` を一度開きます。Downloaderがuserscript-privateなGM storageへaccess tokenを短時間連携します。
2. 保存したい `https://l2e.click/d/...` 共有リンクをブラウザでそのまま開きます。
3. 全件なら **すべてダウンロード** を押します。初回だけ保存先フォルダを選択します。
4. Downloaderが共有を自動解析し、そのままFull Queueを開始します。追加の解析/開始確認クリックはありません。
5. 2回目以降は保存先権限が残っていれば、**すべてダウンロード** 1回だけで開始できます。

一部ファイルだけ欲しい場合は **ファイルを選ぶ** を押し、検索/チェック後に **選択をダウンロード** を押します。

診断、署名テスト、保存先変更、容量skip再試行、安全破棄など低頻度操作は **詳細** にまとめています。

### 自ストレージページから使う（従来互換）

`https://disk.linkex.io/` 上ではURL入力欄を残しています。`https://l2e.click/d/...` を貼り付けて **すべてダウンロード** または **ファイルを選ぶ** を押すと、必要な解析を自動実行します。明示的な再解析は **詳細 → 共有を再解析** から行えます。

保存先には次のようなジョブ専用フォルダが作成されます。

```text
Linkex_<共有名>_<日時>_<job-id末尾>/
```

その中に共有側のフォルダ構造を再現します。

## UIボタン

通常時に表へ出す主操作は少数に絞っています。

| ボタン | 用途 |
|---|---|
| **すべてダウンロード** | 現在の共有を必要なら自動解析し、保存先準備後にFull Queueをそのまま開始 |
| **ファイルを選ぶ** | 共有を解析してファイル選択UIを展開 |
| **選択をダウンロード** | チェック済みファイルだけでQueue開始 |
| **Queueを再開** | 保存済み未完了Queueを実状態照合から再開（未完了時のみ表示） |
| **現在ファイル後に停止** | 現在ファイルの安全な処理境界後に停止予約（実行中のみ表示） |
| **詳細** | 保存先変更、再解析、署名テスト、診断ログ保存、状態再表示、容量skip再試行、安全破棄、折りたたみログ表示を格納 |
| **− / +** | パネルを最小化/展開 |

## 停止について

**現在ファイル後に停止** は即時強制停止ではありません。

現在処理中の1ファイルについて、安全に完了可能な `COPY → DL → VERIFY → DELETE` の境界まで処理してから `PAUSED_USER` になります。

その後 **Queueを再開** で続行できます。

## 保存先・ファイル名

Windowsで問題になりやすい文字・予約名を回避します。

- `< > : " / \\ | ? *` 等を `_` に変換
- control characterを除去
- 末尾スペース/ピリオドを除去
- `CON`, `PRN`, `AUX`, `NUL`, `COM1`〜`COM9`, `LPT1`〜`LPT9` 等を回避
- 長すぎるpath segmentを短縮
- sanitize後に同一pathになる場合はhash suffixで一意化

Queue作成時に保存pathを確定し、再開途中で名前を変えない設計です。

## Safety design

このツールでは、Linkex 上の既存ファイルを誤削除しないことを最優先にしています。

### 絶対に維持する安全条件

- ローカル保存が `LOCAL_COMMITTED` になるまでLinkex側を削除しない
- Downloader自身が作成したと証明できる `destId` だけ削除する
- DELETEは常に `select_all:false` かつ確定済み `file_ids:[destId]` の1件だけ
- COPY応答不明時はcopy POSTを盲目的に再送しない
- DELETE応答不明時はdelete POSTを盲目的に再送しない
- コピー前から存在したIDは削除しない
- ダウンロードしたIDと所有権確定IDが一致しない場合は削除しない
- ローカル検証サイズとCDN実サイズが一致しない場合は削除しない
- 所有権が曖昧な場合は自動処理を停止する
- leaseを失った場合は処理を停止する

## COPY所有権の確定

コピー前に自分のLinkexルートに存在するfile ID集合を保存し、コピー後に再取得して差分を見ます。

原則として、次の条件を満たす場合だけ一時コピーを自分のものと確定します。

- コピー後に増えたIDが1件だけ
- metadata sizeがsourceと一致
- 拡張子とnormalized filename stemが一致
- 作成時刻がcopy intentより不自然に古くない

複数IDが増えた場合は、名前だけで対象を推測せず安全停止します。

## ダウンロードと再開

- signed CDN URLを所有権確定済み `destId` から取得
- 既存ローカルファイルサイズを使ってRange resume
- 約2 MiBごとにcheckpoint
- 403時は同じ `destId` からURLを再取得
- Range要求に200が返った場合は0 byteから安全に書き直し
- network/CDN/range系の一時エラーは最大3回再試行

### サイズ検証

Linkex metadataの `size` とCDNの実バイト数が一致しないケースが実機確認されています。

そのため:

- Linkex metadata size → コピー候補のidentity確認
- CDNの `Content-Length` / `Content-Range` 由来サイズ → ローカル完全性確認

として用途を分けています。

## 容量不足時

### `SKIPPED_CAPACITY`

現在のLinkex空き容量が対象ファイルより小さい場合、安全にskipして次のファイルへ進みます。

容量を空けた後、Queue完了画面から **容量スキップを再試行** → **Queueを再開** で再試行できます。

### `UNFITTABLE`

単一ファイルサイズがLinkexの総容量を超える場合、現行方式では一時コピーできないため処理できません。

Linkex側が `size_exceeded` を返した場合も同様に扱います。

## 再開・復旧

Queue状態は永続化されます。

- ページ再読み込み後: 未完了Queueを検出して再開可能
- Download中断: 既存ローカルサイズからRange再開
- COPY結果不明: copyを再送する前にLinkex実状態をreconcile
- DELETE結果不明: deleteを再送せずLinkex実状態をreconcile
- 危険な曖昧状態: `PAUSED` / `BLOCKED` で停止

保存先DirectoryHandleもIndexedDBへ保存します。ただしブラウザ再起動等でpermission再確認が必要になる場合があります。

## データと状態

主な保存先:

| 保存先 | キー/DB | 用途 |
|---|---|---|
| Tampermonkey GM storage | `linkexQueueFullV1` | Full Queue状態 |
| GM storage | `linkexQueueFullLeaseV1` | 多重実行防止lease |
| GM storage | `linkexCopyProbeStateV1` | transaction/probe状態 |
| IndexedDB | `linkexDownloaderProbeV1` | File System Access API handle |
| GM storage | `linkexDownloaderEventLogV1` | 診断イベント（最大800件） |
| GM storage | `linkexDownloaderUiPrefsV1` | UI最小化状態 |
| GM storage | `lastShareUrl` | 最後に入力した共有URL |

`disk.linkex.io` のLocal Storageから検出したaccess tokenだけを、Share Page Mode用にuserscript-privateなGM storageへ短時間橋渡しします。refresh tokenは保存せず、bridgeはJWT expiryまたは最大12時間の早い方で失効します。

## 認証・外部通信

主なAPI origin:

```text
https://prod.linksvc.xyz
```

userscript metadata:

```text
@match   https://disk.linkex.io/*
@match   https://l2e.click/d/*
@match   https://www.l2e.click/d/*
@connect prod.linksvc.xyz
@grant   GM_xmlhttpRequest
@grant   GM_getValue
@grant   GM_setValue
@grant   unsafeWindow
```

認証付きAPIでは Linkex Web と同系統の署名方式を再現し、`Authorization: Bearer ...` を使用します。

TokenそのものをREADMEや診断ログへ記録しないでください。

## 利用API概要

| 用途 | Method | Path | 認証 |
|---|---|---|---|
| 共有メタデータ | GET | `/api/drive/v1/share/get` | 不要 |
| 共有内容 | GET | `/api/drive/v1/share/get/content` | 不要 |
| 容量取得 | GET | `/api/drive/v1/usage` | 必要 |
| 自分のファイル一覧 | GET | `/api/drive/v1/file/list` | 必要 |
| 共有ファイルcopy | POST | `/api/drive/v1/file/copy` | 必要 |
| copy task状態 | GET | `/api/drive/v1/task/get` | 必要 |
| 自分のファイルdelete | POST | `/api/drive/v1/file/delete` | 必要 |

詳細は [`DEVELOPMENT.md`](DEVELOPMENT.md) を参照してください。

## 診断

UIの **診断ログを保存** から次のようなJSONを書き出せます。

- product/version
- 生成時刻
- 署名セルフテスト結果
- Queue状態
- event log

出力時に JWT / token / Authorization / Cookie / signature / signed URL 等をマスクします。

問題報告時は、秘密情報が残っていないか確認してから共有してください。

## 制限事項・注意事項

- Queue実行中は、別tab・スマホ・別端末からLinkexへファイル追加/コピーをしないでください。ID差分によるownership proofが曖昧になる可能性があります。
- 多重実行防止leaseは同一userscript storage上のtabを対象とし、別端末まで排他できるものではありません。
- 単一ファイル自体がLinkex総容量を超える場合は処理できません。
- File System Access APIが必要です。
- Firefox等は未確認です。
- Linkex API / Web / CDN仕様変更で動作しなくなる可能性があります。
- GitHub Releaseの配布Assetはrelease時に生成し、version固定ファイルはリポジトリへコミットしません。
- 自動更新機能はありません。
- 本プロジェクトはMIT Licenseです。

## トラブルシューティング

代表例:

### ログイン情報を検出できない

`disk.linkex.io` へログインしてページを再読み込みしてください。改善しない場合はLinkex Web側のLocal Storage構造変更の可能性があります。

### 別tabで動作中と表示される

同時実行防止leaseが有効です。別tabの処理を終了させてから再開してください。

### コピー先IDを一意に確定できない

Queue実行中にLinkex側へ別のファイル追加が発生していないか確認してください。名前だけで対象を推測して手動削除しないでください。

### サイズ検証失敗

`LOCAL_COMMITTED` にはならないため、一時コピーは削除されません。ネットワーク/保存先を確認してQueue再開を試してください。

詳細は [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) を参照してください。

## ファイル・ディレクトリ構成

```text
Linkex-Downloader/
├─ linkex-downloader.user.js            # 現在の正本・最新userscript
├─ LICENSE                              # MIT License
├─ README.md                            # 利用者向け主要資料
├─ DEVELOPMENT.md                       # 開発・安全設計・引き継ぎ
├─ CHANGELOG.md                         # Version履歴
├─ tools/
│  ├─ build_release_assets.py           # Release用 .user.js / .zip 生成・hash検証
│  └─ check_repo_consistency.py         # Version / docs / packaging整合性検査
├─ tests/linkex-downloader.test.js
└─ docs/
   ├─ ARCHITECTURE.md
   ├─ QUICK_DOWNLOAD_UI.md
   ├─ SHARE_PAGE_MODE.md
   ├─ RELEASE.md
   ├─ TROUBLESHOOTING.md
   └─ releases/
```

version固定 `linkex_downloader_vX.Y.Z.user.js` / `.zip` はGit管理しません。必要時に `tools/build_release_assets.py` で `dist/` へ生成し、GitHub Release Assetとして公開します。過去版は各GitHub Releaseから取得できます。

## 開発者向け資料

開発開始時は次を確認してください。

- [`DEVELOPMENT.md`](DEVELOPMENT.md) — API、安全不変条件、復旧、主要実装、検証履歴
- [`CHANGELOG.md`](CHANGELOG.md) — Version履歴
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 全体構造と状態遷移
- [`docs/RELEASE.md`](docs/RELEASE.md) — リリース工程
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — 詳細トラブル対応
- [`linkex-downloader.user.js`](linkex-downloader.user.js) — 現在動いている実装の正本

別チャットや別AIで開発を継続する場合も、まず上記を読んでから現在の安全条件を維持したまま変更してください。

## License

[MIT License](LICENSE) です。

Copyright (c) 2026 Hoyomaru
