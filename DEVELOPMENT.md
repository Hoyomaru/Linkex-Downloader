# Linkex Downloader — Development Guide

このファイルは、別チャット・別セッションでも GitHub だけを見て開発を継続できるようにするための引き継ぎ資料です。

**現在の正本 (Source of Truth) は `main` の `linkex-downloader.user.js` です。**
README は利用者向け、CHANGELOG は変更履歴、このファイルは設計・安全条件・開発手順を扱います。

## Current release

- Stable: **v1.0.0**
- Runtime: Tampermonkey userscript
- Target: `https://disk.linkex.io/*`
- Main API origin: `https://prod.linksvc.xyz`
- Tested on Chromium 系ブラウザ (Chrome / Edge)

## What the downloader does

共有 URL を再帰解析し、各ファイルを 1 件ずつ次のトランザクションで処理します。

```text
shared file
  -> copy to own Linkex storage
  -> prove ownership of the new destId
  -> download from signed CDN URL
  -> verify local download
  -> delete only the proven temporary destId
  -> next file
```

Linkex の無料ストレージを一時作業領域として使い回す設計です。

## Non-negotiable safety invariants

ここは新機能追加時も崩してはいけません。

1. **ローカル保存が `LOCAL_COMMITTED` になるまで Linkex 側を削除しない。**
2. **Downloader 自身が作成したと証明できる `destId` だけ削除する。**
3. DELETE は常に `select_all:false` かつ `file_ids:[destId]` の **1 件だけ**。
4. COPY の応答が不明なとき、copy POST を盲目的に再送しない。まず実状態を照合する。
5. DELETE の応答が不明なとき、delete POST を盲目的に再送しない。まず `destId` の存在/不在を照合する。
6. コピー前後で新規 ID が複数増え、所有権を一意に証明できない場合は停止する。名前から推測して続行しない。
7. `destId` がコピー前 ID 集合に含まれていた場合は削除拒否。
8. ダウンロードに使用した ID と所有権確定 ID が一致しない場合は削除拒否。
9. ローカルの検証済みサイズと CDN 実サイズが一致しない場合は削除拒否。
10. 危険な曖昧状態は「失敗して止まる」ほうを選ぶ。誤削除より停止を優先する。

## Known Linkex API surface

現行 v1.0.0 が使用している範囲です。

| Purpose | Method | Path | Auth |
|---|---|---|---|
| Share metadata | GET | `/api/drive/v1/share/get` | No |
| Share contents | GET | `/api/drive/v1/share/get/content` | No |
| Storage usage | GET | `/api/drive/v1/usage` | Yes |
| Own file list | GET | `/api/drive/v1/file/list` | Yes |
| Copy shared file | POST | `/api/drive/v1/file/copy` | Yes |
| Copy task status | GET | `/api/drive/v1/task/get` | Yes |
| Delete own file | POST | `/api/drive/v1/file/delete` | Yes |

### Copy request

単一ファイルコピーは次の形です。

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

`task_id` が返る場合は `/task/get` をポーリングします。公式実装で確認済みの terminal failure として `failed`, `size_exceeded`, `insufficient_storage` を扱います。

### Delete request

```json
{
  "collection": {
    "select_all": false,
    "file_ids": ["confirmedDestId"]
  }
}
```

一括削除 (`select_all:true`) は Downloader では使用禁止です。

## Request signing and authentication

認証付き API は Linkex Web と同じ署名方式を再現しています。

使用ヘッダー:

- `X-LinkInflu-App: linkex`
- `X-LinkInflu-App-Lang`
- `X-LinkInflu-Ts`
- `X-LinkInflu-Sign`
- `Authorization: Bearer <token>` (認証 endpoint のみ)

署名器は `signRequest()` に集約しています。MD5 を使用し、`x-linkinflu-*` ヘッダーを `key=value` 形式で文字列ソートして header hash を作ります。POST/PUT/PATCH は body hash も含めます。

**署名ロジックを変更するときは必ず `runSignatureSelfTest()` を通すこと。** v1.0.0 には HAR 由来の既知ベクトルが入っています。

ログイン token は Downloader 独自保存せず、Linkex ページの Local Storage から検出します。診断ログ出力では JWT・token・署名付き URL などをマスクします。

## Manifest / share traversal

`buildManifest()` が共有フォルダを再帰走査します。

- `/share/get/content`
- `page_size=100`
- ページング完走
- フォルダ再帰
- 循環検知
- `sourceId`, `name`, `size`, `remotePath`, `parentId` を保持

Queue 開始時に manifest から immutable に近い source 情報を作成します。

## Copy ownership proof

コピー前に Linkex ルートの ID 集合を記録し、コピー後に差分を取ります。

所有権を確定してよいのは、原則として次の条件を満たす場合だけです。

- コピー後に増えた ID が **1 件だけ**
- その候補の Linkex metadata size が source metadata size と一致
- 拡張子と normalized stem が一致
- 作成時刻が copy intent より不自然に古くない

成功状態は `CONFIRMED`。

差分が複数なら `AMBIGUOUS` として停止します。

### Important operational limitation

Queue 実行中に別タブ・スマホ・別端末から Linkex へファイル追加/コピーをすると、ID 差分による所有権証明が曖昧になる可能性があります。

そのため **Queue 実行中は外部から Linkex を変更しない**ことを前提にしています。

## Download semantics

- signed CDN URL は own file list の対象 `destId` から取得
- Range Request による途中再開
- 約 2 MiB ごとに checkpoint
- 403 等で URL が失効した場合は Linkex 側から最新 URL を取り直して再試行
- Range を要求したのに CDN が `200 OK` を返した場合は Range 無視と判断し、0 byte から安全に書き直す
- `416` はローカルサイズとの照合対象
- network/CDN/range 系の一時エラーは最大 3 回の再試行

### Size verification rule

**Linkex metadata の `size` と CDN の実バイト数が一致しないケースを実機で確認済みです。**

そのため最終的なローカル完全性判定は Linkex metadata size ではなく、CDN の `Content-Length` / `Content-Range` から得た実サイズを基準にします。

Linkex metadata size はコピー候補の identity 照合にのみ使います。

## Delete guards

`assertDeleteGuards()` が破壊操作直前の最終ゲートです。

最低条件:

- tx state が `LOCAL_COMMITTED`
- `confirmedDest.id` が存在
- `confirmedDest.id` がコピー前 ID 集合に存在しない
- `download.destId === confirmedDest.id`
- `downloadedBytes === expectedCdnBytes > 0`
- `verifiedAt` が存在
- 削除直前に現在の `destId` の name / metadata size が所有権確定時と一致

DELETE 応答後も `destId` が実際に消えたことを確認してから `DONE` にします。

## Queue state / recovery

主な file transaction states:

```text
PENDING
COPY_INTENT
COPYING / COPY_REQUEST_SENT
COPIED
DOWNLOADING / DOWNLOAD_PAUSED
LOCAL_COMMITTED
DELETE_INTENT / DELETE_REQUEST_SENT / DELETE_UNCERTAIN
DONE
```

Queue item 側には `SKIPPED_CAPACITY`, `UNFITTABLE`, `BLOCKED` 等もあります。

Queue 全体は `READY`, `RUNNING`, `PAUSED`, `PAUSED_USER`, `DONE`, `DONE_WITH_SKIPS` 等を取ります。

### Recovery policy

- COPY 不明: copy 再送前に reconcile
- DELETE 不明: delete を再送せず reconcile
- Download: File System Access API の既存ファイルと checkpoint から Range 再開
- 危険な状態: Queue を `PAUSED` / item を `BLOCKED` にして停止
- 容量不足 / 単一ファイル上限: 安全に判定できるケースのみ skip して次へ

## Persistence

現行の主要 storage:

- `linkexQueueFullV1` — Full Queue state
- `linkexQueueFullLeaseV1` — 多重起動防止 lease
- `linkexCopyProbeStateV1` — transaction / probe state
- `linkexDownloaderProbeV1` (IndexedDB) — File System Access API handle
- `linkexDownloaderEventLogV1` — 診断イベント
- `linkexDownloaderUiPrefsV1` — UI 設定
- `lastShareUrl` — 最後の共有 URL

Queue の directory/file handle は IndexedDB に保存し、GM storage 側には JSON state を保存します。

## Multi-tab protection

Queue は lease + tab ID を利用して多重実行を防ぎます。

新機能で非同期処理を追加するときも、Linkex の write 操作前後では lease が有効か確認してください。

## Local path rules

Windows を考慮して次を処理します。

- `< > : " / \\ | ? *` 等を `_` に変換
- control characters を除去
- 末尾スペース/ピリオドを除去
- `CON`, `PRN`, `AUX`, `NUL`, `COM1`...`LPT9` 等を回避
- 長すぎる segment を短縮
- sanitize 後に同一 path になった場合は source ID / path 由来 hash suffix で一意化

Queue 作成時に local path を確定し、途中で名前を変えない設計です。

## Verified development history

実機で段階的に確認しました。

- v0.1.x: 署名・認証・共有解析・容量取得 (read-only)
- v0.2.0: 単一ファイル copy と destId 所有権確定
- v0.3.x: signed CDN download / Range / ローカル検証
- v0.4.0: `LOCAL_COMMITTED` 後の安全な単一 ID delete
- v0.5.x: 2 ファイル Queue pilot / recovery
- v0.6.0: 全ファイル Queue
- v1.0.0: verified v0.6 transaction core を維持し、正式 UI / diagnostics を追加

過去の重要バグ:

1. v0.3.0 — DL ボタンを UI に追加し忘れ、初期化が `null.addEventListener` で停止。v0.3.1 で修正。
2. v0.3.1 — Tampermonkey sandbox から `showSaveFilePicker` を呼び `Illegal invocation`。ページ本体 Window を receiver にして v0.3.2 で修正。
3. v0.5.0 — `reconcileCopy()` の成功値 `CONFIRMED` に対し Queue 側が `UNIQUE` を待っていたため誤停止。v0.5.1 で修正。

これらは「API core が正しくても UI / glue code で回帰する」例なので、正式版更新時は smoke test を行ってください。

## Release / test checklist

新バージョンを stable とする前に最低限確認すること:

1. `runSignatureSelfTest()` が全 PASS
2. 共有 URL 解析成功
3. 再帰 manifest が期待件数になる
4. 2〜3 ファイル以上の Queue が完走
5. ローカルファイルが正常に開ける
6. 一時コピーが Linkex に残っていない
7. 診断ログ JSON を保存できる
8. ページ再読み込み後に UI が正常起動
9. 可能なら途中停止 → Queue 再開も確認
10. DELETE safety invariants を変更していないことをレビュー

## Versioning guidance

- Bug fix only: patch (`1.0.x`)
- Backward-compatible feature: minor (`1.x.0`)
- State schema / behavior / compatibility を大きく壊す変更: major

GM / IndexedDB の schema を変える場合は、既存ユーザーの途中 Queue を壊さない migration を先に設計してください。

## How to continue in a new ChatGPT chat

新しいチャットでは次のように依頼すれば十分です。

> `Hoyomaru/Linkex-Downloader` の `README.md`、`DEVELOPMENT.md`、`CHANGELOG.md`、最新 `linkex-downloader.user.js` を読んで、現在の安全設計を維持したまま開発を続けてください。

その後、追加したい機能を説明してください。

**特に削除・コピー・復旧ロジックを変更する場合は、コードを書く前に DEVELOPMENT.md の safety invariants と現行実装を照合すること。**
