# Changelog

このプロジェクトの主な変更履歴です。

## [Unreleased]

## [1.2.0] - 2026-09-15

### Added

- MIT Licenseを付与し、利用・改変・再配布条件を明確化

- `l2e.click/d/...` 共有ページ上から現在の共有を直接解析・Queue開始できる Share Page Mode
- `disk.linkex.io` で検出したaccess tokenだけを短時間GM storageへ橋渡しし、別originの共有ページから安全に認証済みQueueを実行するcredential bridge
- 共有ページのSPA/URL変更を検知し、実行中Queueの `shareToken` は固定したまま古いmanifestだけを安全に無効化するpage-context guard
- 共有ページの「すべてダウンロード」1操作で保存先準備 → 自動解析 → Full Queue開始まで進むQuick Download
- 新規Queue用の保存先DirectoryHandleを記憶し、権限が残っている場合は次回以降の保存先選択を省略

### Changed

- version固定 `.user.js` / `.zip` をGit管理せず、Release作成時に `tools/build_release_assets.py` で生成する配布方針へ変更

- 初期UIを「すべてダウンロード」「ファイルを選ぶ」中心に整理し、診断・再試行・安全破棄等を `詳細` へ集約
- 常時表示していた詳細ログを `詳細 → ログを表示` へ折りたたみ、通常時は進捗バー＋1行状態表示だけに簡素化。エラー時はログを自動展開

## [1.1.0] - 2026-09-15

### Fixed

- Downloaderパネルをviewport内に制限し、縦に収まらない場合はパネル本文をスクロール可能に修正
- 実行中の「現在ファイル後に停止」を有効化し、停止予約を実行中Queueへ確実に反映するよう修正
- Queue stateを書き換える前にtab leaseを取得し、別tabの古いsnapshotによるstate巻き戻しを防止
- Range 416でローカル完成済みの場合も `LOCAL_COMMITTED` を永続化して復旧可能に修正
- `Content-Length` 不明と0 byteを区別し、明示的size verificationで0 byte fileを安全に完了可能に修正
- ownership確定時 `confirmedDest` をimmutable snapshotとして維持し、download前/403更新時のidentity変化を拒否
- 長いfilenameのcollision suffixがtruncateで消える問題を修正

### Added

- 未完了QueueをLinkex側へDELETEせずローカルstateだけ破棄する「Queueを安全に破棄」
- read-only GETのHTTP 429/5xx retry（COPY/DELETE等のwrite requestは従来どおり自動retry禁止）
- DONE transactionのcompact化と完了QueueのIndexedDB DirectoryHandle cleanup
- Node標準回帰テストとGitHub Actions CI
- 共有解析後の検索・チェックによる選択ファイルQueue（全ファイルQueueと併用可能）

### Documentation

- READMEを利用者向け主要ドキュメントとして拡充
- 動作環境、導入、更新、アンインストール、UI操作、保存先、復旧、永続化、API概要、安全設計、制限事項を整理
- `DEVELOPMENT.md` を開発・AI引き継ぎ向けに拡充
- `docs/ARCHITECTURE.md` を追加
- `docs/RELEASE.md` を追加
- `docs/TROUBLESHOOTING.md` を追加
- 現在のGitHub状態を再確認し、`v1.0.0` tagが存在することを確認
- 現行リポジトリにGitHub Actions / CI/CDが存在しないことを明記
- v1.0.0作成時の一時release workflowが履歴上存在し、現在は削除済みであることを記録
- v1.0.0 GitHub Releaseのタイトル・Release Notes・Asset方針を整理
- Release Assetはversion固定 `.user.js` を推奨配布物、`.zip` を補助配布物とする方針を明記
- GitHub Release `v1.0.0` の正式公開後、README / DEVELOPMENT / RELEASE手順を公開済み状態へ同期
- 公開後のAsset digest照合をリリースチェックへ追加
- standalone `.user.js` Release Assetをリポジトリ固定版とbyte-identicalなファイルへ差し替え、Release Notes記載SHA-256との一致を確認


## [1.0.0] - 2026-09-14

### Added

- 初回正式版ソース/配布物
- Linkex共有URLの解析
- 共有フォルダの再帰走査と全ファイルmanifest作成
- 1ファイルずつの安全な一時copy
- copy前後ID差分による `destId` ownership確定
- signed CDN URLからのlocal download
- Range Requestによる途中再開
- CDN URL失効時の再取得
- CDN実サイズ基準のlocal verify
- `LOCAL_COMMITTED` 後の一時copy自動delete
- DELETE前の多重safety guard
- 複数ファイルFull Queue
- ページ再読み込み後のQueue再開
- 容量不足 / 単一ファイル上限の安全なskip
- Windows向けファイル名sanitizeとpath collision回避
- 多重tab実行防止lease
- 進捗UI / 最小化
- 診断ログJSON出力と機密情報mask

### Safety

- COPY応答不明時は盲目的に再送せずreconcile
- DELETE応答不明時は盲目的に再送せずreconcile
- Downloader自身が作成したと証明できる `destId` のみdelete
- DELETEは常に `select_all:false` + 単一 `file_ids:[destId]`
- local保存検証前のdeleteを禁止
- ownershipが曖昧な場合は安全側で停止

### Distribution

- Git tag `v1.0.0`
- GitHub Release **`Linkex Downloader v1.0.0 — 初回安定版`** を2026-09-14に公開
- Release Asset: `linkex_downloader_v1.0.0.user.js`（推奨）
- Release Asset: `linkex_downloader_v1.0.0.zip`（補助）
- `linkex-downloader.user.js` は `main` の最新ソースとして維持

Release URL:

```text
https://github.com/Hoyomaru/Linkex-Downloader/releases/tag/v1.0.0
```

公開後の最終確認で、Release AssetsのSHA-256はRelease Notes記載値と一致しています。

```text
linkex_downloader_v1.0.0.user.js
928e9aabace1972f41eb97b7b185d40e1c94cfe342ee97fc6cb0880571acdde5

linkex_downloader_v1.0.0.zip
196b8500a5908a1afcae52f3fae8b239733d608ea2766ec5aa4f564e9cc30f83
```

---

## Pre-release development history

以下は v1.0.0 に至る段階的な実機検証版です。Git tag / GitHub Releaseとして公開されていない場合があります。

### v0.6.0

- 2件制限を外し、共有内の全ファイルQueueに対応
- フォルダ構造維持
- Windows path sanitize / collision回避
- 容量不足ファイルのskipと再試行
- 全件処理の実機成功を確認

### v0.5.1

- Queue Pilotのcopy reconciliation成功状態名を修正
- `reconcileCopy()` が返す `CONFIRMED` とQueue側判定を一致
- 停止済み `UNCERTAIN_NO_EVIDENCE` jobをcopy再送なしで救済できるよう修正

### v0.5.0

- 2ファイル連続Queue Pilot
- Queue再開 / crash recoveryの検証
- 安全境界での停止・再開

### v0.4.0

- `LOCAL_COMMITTED` 後の単一 `destId` deleteを追加
- delete guard / delete reconciliationを検証
- 誤削除防止の最終safety gateを実機確認

### v0.3.2

- Tampermonkey sandboxから `showSaveFilePicker()` を呼ぶ際の `Illegal invocation` を修正
- page Windowを `Reflect.apply()` のreceiverに固定
- download / size verifyの実機成功を確認

### v0.3.1

- v0.3.0で欠落していた「確定済みcopyをDL・検証」ボタンを追加
- UI初期化時の `null.addEventListener` 相当の停止を修正

### v0.3.0

- 確定済み `destId` からのsigned CDN download
- Range resume
- checkpoint
- 403 / URL refresh対応
- CDN実サイズによるlocal verify
- 自動deleteはまだ未実装

### v0.2.0

- 単一shared fileのcopy probe
- copy前後のroot ID差分から新規 `destId` を一意に確定
- ownershipが曖昧な場合は停止
- delete / downloadは未実装

### v0.1.0

- Read-only診断版
- request signing self-test
- Linkex認証情報検出
- 共有URL解析
- recursive manifest
- storage usage取得
- Linkex上のデータ変更は一切なし
