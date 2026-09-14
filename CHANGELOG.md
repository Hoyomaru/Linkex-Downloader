# Changelog

このプロジェクトの主な変更履歴です。

## [1.0.0] - 2026-09-14

### Added

- 初回正式リリース
- Linkex 共有 URL の解析
- 共有フォルダの再帰走査と全ファイル manifest 作成
- 1 ファイルずつの安全な一時コピー
- コピー前後 ID 差分による `destId` 所有権確定
- signed CDN URL からのローカルダウンロード
- Range Request による途中再開
- CDN URL 失効時の再取得
- CDN 実サイズ基準のローカル検証
- `LOCAL_COMMITTED` 後の一時コピー自動削除
- DELETE 前の多重 safety guard
- 複数ファイル Full Queue
- ページ再読み込み後の Queue 再開
- 容量不足 / 単一ファイル上限の安全なスキップ
- Windows 向けファイル名 sanitize と path collision 回避
- 多重タブ実行防止 lease
- 進捗 UI / 最小化
- 診断ログ JSON 出力と機密情報マスク

### Safety

- COPY 応答不明時は盲目的に再送せず reconcile
- DELETE 応答不明時は盲目的に再送せず reconcile
- Downloader 自身が作成したと証明できる `destId` のみ削除
- DELETE は常に `select_all:false` + 単一 `file_ids:[destId]`
- ローカル保存検証前の削除を禁止
- 所有権が曖昧な場合は安全側で停止

---

## Pre-release development history

以下は v1.0.0 に至る段階的な実機検証版です。Git tag / GitHub Release として公開されていない場合があります。

### v0.6.0

- 2 件制限を外し、共有内の全ファイル Queue に対応
- フォルダ構造維持
- Windows path sanitize / collision 回避
- 容量不足ファイルの skip と再試行
- 全件処理の実機成功を確認

### v0.5.1

- Queue Pilot の copy reconciliation 成功状態名を修正
- `reconcileCopy()` が返す `CONFIRMED` と Queue 側判定を一致させた
- 停止済み `UNCERTAIN_NO_EVIDENCE` job を copy 再送なしで救済できるよう修正

### v0.5.0

- 2 ファイル連続 Queue Pilot
- Queue 再開 / クラッシュ復旧の検証
- 安全境界での停止・再開

### v0.4.0

- `LOCAL_COMMITTED` 後の単一 `destId` delete を追加
- delete guard / delete reconciliation を検証
- 誤削除防止の最終 safety gate を実機確認

### v0.3.2

- Tampermonkey sandbox から `showSaveFilePicker()` を呼ぶ際の `Illegal invocation` を修正
- page Window を `Reflect.apply()` の receiver に固定
- ダウンロード / サイズ検証の実機成功を確認

### v0.3.1

- v0.3.0 で欠落していた「確定済みコピーをDL・検証」ボタンを追加
- UI 初期化時の `null.addEventListener` 相当の停止を修正

### v0.3.0

- 確定済み `destId` からの signed CDN download
- Range resume
- checkpoint
- 403 / URL refresh 対応
- CDN 実サイズによるローカル検証
- 自動削除はまだ未実装

### v0.2.0

- 単一 shared file の copy probe
- copy 前後の root ID 差分から新規 `destId` を一意に確定
- 所有権が曖昧な場合は停止
- delete / download は未実装

### v0.1.0

- Read-only 診断版
- request signing self-test
- Linkex 認証情報検出
- 共有 URL 解析
- recursive manifest
- storage usage 取得
- Linkex 上のデータ変更は一切なし
