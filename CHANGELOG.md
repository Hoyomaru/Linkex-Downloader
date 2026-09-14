# Changelog

このプロジェクトの主な変更履歴です。

## [Unreleased]

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

> このUnreleasedセクションはドキュメント整備のみです。`linkex-downloader.user.js` の実行ロジックおよびVersionは変更していません。

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

- `linkex-downloader.user.js` — `main` の最新ソース
- `linkex_downloader_v1.0.0.user.js` — **v1.0.0 の推奨Release Asset**
- `linkex_downloader_v1.0.0.zip` — 同じversion固定userscriptを含む補助Release Asset
- Git tag `v1.0.0`

GitHub Releaseは tag `v1.0.0` を対象に手動作成する運用です。Release Assetとしては `.user.js` を第一選択とし、`.zip` は展開して利用したい場合や保存用の代替として扱います。

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
