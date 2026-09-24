# Linkex Downloader — 開発・引き継ぎガイド

この文書は、別チャット・別セッション・別開発者でも、GitHubリポジトリだけを見て安全に開発を継続できるようにするための資料です。

**現在動作している実装の正本（Source of Truth）は `main` の `linkex-downloader.user.js` です。**

READMEは利用者向け、CHANGELOGは変更履歴、`docs/ARCHITECTURE.md` は全体構造、`docs/RELEASE.md` は公開手順、`docs/TROUBLESHOOTING.md` は問題解決を扱います。

## 現在の状態

2026-09-24 時点で確認した状態です。

- `main` source: **v1.3.1**（公開済み / 実機確認済み）
- 最新公開Stable: **v1.3.1**
- userscript metadata `@version`: **1.3.1**
- `const VERSION`: **1.3.1**
- 最新公開Git tag: **`v1.3.1`**
- GitHub Release: **v1.3.1 公開済み**
- Release commit: `2ea2dff8f83a77aafa23c6f4a47088b5d0e385d1`
- 現行 GitHub Actions: **CIあり**（userscript構文 + Node回帰テスト + repository整合性 + Release Asset生成検証）
- Runtime: Tampermonkey userscript
- Targets: `https://disk.linkex.io/*`, `https://l2e.click/d/*`, `https://www.l2e.click/d/*`
- Share Page Mode design: [`docs/SHARE_PAGE_MODE.md`](docs/SHARE_PAGE_MODE.md)
- Quick Download design: [`docs/QUICK_DOWNLOAD_UI.md`](docs/QUICK_DOWNLOAD_UI.md)
- Main API origin: `https://prod.linksvc.xyz`
- 実機確認ブラウザ: Chromium系（Chrome / Edge）
- License: **MIT**
- v1.3.1: Manifest 6並列 / Web Worker / stream-before-delete / item journalを統合。大規模共有で実機速度改善を確認。

### リポジトリ直下

```text
Linkex-Downloader/
├─ linkex-downloader.user.js
├─ LICENSE
├─ tests/linkex-downloader.test.js
├─ tools/build_release_assets.py
├─ tools/check_repo_consistency.py
├─ README.md
├─ DEVELOPMENT.md
├─ CHANGELOG.md
└─ docs/
   ├─ ARCHITECTURE.md
   ├─ QUICK_DOWNLOAD_UI.md
   ├─ SHARE_PAGE_MODE.md
   ├─ RELEASE.md
   ├─ TROUBLESHOOTING.md
   └─ releases/
      ├─ v1.1.0.md
      ├─ v1.2.0.md
      ├─ v1.2.1.md
      ├─ v1.3.0.md
      └─ v1.3.1.md
```

`linkex-downloader.user.js` が唯一のtracked userscript正本です。version固定 `.user.js` / `.zip` はGit管理せず、release対象commitから `tools/build_release_assets.py` で生成してGitHub Releaseへ添付します。過去のv1.0.0 / v1.1.0配布物は各GitHub Release Assetとして保持し、リポジトリ直下からは削除します。

## プロジェクトの目的

Linkex共有内の複数ファイルを、Linkexの自分のストレージを一時作業領域として使いながら、1ファイルずつ安全にローカルへ保存します。

```text
shared file
  -> copy to own Linkex storage
  -> prove ownership of the new destId
  -> obtain signed CDN URL in memory
  -> start the CDN stream in a Web Worker and observe the first chunk
  -> delete only the proven temporary destId while download continues
  -> verify local output with up to 8 download workers
  -> on interruption, reconcile DELETE first, then Range-resume from the same owned copy or a new owned copy
  -> next file
```

最優先事項は **既存ユーザーデータを誤削除しないこと** です。

## 絶対に壊してはいけない安全不変条件

ここは新機能追加・リファクタ・UI変更時も弱めてはいけません。

1. **共有元ファイルは削除しない。削除対象はDownloader自身が新規作成したと証明できる一時 `destId` だけ。**
2. 高速モードのearly DELETEは、ownership確定・`beforeIds` 新規性・fresh signed URL取得・CDN streamの最初のchunk確認・削除直前identity再確認がすべて成立した一時copyだけに限定する。互換モードは従来どおり `LOCAL_COMMITTED` 前DELETE禁止。
3. DELETEは常に `select_all:false` かつ `file_ids:[destId]` の **1件だけ**。
4. COPY応答が不明なとき、copy POSTを盲目的に再送しない。まず実状態を照合する。
5. DELETE応答が不明なとき、delete POSTを盲目的に再送しない。まず `destId` の存在/不在を照合する。
6. コピー前後で新規IDが複数増え、所有権を一意に証明できない場合は停止する。名前から推測して続行しない。
7. `destId` がコピー前ID集合に含まれていた場合は削除拒否。
8. ダウンロードに使用したIDと所有権確定IDが一致しない場合は削除拒否。
9. Content-Lengthが得られる場合はローカル検証済みサイズとCDN実サイズの一致を要求する。Content-Lengthが得られない場合は `verificationMethod === 'stream-eof'`、正常EOF、stream実書込byte数と最終ローカルサイズ一致を要求する。
10. 互換モードのDELETEでは`verifiedAt`を要求する。高速モードのearly DELETEでは代わりにsigned URL取得済み・stream開始済み・identity再確認済み・ownership guard済みを要求し、ローカルverifyはDOWNLOAD完了条件として別に必須。
11. 削除直前の `destId` のname / Linkex metadata sizeが所有権確定時と一致しない場合は削除拒否。
12. leaseを失った場合は処理を停止する。
13. 危険な曖昧状態は「失敗して止まる」側を選ぶ。誤削除より停止を優先する。
14. 共有ページのURL変更で既存Queueの `job.shareToken` を書き換えない。Queueは作成時の共有へ固定する。
15. `l2e.click` 側のLocal StorageをLinkexアカウント認証として信用しない。認証bridgeは `disk.linkex.io` で検出したtokenだけを書き込む。
16. credential bridgeへrefresh tokenを保存しない。access tokenもJWT expiryまたは12時間の早い方で失効させる。

**「便利だから」「復旧しやすいから」という理由で、上記ガードを外したり自動再送へ置き換えないこと。**

## アーキテクチャ概要

詳細図は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) を参照してください。

単一userscriptですが、責務は次のように分かれています。

| 領域 | 主な責務 | 主な関数/クラス |
|---|---|---|
| 署名 | MD5、header/body hash、Linkex互換sign | `md5()`, `signRequest()`, `runSignatureSelfTest()` |
| API | Linkex API要求 | `LinkexApi` |
| 認証検出/bridge | disk Local Storageからcredential候補検出、access tokenだけGM bridgeへ同期 | `discoverCredentials()`, `syncCredentialBridgeFromDisk()`, `resolveCredentials()` |
| Page context | share pageの現在token検出、URL変更時のmanifest guard | `detectSharePageTarget()`, `syncSharePageContext()` |
| 共有解析 | URL解析、再帰manifest | `parseShareToken()`, `buildManifest()` |
| Ownership | copy前後ID差分、候補検証 | `reconcileCopy()`, `isPlausibleCopy()` |
| Download | signed URL、Range、checkpoint、verify | `downloadOwnedFile()` |
| Delete | 最終guard、DELETE、reconcile | `assertDeleteGuards()`, `ensureDeleted()` |
| Queue | 直列処理、skip、pause/resume | `createQueueFromManifest()`, `processQueue()` |
| 排他 | tab lease | `acquireLease()`, `assertLease()` |
| 永続化 | GM storage / IndexedDB | `saveQueueJob()`, `idbPutHandle()` 等 |
| UI/診断 | パネル、event log、support JSON | `createPanel()`, `downloadSupportBundle()` |

## Userscript metadata / 権限

現行ヘッダー:

```text
@match   https://disk.linkex.io/*
@match   https://l2e.click/d/*
@match   https://www.l2e.click/d/*
@connect prod.linksvc.xyz
@grant   GM_xmlhttpRequest
@grant   GM_getValue
@grant   GM_setValue
@grant   unsafeWindow
@run-at  document-idle
```

CDN downloadはpage-origin `fetch()` を使うためCDN向け `@connect` は設定していません。

## 認証・署名

### Credential取得

Downloader独自のtoken設定欄はありません。

`discoverCredentials()` が `disk.linkex.io` の `localStorage` 内JSONを走査し、JWTらしい `token` / `accessToken` / `diskToken` 等を候補化して、パス名等からscoreを付けて選択します。

Share Page Modeでは `l2e.click` が別originのためdisk Local Storageを直接読めません。`syncCredentialBridgeFromDisk()` が **access tokenだけ**を `linkexCredentialBridgeV1` へ保存し、`resolveCredentials()` が共有ページ側でそれを利用します。refresh tokenはbridgeへ保存しません。bridgeはJWT expiryまたは12時間の早い方で失効し、disk側ログアウトを検出した場合はclearします。

`l2e.click` 側のLocal Storageにtokenらしき値があっても、Linkexアカウント認証には使わないでください。このorigin境界は安全条件です。

実tokenをソース・ドキュメント・Issue・診断ログへ貼らないでください。

### Request signing

認証付き/Linkex API requestはLinkex Webと同系統の署名を生成します。

主なheader:

- `X-LinkInflu-App: linkex`
- `X-LinkInflu-App-Lang`
- `X-LinkInflu-Ts`
- `X-LinkInflu-Sign`
- `Authorization: Bearer <token>`（auth endpointのみ）

`signRequest()` は `x-linkinflu-*` headerを `key=value` にして文字列sortし、MD5 hashを作ります。POST/PUT/PATCHではbody hashも署名対象です。

署名keyは `KEY_BYTES` から `deriveSigningKey()` で復元しています。秘密値をドキュメントへ展開しないでください。

### 署名セルフテスト

`runSignatureSelfTest()` には既知ベクトルが2件あります。

**署名ロジックを変更する場合、セルフテストPASSを必須条件にしてください。**

## 利用API

現行main（v1.3.1）で確認できる範囲です。

| 用途 | Method | Path | 認証 | 書込 |
|---|---|---|---|---|
| Share metadata | GET | `/api/drive/v1/share/get` | 不要 | いいえ |
| Share contents | GET | `/api/drive/v1/share/get/content` | 不要 | いいえ |
| Storage usage | GET | `/api/drive/v1/usage` | 必要 | いいえ |
| Own file list | GET | `/api/drive/v1/file/list` | 必要 | いいえ |
| Copy shared file | POST | `/api/drive/v1/file/copy` | 必要 | **はい** |
| Copy task | GET | `/api/drive/v1/task/get` | 必要 | いいえ |
| Delete own file | POST | `/api/drive/v1/file/delete` | 必要 | **はい** |

### Copy request

単一ファイルcopy:

```json
{
  "share_token": "...",
  "collection": {
    "select_all": false,
    "file_ids": ["sourceId"]
  },
  "async": true
}
```

`task_id` が返る場合は `/task/get` をpollします。

terminal failureとして実装が扱う値:

- `failed`
- `size_exceeded`
- `insufficient_storage`

### Delete request

```json
{
  "collection": {
    "select_all": false,
    "file_ids": ["confirmedDestId"]
  }
}
```

`select_all:true` はDownloaderでは使用禁止です。

## Manifest / 共有走査

`buildManifest()` が共有を再帰走査します。

- `/share/get/content`
- `page_size=100`
- paging完走
- folder recursion
- folder循環検知
- safety limit: page > 10000で停止

fileごとに主に以下を保持します。

- `sourceId`
- `name`
- `type`
- `size`
- `remotePath`
- `parentId`

Queue作成時にsource情報をcompact化し、ローカルpathも固定します。

## Copy ownership proof

### 基本原理

copy前にLinkex root file ID集合を `beforeIds` として保存し、copy後のrootとの差分を取ります。

ownership確定条件:

- 増えたIDが **1件だけ**
- candidate metadata size == source metadata size
- extension一致
- normalized stem一致
- candidate作成時刻がcopy intentより不自然に古くない

成功時のreconcile resultは `CONFIRMED`。

Queue側は互換のため `CONFIRMED` または `UNIQUE` を成功として扱いますが、現行 `reconcileCopy()` の返値は `CONFIRMED` です。

### 曖昧時

差分IDが複数なら `AMBIGUOUS` → transaction `AMBIGUOUS_COPY` → Queue `BLOCKED/PAUSED`。

**名前が似ている等の推測で1件選ばないこと。**

### 運用上の重要制限

Queue実行中に別tab・スマホ・別端末・別自動処理からLinkexへfile追加/copyを行うと、ID差分によるownership proofが曖昧になる可能性があります。

同一userscript storage内のtabはleaseで防ぎますが、別端末まで排他できません。

## Download semantics

`downloadOwnedFile()` の主要挙動:

- ownership確定済み `destId` のown file metadataからsigned URL取得
- local file sizeをoffsetにしてRange request
- 約2 MiBごとにcheckpoint
- 403時は同じ `destId` からURL再取得して再試行
- Range要求に `200 OK` が返った場合はRange無視とみなし0 byteから書き直し
- `416` ではCDN total sizeとlocal sizeを照合
- local > CDN totalなら0 byteから安全に書き直し
- network/CDN/range系はQueue層で最大3回retry

### Size verification rule

**Linkex metadata の `size` とCDN実バイト数が一致しないケースを実機確認済みです。**

用途を分離します。

- Linkex metadata size: copy candidate identity
- CDN `Content-Length` / Range由来size: local completeness

metadata sizeをlocal verify基準へ戻さないでください。

## Delete guards

`assertDeleteGuards()` が破壊操作直前の最終ゲートです。

最低条件:

- tx state == `LOCAL_COMMITTED`
- `confirmedDest.id` が存在
- `beforeIds` が存在
- `confirmedDest.id` が `beforeIds` に含まれない
- `download.destId === confirmedDest.id`
- `verificationMethod === 'content-length'` の場合は `downloadedBytes === expectedCdnBytes >= 0` かつ `download.sizeVerified === true`
- `verificationMethod === 'stream-eof'` の場合は `streamComplete === true` かつstream実書込byte数と最終ローカルサイズが一致
- `verifiedAt` が存在

その後 `ensureDeleted()` が削除直前にcurrent own fileを再取得し、`sameOwnedIdentity()` で:

- id
- name
- Linkex metadata size

をownership確定時と照合します。

DELETE後も `reconcileDelete()` で `destId` が実際に消えたことを確認してから `DONE` にします。

## 状態遷移

詳細図: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

主要transaction state:

```text
COPY_INTENT
COPY_REQUEST_SENT
NEEDS_RECONCILE
OWNERSHIP_CONFIRMED
DOWNLOAD_READY
DOWNLOADING
DOWNLOAD_PAUSED
VERIFY_FAILED
LOCAL_COMMITTED
DELETE_INTENT
DELETE_REQUEST_SENT
DELETE_UNCERTAIN
DELETE_UNCERTAIN_PRESENT
DONE
```

異常系:

```text
AMBIGUOUS_COPY
UNCERTAIN_NO_EVIDENCE
COPY_REJECTED_CAPACITY
COPY_REJECTED_SIZE
```

Queue item state:

```text
PENDING
COPYING
COPIED
DOWNLOADING
LOCAL_COMMITTED
DELETING
DONE
SKIPPED_CAPACITY
UNFITTABLE
BLOCKED
ERROR
```

Queue全体:

```text
READY
RUNNING
PAUSED
PAUSED_USER
DONE
DONE_WITH_SKIPS
```

## Queue / 非同期処理

Full Queueは **常に1ファイルずつ直列** です。

並列copy/download/deleteはしていません。

処理順:

```text
ensureCopyOwned()
  ↓
ensureDownloaded()
  ↓
ensureDeleted()
  ↓
次item
```

### 容量判定

copy前に `/usage` から:

```text
free = total_space - used_space
```

を計算します。

- `file size > total_space` → `UNFITTABLE`
- `file size > free` → `SKIPPED_CAPACITY`

server taskが `insufficient_storage` / `size_exceeded` を返した場合もそれぞれ安全skipへ変換します。

### Retry可能なskip

`resetRetryableSkips()` は `SKIPPED_CAPACITY` / `UNFITTABLE` のうち、`confirmedDest.id` がないものだけ `PENDING` へ戻します。

ownership確定済みの状態を安易に初期化しません。

## 再試行ポリシー

| エラー/状態 | 方針 |
|---|---|
| network / CDN / range系download | 最大3回retry |
| CDN 403 | URL再取得後retry |
| Range requestに200 | 0 byteから安全に書き直し |
| 416 + local == CDN total | 完成済み扱い |
| 416 + local > CDN total | truncateして0 byteから |
| COPY task `insufficient_storage` | safe skip |
| COPY task `size_exceeded` | safe skip |
| COPY request結果不明 | **POST再送せずreconcile** |
| COPY差分複数 | stop / BLOCKED |
| COPY evidenceなし | stop / BLOCKED |
| DELETE request結果不明 | **POST再送せずreconcile** |
| DELETE後もdestId存在 | stop / BLOCKED |
| lease喪失 | stop |
| delete guard不成立 | stop |

## Persistence

| 保存先 | Key / DB | 用途 | 復旧での使用 |
|---|---|---|---|
| GM storage | `linkexQueueFullV1` | Full Queue | 再読み込み後のQueue復元 |
| GM storage | `linkexQueueFullLeaseV1` | lease | tab二重実行防止 |
| GM storage | `linkexCopyProbeStateV1` | 現transaction | download checkpoint / tx sync |
| IndexedDB | `linkexDownloaderProbeV1` | File System handle | 保存先再取得 |
| GM storage | `linkexDownloaderEventLogV1` | 診断event | support JSON |
| GM storage | `linkexDownloaderUiPrefsV1` | `collapsed` 等 | UI復元 |
| GM storage | `lastShareUrl` | 最後の共有URL | UI入力復元 |

IndexedDB store名:

```text
handles
```

Queue root DirectoryHandleは `operationId = queue-full:<jobId>` で保存します。

### Schema変更時

GM / IndexedDB schemaを変更する場合は、既存ユーザーの途中Queueを壊さないmigrationを先に設計してください。

「古いkeyを消して新しく作る」は、未完了Queueや一時コピーを孤立させる可能性があるため禁止です。

## Multi-tab protection

lease実装:

- key: `linkexQueueFullLeaseV1`
- owner: random `TAB_ID`
- expiry: 約30秒
- heartbeat: 約8秒
- acquire後に短いrandom delayを入れてownerを再検証

write処理前後では `assertLease()` を通します。

別端末/別browser profileとの分散lockではありません。

## ローカルpath規則

`sanitizeSegment()` / `allocateLocalPaths()`:

- Windows禁止文字 → `_`
- control characters除去
- 末尾space/dot除去
- 空文字 → `_`
- reserved device name回避
- segment長 > 140 を短縮
- collision時はFNV-1a由来hash suffix
- 必要なら追加counter

Queue作成後の `localSegments` は固定し、resume時も同じpathを使います。

## File System Access API

Tampermonkey sandboxからWindow methodを直接呼ぶと `Illegal invocation` が発生した履歴があります。

そのため:

- `getNativePageWindow()`
- `Reflect.apply(picker, pageWindow, [...])`

を使用しています。

`showSaveFilePicker` / `showDirectoryPicker` 周辺を変更する場合、このreceiver要件を壊さないでください。

## 診断・ログ

### Event log

- key: `linkexDownloaderEventLogV1`
- 最大: 800件
- UI progressは高頻度書込を避けるためthrottle

### Support bundle

`downloadSupportBundle()` がJSONを書き出します。

内容:

- product
- version
- generatedAt
- signature self-test
- Queue state
- events

### Redaction

`redactForExport()` は以下を対象に伏せます。

- JWTらしい文字列
- token
- authorization
- cookie
- signature
- signed URL / URL key
- headers

診断機能を拡張する場合は、**便利なログ追加より秘密情報非出力を優先**してください。

## UI

現行パネルの主要操作:

- 共有リンクを解析
- 署名テスト
- 全ファイル開始
- Queueを再開
- 現在ファイル後に停止
- 容量スキップを再試行
- 診断ログを保存
- 状態を再表示
- 最小化/展開

### Pause semantics

「現在ファイル後に停止」は `stopRequested=true` を保存します。

現在itemの `COPY → DL → VERIFY → DELETE` を安全な境界まで完了した後に `PAUSED_USER` となります。

即時abortではありません。

## 実機確認済み

開発履歴上、実機で段階的に確認されたもの:

- v0.1.x: signing / auth / share parse / usage（read-only）
- v0.2.0: single file copy / destId ownership
- v0.3.x: signed CDN download / Range / local verify
- v0.4.0: `LOCAL_COMMITTED` 後のsingle destId delete
- v0.5.x: 2-file Queue pilot / recovery
- v0.6.0: all-file Queue
- v1.0.0: verified v0.6 transaction core + production UI / diagnostics

README記載の確認項目:

- 共有リンク解析
- 再帰全ファイル列挙
- copy
- ownership確定
- CDN download
- Range resume
- 403 URL refresh
- local size verify
- single-ID delete
- multi-file Queue
- page reload resume
- full traversal
- capacity skip
- diagnostics

## 過去に発生した重要バグ

### v0.3.0 — DL UI欠落

**症状**

DLボタンをUIへ追加し忘れ、初期化が `null.addEventListener` 相当で停止。

**修正**

v0.3.1でボタンを追加し、UI初期化を修正。

**再発防止**

API coreだけでなく正式UIのsmoke testを行う。

### v0.3.1 — `Illegal invocation`

**症状**

Tampermonkey sandboxから `showSaveFilePicker()` を呼ぶと失敗。

**原因**

Window methodのreceiverがuserscript側Windowになっていた。

**修正**

v0.3.2でpage Windowを `Reflect.apply()` のreceiverへ固定。

**再発防止**

File System Access API呼出しではnative page Window receiverを維持する。

### v0.5.0 — reconcile成功state不一致

**症状**

正常copyでもQueueが停止。

**原因**

`reconcileCopy()` が `CONFIRMED` を返す一方、Queue側が `UNIQUE` を待っていた。

**修正**

v0.5.1でstate判定を一致。

**現行補足**

現行Queue側は `CONFIRMED || UNIQUE` を許容します。

## 未確認事項

コード/履歴から確定できない、または現時点で実機再検証していないもの:

- Firefox等、Chrome/Edge以外のブラウザ
- macOS / LinuxでのFile System Access API実機運用
- Tampermonkey userscript削除時にGM storage / IndexedDBがどこまで自動消去されるか
- 将来Versionへのstate migration
- Linkex API仕様が2026-09-14以降も同一であること
- 長時間・非常に大量のfile Queueでの耐久性上限
- 別端末同時操作を完全に防ぐ仕組み

未確認を確認済みとしてドキュメント化しないでください。

## 既知制限

- File System Access API必須
- Queue実行中の外部Linkex変更はownership proofを曖昧化する
- leaseは別端末を排他しない
- 単一fileがLinkex総容量を超えると処理不可
- Linkex API/Web/CDN変更に依存
- 自動更新なし
- 現行CI/CDなし
- License未設定

## 現在のGitHubリリース運用

### v1.0.0 GitHub Release

2026-09-14 に `v1.0.0` tagを対象として正式公開済みです。

- Release ID: `388440272`
- Title: `Linkex Downloader v1.0.0 — 初回安定版`
- Draft: false
- Prerelease: false
- Published: `2026-09-14T13:56:48Z`
- URL: `https://github.com/Hoyomaru/Linkex-Downloader/releases/tag/v1.0.0`

Release Assets:

- `linkex_downloader_v1.0.0.user.js`
- `linkex_downloader_v1.0.0.zip`

利用者向け第一選択はversion固定 `.user.js`、ZIPは補助配布物です。

### v1.0.0 Asset hashの最終確認

GitHub Release APIで差し替え後に確認した実際のAsset digest:

```text
linkex_downloader_v1.0.0.user.js
928e9aabace1972f41eb97b7b185d40e1c94cfe342ee97fc6cb0880571acdde5

linkex_downloader_v1.0.0.zip
196b8500a5908a1afcae52f3fae8b239733d608ea2766ec5aa4f564e9cc30f83
```

standalone `.user.js` は **77,630 bytes** で、リポジトリ直下のversion固定userscriptおよびv1.0.0作成時の検証値と一致します。Release Notesに記載したSHA-256とも一致しています。

したがって、v1.0.0の公開成果物については **公開Asset / Release Notes / リポジトリ固定userscriptの整合性確認済み**です。

今後もRelease upload後にGitHub APIのAsset `digest` とRelease Notes記載値を必ず照合してください。

### 過去の一時workflow

v1.0.0では一時的に `.github/workflows/publish-v1.0.0.yml` が使われました。

履歴で確認できる処理:

- staged base64 chunkからZIP再構築
- ZIP SHA-256検証
- ZIPからuserscript抽出
- userscript SHA-256検証
- latest sourceへcopy
- release artifactsをcommit/push

そのworkflowは `chore: remove one-off release workflow` で削除済みです。

現在の詳細手順は [`docs/RELEASE.md`](docs/RELEASE.md) を参照してください。

## リリース前チェックリスト

最低限:

1. `@version` / `VERSION` 一致
2. `runSignatureSelfTest()` 全PASS
3. 共有URL解析
4. 再帰manifest件数確認
5. 2〜3file以上のQueue完走
6. local file正常オープン
7. 一時copy残存なし
8. diagnostics JSON保存
9. page reload後UI起動
10. 可能ならpause/resume
11. DELETE safety invariants review
12. README更新
13. DEVELOPMENT更新
14. CHANGELOG更新
15. docs必要箇所更新
16. version固定userscript作成
17. ZIP生成
18. SHA-256検証
19. tag
20. GitHub Release作成
21. **公開後にRelease Asset digestとRelease NotesのSHA-256を再照合**

## Versioning guidance

- Bug fix only: patch (`1.0.x`)
- Backward-compatible feature: minor (`1.x.0`)
- State schema / behavior / compatibility を大きく壊す変更: major

## 開発開始時の手順

1. `README.md`
2. `DEVELOPMENT.md`
3. `CHANGELOG.md`
4. 必要な `docs/*`
5. 最新 `linkex-downloader.user.js`

を確認します。

その後、変更対象の関数だけでなく前後のstate/persistence/safety guardも確認してください。

## 開発終了時の手順

1. codeを再確認
2. Version情報を確認
3. READMEを同期
4. DEVELOPMENTを同期
5. CHANGELOGを更新
6. 必要なdocsを更新
7. link切れ確認
8. 存在しない機能を書いていないか確認
9. 未確認事項を確認済み扱いしていないか確認
10. 秘密情報混入がないか確認

## 新しいChatGPT / AIへの引き継ぎ

次のように依頼すれば開発を再開できる状態を維持してください。

> `Hoyomaru/Linkex-Downloader` の `README.md`、`DEVELOPMENT.md`、`CHANGELOG.md`、必要な `docs/*`、最新 `linkex-downloader.user.js` を最初に確認してください。現在の仕様・安全設計・既知制限を維持したまま開発を続けてください。

特にCOPY・DELETE・復旧・Queue・署名・永続化を変更する場合は、コードを書く前に本書の安全不変条件と現行実装を照合してください。
