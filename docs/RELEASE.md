# Linkex Downloader — リリース手順

この文書は、Linkex Downloader の新しい安定版を作成・検証・公開するための手順です。

現在動作している実装の正本は `main` の `linkex-downloader.user.js` です。安全条件の詳細は [`../DEVELOPMENT.md`](../DEVELOPMENT.md) を参照してください。

## 現在のリリース状態

2026-09-14 時点で確認できる状態:

- 現行Version: **v1.0.0**
- Git tag: **`v1.0.0` あり**
- GitHub Release: **手動公開前 / 未作成**
- 現行 GitHub Actions / CI/CD: **なし**
- `linkex-downloader.user.js`: 最新ソース
- `linkex_downloader_v1.0.0.user.js`: v1.0.0 のversion固定配布用コピー
- `linkex_downloader_v1.0.0.zip`: v1.0.0 補助配布ZIP

v1.0.0 作成時には一時的な GitHub Actions workflow が使われましたが、そのworkflowは `chore: remove one-off release workflow` で削除済みです。したがって、GitHub Releaseは現在手動で作成します。

## v1.0.0 GitHub Release の公開内容

### Release title

```text
Linkex Downloader v1.0.0 — 初回安定版
```

### Tag

```text
v1.0.0
```

既存の `v1.0.0` tagを使用します。Release作成のためにtagを作り直したり移動したりしないでください。

### Release Assets

Releaseには次の2ファイルを添付する方針です。

| Asset | 位置づけ | 推奨度 |
|---|---|---|
| `linkex_downloader_v1.0.0.user.js` | Tampermonkeyへ導入するversion固定userscript | **推奨 / 第一選択** |
| `linkex_downloader_v1.0.0.zip` | 上記userscriptを格納した補助配布物 | 任意 / 代替 |

**利用者には `.user.js` を第一選択として案内してください。** ZIPを使っても機能上の利点はなく、展開して同じuserscriptを取り出すだけです。ZIPは、`.user.js` 単体を直接保存しづらい環境、アーカイブ保管、まとめてダウンロードしたい場合の代替として残します。

### v1.0.0 Release Notes

以下をGitHub Releaseの本文として使用します。

```markdown
Linkex Downloader の初回安定版 **v1.0.0** です。

Linkex の共有リンク内にある複数ファイルを、Linkex の自分のストレージを一時作業領域として使いながら、**1ファイルずつ安全にローカルへ保存**します。

> [!IMPORTANT]
> 本ツールは Linkex 公式とは無関係の非公式ツールです。Linkex 側の Web / API / CDN 仕様変更により将来動作しなくなる可能性があります。

## 主な機能

- `https://l2e.click/d/...` 形式の共有URLを解析
- 共有フォルダを再帰走査し、全ファイルのQueueを作成
- Linkex自領域へ1ファイルずつ一時コピー
- コピー前後のID差分からコピー先 `destId` の所有権を確認
- signed CDN URLからローカルへダウンロード
- Range Requestによる途中再開
- signed URL失効時（403）のURL再取得
- CDN実サイズを基準にローカル保存を検証
- 検証完了後、自分で作成した一時コピー1件だけを削除
- ページ再読み込み後のQueue再開
- 容量不足ファイルの安全なスキップ
- Windows向けファイル名sanitize / path collision回避
- 別tabとの二重実行防止lease
- 診断ログJSON出力とToken / signed URL等のマスク

## 安全設計

Linkex上の既存ファイルを誤削除しないことを最優先にしています。

- ローカル保存が `LOCAL_COMMITTED` になるまでLinkex側を削除しない
- Downloader自身が作成したと証明できる `destId` だけ削除
- DELETEは常に `select_all:false` + 単一 `file_ids:[destId]`
- COPY応答不明時はcopy POSTを盲目的に再送せず、実状態を照合
- DELETE応答不明時もdelete POSTを盲目的に再送せず、実状態を照合
- コピー先の所有権を一意に証明できない場合は安全側で停止
- ローカル検証サイズとCDN実サイズが一致しない場合は削除しない

## インストール

**推奨:** `linkex_downloader_v1.0.0.user.js`

1. Chrome / Edge に Tampermonkey をインストールします。
2. Release Assets から `linkex_downloader_v1.0.0.user.js` をダウンロードします。
3. Tampermonkeyで新規スクリプトを作成します。
4. userscript全文を貼り付けて保存します。
5. Linkexへログインした状態で `https://disk.linkex.io/` を開きます。
6. 右下に **Linkex Downloader v1.0.0** パネルが表示されれば導入完了です。

`linkex_downloader_v1.0.0.zip` は同じuserscriptを含む補助配布物です。ZIPを使う場合は展開して `.user.js` を取り出してください。

## 動作確認済み環境

- Chromium系ブラウザ
- Chrome / Edge
- Tampermonkey
- File System Access API
- `https://disk.linkex.io/` にログインしたLinkexアカウント

Chrome / Edge以外は未確認です。

## 既知の制限

- Queue実行中に別tab・スマホ・別端末からLinkexへファイル追加/コピーを行うと、コピー先IDの所有権判定が曖昧になる可能性があります。
- 単一ファイルがLinkexの総容量を超える場合は現行方式では処理できません。
- File System Access APIが必要です。
- Linkex側のWeb / API / CDN仕様変更で動作しなくなる可能性があります。
- 自動更新機能はありません。

## SHA-256

```text
linkex_downloader_v1.0.0.user.js
928e9aabace1972f41eb97b7b185d40e1c94cfe342ee97fc6cb0880571acdde5

linkex_downloader_v1.0.0.zip
196b8500a5908a1afcae52f3fae8b239733d608ea2766ec5aa4f564e9cc30f83
```

詳細な使い方、安全設計、トラブルシューティングはリポジトリの `README.md` を参照してください。
```

## v1.0.0 の検証済みHash

履歴上の一時workflowでは次の SHA-256 を検証していました。

```text
linkex_downloader_v1.0.0.zip
196b8500a5908a1afcae52f3fae8b239733d608ea2766ec5aa4f564e9cc30f83

linkex_downloader_v1.0.0.user.js
928e9aabace1972f41eb97b7b185d40e1c94cfe342ee97fc6cb0880571acdde5
```

これは **v1.0.0 作成時の履歴として確認できる値**です。GitHub Releaseへ添付するファイルがリポジトリ直下の既存v1.0.0成果物と同一であることを確認したうえで掲載してください。将来版では必ずその版の成果物を新たにhash検証してください。

## リリース成果物の役割

| ファイル | 役割 |
|---|---|
| `linkex-downloader.user.js` | `main` 上の最新開発/安定ソース。Release Assetには通常使用しない |
| `linkex_downloader_vX.Y.Z.user.js` | 特定Versionの固定配布物。**Release Assetの第一選択** |
| `linkex_downloader_vX.Y.Z.zip` | 固定userscriptを含む補助配布ZIP |

`linkex-downloader.user.js` とversion固定userscriptは、release時点では内容を一致させてください。

## Versioning

原則:

- バグ修正のみ: patch (`1.0.x`)
- 後方互換な機能追加: minor (`1.x.0`)
- state schema / 保存形式 / 挙動 / 互換性を大きく壊す変更: major

GM storage / IndexedDB schemaを変更する場合は、version番号を上げるだけではなく既存Queueのmigration方針を先に設計してください。

## リリース前に更新するVersion

最低限、次を一致させます。

1. userscript metadata の `@version`
2. `const VERSION`
3. README の現行Version表記
4. DEVELOPMENT の現行Version表記
5. CHANGELOG の対象Version
6. version固定配布ファイル名
7. ZIP名

文字列検索で旧Versionが意図せず残っていないか確認してください。

## リリース手順

### 1. 最新mainを確認

- `README.md`
- `DEVELOPMENT.md`
- `CHANGELOG.md`
- `docs/ARCHITECTURE.md`
- `docs/RELEASE.md`
- `docs/TROUBLESHOOTING.md`
- `linkex-downloader.user.js`

を読み、コードとドキュメントが同期していることを確認します。

### 2. Versionを更新

`linkex-downloader.user.js` の次の2箇所を同じVersionへ更新します。

```javascript
// @version      X.Y.Z
```

```javascript
const VERSION = 'X.Y.Z';
```

### 3. 安全不変条件をレビュー

少なくとも次を確認します。

- `LOCAL_COMMITTED` 前に削除しない
- Downloader自身が作成したと証明できる `destId` だけ削除
- DELETE は `select_all:false` + 単一 `file_ids:[destId]`
- COPY結果不明時はPOSTを再送せずreconcile
- DELETE結果不明時はPOSTを再送せずreconcile
- `beforeIds` に含まれるIDを削除しない
- ダウンロードIDと所有権確定IDの一致を確認
- ローカル検証サイズとCDN実サイズ一致後だけ削除可能
- lease喪失時は停止

### 4. 構文・基本起動確認

userscriptが構文エラーなくTampermonkeyへ保存でき、`https://disk.linkex.io/` でパネルが表示されることを確認します。

### 5. 署名セルフテスト

UIの **署名テスト** を実行し、すべて `PASS` であることを確認します。

`runSignatureSelfTest()` の既知ベクトルが失敗する状態でreleaseしないでください。

### 6. 共有解析テスト

実際の共有リンクで以下を確認します。

- 共有URL解析
- 再帰manifest
- ファイル数
- フォルダ数
- 合計サイズ

この段階はread-onlyです。

### 7. Queue smoke test

2〜3ファイル以上を含む共有で少なくとも次を確認します。

- copy成功
- `destId` ownership確定
- signed CDN download
- local file正常オープン
- サイズ検証
- 一時コピー削除
- 次ファイルへ進行
- Queue完走

### 8. 復旧テスト

可能なら次を確認します。

- 「現在ファイル後に停止」→ `PAUSED_USER`
- 「Queueを再開」→ 続行
- ページ再読み込み後に未完了Queue検出
- DirectoryHandle permission再取得
- Range resume

### 9. 容量系テスト

可能なら以下を確認します。

- 空き容量不足 → `SKIPPED_CAPACITY`
- 単一ファイルが総容量を超える → `UNFITTABLE`
- 安全にskipした項目のみ「容量スキップを再試行」で戻せる

### 10. 診断ログ確認

**診断ログを保存** で JSON を生成し、少なくとも次が平文で含まれないことを確認します。

- JWT / Access Token
- Authorization header
- Cookie
- 共有token
- signed CDN URL
- 署名値を含む秘密情報

### 11. CHANGELOG更新

`[Unreleased]` の変更を新Versionセクションへ移し、release日を記載します。

確認できない過去履歴を推測で追加しないでください。

### 12. version固定userscriptを作成

検証済み `linkex-downloader.user.js` を次の名前で固定コピーします。

```text
linkex_downloader_vX.Y.Z.user.js
```

内容が最新ソースと一致していることをhash等で確認します。

### 13. ZIPを作成

必要に応じてversion固定userscriptを含むZIPを作成します。

```text
linkex_downloader_vX.Y.Z.zip
```

ZIPは補助Assetです。ZIP展開後のuserscriptと、リポジトリ内version固定userscriptのbyte内容が一致することを確認してください。

### 14. SHA-256を記録

例:

```powershell
Get-FileHash .\linkex_downloader_vX.Y.Z.user.js -Algorithm SHA256
Get-FileHash .\linkex_downloader_vX.Y.Z.zip -Algorithm SHA256
```

release notes にhashを掲載する場合は、実際に生成した成果物の値を使用してください。

### 15. 最終ドキュメント同期

- README
- DEVELOPMENT
- CHANGELOG
- 必要な `docs/*`

を再確認します。

特にREADMEのInstallationが現在の配布方法と一致しているか確認してください。

### 16. Commit

例:

```text
release: prepare Linkex Downloader vX.Y.Z
```

またはコードとdocsを分ける場合:

```text
feat: ...
fix: ...
docs: update documentation for vX.Y.Z
release: add vX.Y.Z artifacts
```

### 17. Tag

release対象commitへ annotated/lightweight いずれかの方針でtagを付けます。

```text
vX.Y.Z
```

既存tagを書き換えないでください。

### 18. GitHub Release

現時点では自動化されていないため、tag `vX.Y.Z` を対象にGitHub Releaseを手動作成します。

推奨asset:

1. `linkex_downloader_vX.Y.Z.user.js` — **推奨 / 第一選択**
2. `linkex_downloader_vX.Y.Z.zip` — 補助 / 任意

`linkex-downloader.user.js` は `main` の最新ソースとして維持し、通常はRelease Assetとして重複添付しません。

Release notesには最低限以下を含めます。

- 主な追加/変更/修正
- 重要な安全設計変更の有無
- 既知制限
- インストール/更新上の注意
- SHA-256（掲載する場合）

## リリース後確認

GitHub上で次を確認します。

- tagが正しいcommitを指す
- GitHub Releaseが存在する
- `.user.js` Assetがダウンロードできる
- ZIPを添付した場合はZIPもダウンロードできる
- userscriptの `@version` と `VERSION` が一致する
- ZIP内userscriptが固定配布ファイルと一致する
- READMEのVersion/導入手順が一致する
- CHANGELOGにreleaseが記録されている
- `main` のlatest sourceが意図した内容である

## 現在の注意事項

### v1.0.0 は既存tagから手動Releaseする

`v1.0.0` tagはすでに存在します。GitHub Release作成時はこの既存tagを選択し、tagを作り直したり別commitへ移動したりしないでください。

Release作成前はリポジトリ直下のversion固定userscript / ZIPが配布物です。Release公開後はGitHub Release Assetsを利用者向けの正式な配布導線とします。

### CI/CDは現在存在しない

一時的に使われた `publish-v1.0.0.yml` は削除済みです。今後release自動化を導入する場合は、特定Version専用workflowではなく、Version引数・tag・hash検証を一般化した設計を検討してください。

ただし、自動化導入のためにCOPY/DELETE等の本体ロジックを変更する必要はありません。
