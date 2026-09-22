# Linkex Downloader — リリース手順

この文書は、Linkex Downloader の安定版を作成・検証・公開するための手順と配布方針を記録します。

実装の正本は `main` の `linkex-downloader.user.js` です。安全条件は [`../DEVELOPMENT.md`](../DEVELOPMENT.md)、変更履歴は [`../CHANGELOG.md`](../CHANGELOG.md) を参照してください。

## 現在の状態

2026-09-17 時点:

- `main` source: **v1.2.1**（公開済み / 実機確認済み）
- 最新公開Stable: **v1.2.1**
- 最新公開tag: **`v1.2.1`**
- v1.2.1: GitHub Release公開済み
- Release commit: `ac698e0d3d8f6a6e6ba876cf2ea64e8cc98e1ac5`
- License: **MIT**
- CI: `.github/workflows/ci.yml`

## v1.2.1 公開実績

GitHub Release `v1.2.1` は2026-09-17に公開済みです。tagは `ac698e0d3d8f6a6e6ba876cf2ea64e8cc98e1ac5` を指します。

公開Asset:

```text
linkex_downloader_v1.2.1.user.js  115812 bytes  sha256:2aaf914f94f68972d09e02611b626567c980693abc0c8b628067db98726c58b4
linkex_downloader_v1.2.1.zip       30544 bytes  sha256:651c6e5cfa8ad74a4b49f0c06628ecfc63e846530b496ea4ca2c997aebf27e8f
```

GitHub Release APIのAsset digestと生成時SHA-256が一致することを確認済みです。standalone userscriptはrelease commitの `linkex-downloader.user.js` とbyte-identicalで、ZIPは `tools/build_release_assets.py` のdeterministic出力です。

## v1.2.0 公開実績

GitHub Release `v1.2.0` は2026-09-15に公開済みです。tagは `8bb478fbd320eaed2388427d3e03d1b91769bfc2` を指します。

公開Asset:

```text
linkex-downloader_v1.2.0.user.js  113381 bytes  sha256:6104fc053400c61eed5c90a602fe3515f1921a66519862eaa9fa6d60640e49fc
linkex_downloader_v1.2.0.zip        29796 bytes  sha256:d0d1256db911be5319313fa9e8cf0fc3fe091efa4d480332a76aa4e28c53fa25
```

ZIPは `tools/build_release_assets.py` のdeterministic出力と一致しています。standalone userscriptはrelease commitの `linkex-downloader.user.js` とbyte-identicalです。v1.2.0ではstandalone Assetのアップロード名だけがbuilder既定名（underscore）ではなくhyphen表記です。今後はbuilderが生成したAsset名をそのまま使うことを推奨します。

## 配布物ポリシー

リポジトリにはversion固定配布物を蓄積しません。

Tracked source:

```text
linkex-downloader.user.js
```

Release時にだけ生成するAsset:

```text
linkex_downloader_vX.Y.Z.user.js
linkex_downloader_vX.Y.Z.zip
```

生成先の `dist/` と上記version固定ファイル名は `.gitignore` 対象です。v1.0.0 / v1.1.0の過去配布物はGitHub Release Assetとして保持し、リポジトリ直下からは削除します。これによりVersionが増えてもmainのルートへ配布バイナリ/コピーが増えません。

## Release Asset生成

Python標準ライブラリだけを使う `tools/build_release_assets.py` を使用します。

```bash
python tools/build_release_assets.py --output-dir dist
```

このツールは次を検証します。

1. userscript metadata `@version` と `const VERSION` が一致する。
2. version固定 `.user.js` は正本とbyte-identicalである。
3. ZIP内のuserscriptも正本とbyte-identicalである。
4. ZIPは固定timestamp/属性で生成し、同じsource bytesから再現可能なAssetにする。
5. `.user.js` / `.zip` のsizeとSHA-256を表示する。

Release NotesへSHA-256を載せる場合は、**tag対象commitから生成した実Asset** の値を使用します。公開後にはGitHub Release APIが返すAsset digestとも再照合します。

## Versioning

- バグ修正のみ: patch (`1.0.x`)
- 後方互換な機能追加: minor (`1.x.0`)
- state schema / 保存形式 / 互換性を大きく壊す変更: major

GM storage / IndexedDB schemaを変更する場合は、version番号だけでなく既存Queueのmigration方針を先に設計してください。

## リリース前に一致させるもの

最低限:

1. userscript metadata `@version`
2. `const VERSION`
3. `@license MIT` とルート `LICENSE`
4. READMEのmain source Version / 公開Stable状態
5. DEVELOPMENTのmain source Version / 公開Stable状態
6. CHANGELOGの対象Version
7. `docs/releases/vX.Y.Z.md`
8. Release Asset名
9. tag `vX.Y.Z`

`python tools/check_repo_consistency.py` とCIを通し、文字列置換だけでは見落としやすい配布方針・安全ドキュメントの整合も確認します。

## リリース前チェック

### 1. コード / docs同期

確認対象:

- `linkex-downloader.user.js`
- `README.md`
- `DEVELOPMENT.md`
- `CHANGELOG.md`
- `docs/ARCHITECTURE.md`
- `docs/SHARE_PAGE_MODE.md`
- `docs/QUICK_DOWNLOAD_UI.md`
- `docs/TROUBLESHOOTING.md`
- `docs/releases/vX.Y.Z.md`

### 2. CI

必須:

```text
node --check linkex-downloader.user.js
node --test tests/*.test.js
python tools/check_repo_consistency.py
python tools/build_release_assets.py --output-dir <temporary directory>
```

### 3. 安全不変条件

少なくとも次をレビューします。

- 共有元ファイルを削除しない
- Downloader自身が新規作成したと証明できる `destId` だけ削除
- 高速モードのearly DELETEはownership・新規ID・fresh signed URL・削除直前identity確認を必須にし、signed URLを永続化しない
- 互換モードでは従来どおり `LOCAL_COMMITTED` 前に削除しない
- DELETEは `select_all:false` + 単一 `file_ids:[destId]`
- COPY / DELETE結果不明時はwriteを盲目的に再送しない
- `beforeIds` に含まれるIDを削除しない
- 高速モードはsigned URL取得元IDとownership確定IDを一致確認。互換モードはダウンロードIDとownership確定IDを一致確認
- ローカル完了時はContent-Length検証で `download.sizeVerified === true` かつ `downloadedBytes === expectedCdnBytes >= 0`
- Content-Lengthがない場合は `verificationMethod === 'stream-eof'`、`streamComplete === true`、stream実書込byte数と最終ローカルサイズ一致を満たし、いずれも `verifiedAt` がある場合だけdelete可能
- early DELETE / compatibility DELETEとも削除直前identityを再確認
- lease喪失時は停止。real page exitでは自分自身のleaseだけ解放し、別tab leaseは奪わない
- page URL変更で既存Queueの `shareToken` / queueRootを変更しない

### 4. 実機確認

Chromium系 + Tampermonkeyで少なくとも次を確認します。

- `disk.linkex.io` でcredential bridge準備
- `l2e.click/d/...` 共有ページでパネル表示
- 初回 `すべてダウンロード` → 保存先picker → 自動解析 → DL=8高速Full Queue開始
- 次の共有で保存先permissionが残っていれば1クリック開始
- 選択ダウンロード
- 最大8並列CDN download / Range / early DELETE後の新COPY・新URL復旧
- ローカルsize verification
- 所有済み一時copyだけearly deleteし、不在確認後にDOWNLOAD開始
- `現在ファイル後に停止` → `Queueを再開`
- early DELETE後にpartialを残してreload → 新contextでQueue再開 → 新COPY/new dest delete → Range resume → final verify
- 詳細ログは通常折りたたみ、error時だけ自動展開
- Share A → B遷移でstale manifestを開始しない

### 5. 診断ログ

`診断ログを保存` のJSONにJWT / Authorization / Cookie / signed URL / signature等の秘密値が平文で残っていないことを確認します。

## 公開手順

1. release対象commitのCI成功を確認する。
2. そのcommitをcheckoutして `tools/build_release_assets.py` を実行する。
3. 出力されたAsset名 / size / SHA-256を記録する。
4. release notesを最終確認する。
5. release対象commitへ `vX.Y.Z` tagを作成する。既存tagは書き換えない。
6. GitHub Releaseを作成し、version固定 `.user.js` を第一Asset、ZIPを補助Assetとして添付する。
7. Draft / Prerelease設定を確認して公開する。
8. 公開後、GitHub Release APIのAsset `digest` と生成時SHA-256を照合する。
9. README / DEVELOPMENT / RELEASEの「最新公開Stable」を新Versionへ更新する。

リポジトリへversion固定Assetをcommitする工程はありません。

## 公開後確認

- tagが意図したrelease commitを指す
- GitHub Releaseが存在しDraftではない
- `.user.js` Assetを取得できる
- ZIPを添付した場合、内部userscriptがstandalone Assetと一致する
- Asset digestが生成時SHA-256と一致する
- READMEの導入手順が最新公開Releaseを指す
- CHANGELOG / release notesが一致する
- `main` にversion固定 `.user.js` / `.zip` がtrackedされていない

## 過去Release

v1.0.0 / v1.1.0のversion固定配布物は各GitHub Releaseに残します。履歴・ロールバック用途はReleaseページを使用し、mainへ複製しません。
