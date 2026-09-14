# Linkex Downloader — リリース手順

この文書は、Linkex Downloader の安定版を作成・検証・公開するための手順と、現在の公開状態を記録します。

現在動作している実装の正本は `main` の `linkex-downloader.user.js` です。安全条件の詳細は [`../DEVELOPMENT.md`](../DEVELOPMENT.md) を参照してください。

## 現在のリリース状態

2026-09-14 時点:

- 現行Version: **v1.0.0**
- Git tag: **`v1.0.0`**
- GitHub Release: **公開済み**
- Release title: **Linkex Downloader v1.0.0 — 初回安定版**
- Draft: **false**
- Prerelease: **false**
- Published: **2026-09-14T13:56:48Z**
- Release URL: `https://github.com/Hoyomaru/Linkex-Downloader/releases/tag/v1.0.0`
- 現行 GitHub Actions / CI/CD: **なし**

v1.0.0 作成時には一時的な GitHub Actions workflow が使われましたが、そのworkflowは `chore: remove one-off release workflow` で削除済みです。現在のrelease工程は手動です。

## v1.0.0 Release Assets

GitHub Releaseには次の2ファイルが公開されています。

| Asset | 位置づけ | 推奨度 |
|---|---|---|
| `linkex_downloader_v1.0.0.user.js` | Tampermonkeyへ導入するversion固定userscript | **推奨 / 第一選択** |
| `linkex_downloader_v1.0.0.zip` | version固定userscriptを含む補助配布物 | 任意 / 代替 |

利用者には `.user.js` を第一選択として案内します。ZIPはアーカイブ保管や `.user.js` 単体を直接保存しづらい場合の代替です。

`linkex-downloader.user.js` は `main` 上の最新ソースであり、通常はRelease Assetとして重複添付しません。

## v1.0.0 公開AssetのSHA-256

GitHub Release APIで公開後に再確認した最終digestは次のとおりです。

```text
linkex_downloader_v1.0.0.user.js
928e9aabace1972f41eb97b7b185d40e1c94cfe342ee97fc6cb0880571acdde5

linkex_downloader_v1.0.0.zip
196b8500a5908a1afcae52f3fae8b239733d608ea2766ec5aa4f564e9cc30f83
```

standalone `.user.js` はリポジトリ直下の `linkex_downloader_v1.0.0.user.js` と同じ **77,630 bytes** で、v1.0.0作成時の検証値およびRelease Notes記載値と一致しています。ZIPも検証値と一致しています。

つまり現在のv1.0.0は、**Release Notes / 公開 `.user.js` / 公開ZIPのSHA-256が整合した状態**です。

今後も **Release公開後にGitHub APIのAsset `digest` とRelease Notes記載値を再照合する**ことを必須工程にします。

## リリース成果物の役割

| ファイル | 役割 |
|---|---|
| `linkex-downloader.user.js` | `main` 上の最新開発/安定ソース。Release Assetには通常使用しない |
| `linkex_downloader_vX.Y.Z.user.js` | 特定Versionの固定配布物。**Release Assetの第一選択** |
| `linkex_downloader_vX.Y.Z.zip` | 固定userscriptを含む補助配布ZIP |

release時点では、最新ソース・version固定userscript・ZIP内userscriptの内容を意図どおり一致させてください。byte-level hashを公開する場合は改行コードを含めて同一であることを確認します。

## Versioning

原則:

- バグ修正のみ: patch (`1.0.x`)
- 後方互換な機能追加: minor (`1.x.0`)
- state schema / 保存形式 / 挙動 / 互換性を大きく壊す変更: major

GM storage / IndexedDB schemaを変更する場合は、version番号を上げるだけではなく既存Queueのmigration方針を先に設計してください。

## リリース前に一致させるVersion

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

最新ソースとversion固定userscriptの内容が一致することをhash等で確認します。

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

**注意:** Editor等で開いて保存するとLF/CRLF変換だけでもSHA-256が変わります。Releaseへアップロードするファイルは、検証したbyte列そのものを使用してください。

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

Release Notesには最低限以下を含めます。

- 主な追加/変更/修正
- 重要な安全設計変更の有無
- 既知制限
- インストール/更新上の注意
- SHA-256（掲載する場合）

### 19. 公開後Asset検証

Release公開後、GitHub Release API / UIで次を確認します。

- ReleaseがDraftではない
- Prerelease設定が意図どおり
- Tagが正しい
- Asset名が正しい
- Asset sizeが意図どおり
- GitHubが返すAsset digestと手元のSHA-256が一致
- Release Notesにhashを掲載した場合、その値とも一致

**公開前hashだけを信用して工程完了としないでください。**

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
- **公開Asset digestとRelease NotesのSHAが一致する**

## CI/CD

現在、継続的なGitHub Actions / CI/CDはありません。

v1.0.0作成時に一時的に使われた `publish-v1.0.0.yml` は削除済みです。今後release自動化を導入する場合は、特定Version専用workflowではなく、Version引数・tag・hash検証を一般化した設計を検討してください。

ただし、自動化導入のためにCOPY/DELETE等の本体ロジックを変更する必要はありません。
