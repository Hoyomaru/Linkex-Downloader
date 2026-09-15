from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'target not found: {label}')
    return text.replace(old, new, 1)


def replace_regex(text, pattern, repl, label, flags=0):
    out, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'regex target not found/ambiguous ({n}): {label}')
    return out


# --- userscript version / license metadata ---
src = read('linkex-downloader.user.js')
src = replace_once(src, '// @version      1.1.0', '// @version      1.2.0', 'userscript @version')
src = replace_once(
    src,
    '// @description  Linkex共有を1ファイルずつ安全に一時コピー→ローカル保存→検証→確定IDだけ削除。再開・容量スキップ・競合防止・診断ログ付き。\n',
    '// @description  Linkex共有ページからワンクリックで安全にQueue保存。選択DL・再開・検証・所有ID限定削除・診断付き。\n// @license      MIT\n',
    'userscript description/license',
)
src = replace_once(src, "const VERSION = '1.1.0';", "const VERSION = '1.2.0';", 'runtime VERSION')
write('linkex-downloader.user.js', src)

# --- ignore generated release assets ---
gitignore = read('.gitignore').rstrip() + '\n'
for entry in ['dist/', 'linkex_downloader_v*.user.js', 'linkex_downloader_v*.zip']:
    if entry not in gitignore.splitlines():
        gitignore += entry + '\n'
write('.gitignore', gitignore)

# --- CHANGELOG: promote current Unreleased to v1.2.0 ---
changelog = read('CHANGELOG.md')
m = re.search(r'## \[Unreleased\]\n(.*?)\n## \[1\.1\.0\]', changelog, flags=re.S)
if not m:
    raise SystemExit('CHANGELOG Unreleased block not found')
body = m.group(1).strip('\n')
body = replace_once(
    body,
    '### Added\n',
    '### Added\n\n- MIT Licenseを付与し、利用・改変・再配布条件を明確化\n',
    'CHANGELOG Added',
)
body = replace_once(
    body,
    '### Changed\n',
    '### Changed\n\n- version固定 `.user.js` / `.zip` をGit管理せず、Release作成時に `tools/build_release_assets.py` で生成する配布方針へ変更\n',
    'CHANGELOG Changed',
)
replacement = f'## [Unreleased]\n\n## [1.2.0] - 2026-09-15\n\n{body}\n\n## [1.1.0]'
changelog = changelog[:m.start()] + replacement + changelog[m.end():]
write('CHANGELOG.md', changelog)

# --- README release state / install / metadata / repository layout / license ---
readme = read('README.md')
version_section = '''## Version / 配布状態

- `main` source: **v1.2.0**（release preparation / 実機確認済み）
- 最新公開安定版: **v1.1.0**
- 最新公開tag: **`v1.1.0`**
- GitHub Release: **v1.1.0 公開済み（2026-09-15）**
- v1.2.0: **公開準備中**（tag / GitHub Releaseは未作成）
- 現行CI: **GitHub Actions (`.github/workflows/ci.yml`)** — userscript構文、回帰テスト、repository整合性、Release Asset生成を検証
- License: **MIT**

最新の正式配布先は GitHub Releases です。

- https://github.com/Hoyomaru/Linkex-Downloader/releases

安定版を利用する場合は最新公開Releaseのversion固定 `.user.js` Assetを使用してください。リポジトリ直下にはversion固定配布物を置かず、`linkex-downloader.user.js` だけを最新ソースの正本として維持します。version固定 `.user.js` / `.zip` はRelease対象commitから生成し、GitHub Releaseにだけ添付します。
'''
readme = replace_regex(readme, r'## Version / 配布状態\n.*?(?=## 主な機能)', version_section + '\n', 'README version section', re.S)

install_section = '''## インストール

### GitHub Releaseから導入する場合（推奨）

1. Chrome / Edge に Tampermonkey をインストールします。
2. GitHub Releases から最新の公開安定版を開きます。v1.2.0公開前の現行安定版は **v1.1.0** です。
3. Release Assets の `linkex_downloader_vX.Y.Z.user.js` を取得します。
4. Tampermonkeyで新規スクリプトを作成し、userscript全文を貼り付けて保存します。
5. Linkexへログインした状態で `https://disk.linkex.io/` を一度開きます。
6. 共有ページ `https://l2e.click/d/...` を開き、右下にLinkex Downloaderパネルが表示されれば導入完了です。

ZIP Assetは同じuserscriptを含む補助配布物です。リポジトリ直下のversion固定コピーは今後作成しません。

v1.2.0公開前に最新mainを試す場合だけ、リポジトリ直下の `linkex-downloader.user.js` を利用してください。mainは公開安定版より先行する場合があります。
'''
readme = replace_regex(readme, r'## インストール\n.*?(?=## 更新)', install_section + '\n', 'README install section', re.S)

readme = replace_once(
    readme,
    '新Versionへ更新する場合は、Tampermonkey内のスクリプト本文を新しいversion固定 `.user.js` または `linkex-downloader.user.js` で置き換えます。\n\n安定版を利用する場合は、GitHub Releaseのversion固定 `.user.js` を優先してください。`linkex-downloader.user.js` は `main` の最新ソースです。',
    '新Versionへ更新する場合は、Tampermonkey内のスクリプト本文をGitHub Releaseの新しいversion固定 `.user.js` で置き換えます。\n\n安定版ではGitHub Release Assetを優先してください。`linkex-downloader.user.js` は `main` の最新ソースで、公開安定版より先行する場合があります。version固定配布物はリポジトリにはコミットしません。',
    'README update policy',
)

readme = replace_once(
    readme,
    '`https://disk.linkex.io/` 上では従来どおりURL入力欄が表示されます。`https://l2e.click/d/...` を貼り付けて **共有リンクを解析** を押す方式も引き続き利用できます。',
    '`https://disk.linkex.io/` 上ではURL入力欄を残しています。`https://l2e.click/d/...` を貼り付けて **すべてダウンロード** または **ファイルを選ぶ** を押すと、必要な解析を自動実行します。明示的な再解析は **詳細 → 共有を再解析** から行えます。',
    'README manual mode',
)

readme = replace_once(
    readme,
    '| **詳細** | 保存先変更、再解析、署名テスト、診断ログ、状態再表示、容量skip再試行、安全破棄を格納 |',
    '| **詳細** | 保存先変更、再解析、署名テスト、診断ログ保存、状態再表示、容量skip再試行、安全破棄、折りたたみログ表示を格納 |',
    'README UI details',
)

readme = replace_once(
    readme,
    '```text\n@match   https://disk.linkex.io/*\n@connect prod.linksvc.xyz\n```',
    '```text\n@match   https://disk.linkex.io/*\n@match   https://l2e.click/d/*\n@match   https://www.l2e.click/d/*\n@connect prod.linksvc.xyz\n@grant   GM_xmlhttpRequest\n@grant   GM_getValue\n@grant   GM_setValue\n@grant   unsafeWindow\n```',
    'README metadata block',
)

readme = replace_once(
    readme,
    '秘密情報そのものを独自設定として保存する設計ではなく、認証tokenはLinkex WebのLocal Storageから検出します。',
    '`disk.linkex.io` のLocal Storageから検出したaccess tokenだけを、Share Page Mode用にuserscript-privateなGM storageへ短時間橋渡しします。refresh tokenは保存せず、bridgeはJWT expiryまたは最大12時間の早い方で失効します。',
    'README credential storage',
)

readme = replace_once(
    readme,
    '- GitHub Releaseは現在、自動化されておらず手動公開です。\n- 自動更新機能はありません。\n- Licenseは未設定です。',
    '- GitHub Releaseの配布Assetはrelease時に生成し、version固定ファイルはリポジトリへコミットしません。\n- 自動更新機能はありません。\n- 本プロジェクトはMIT Licenseです。',
    'README limitations/license',
)

layout = '''## ファイル・ディレクトリ構成

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
'''
readme = replace_regex(readme, r'## ファイル・ディレクトリ構成\n.*?(?=## 開発者向け資料)', layout + '\n', 'README layout', re.S)

license_section = '''## License

[MIT License](LICENSE) です。

Copyright (c) 2026 Hoyomaru
'''
readme = replace_regex(readme, r'## License\n.*\Z', license_section, 'README license', re.S)
write('README.md', readme)

# --- DEVELOPMENT current state / tree / packaging / API label ---
dev = read('DEVELOPMENT.md')
state = '''## 現在の状態

2026-09-15 時点で確認した状態です。

- `main` source: **v1.2.0**（release preparation / 実機確認済み）
- 最新公開Stable: **v1.1.0**
- userscript metadata `@version`: **1.2.0**
- `const VERSION`: **1.2.0**
- 最新公開Git tag: **`v1.1.0`**
- GitHub Release: **v1.1.0 公開済み / v1.2.0 公開準備中**
- 現行 GitHub Actions: **CIあり**（userscript構文 + Node回帰テスト + repository整合性 + Release Asset生成検証）
- Runtime: Tampermonkey userscript
- Targets: `https://disk.linkex.io/*`, `https://l2e.click/d/*`, `https://www.l2e.click/d/*`
- Share Page Mode design: [`docs/SHARE_PAGE_MODE.md`](docs/SHARE_PAGE_MODE.md)
- Quick Download design: [`docs/QUICK_DOWNLOAD_UI.md`](docs/QUICK_DOWNLOAD_UI.md)
- Main API origin: `https://prod.linksvc.xyz`
- 実機確認ブラウザ: Chromium系（Chrome / Edge）
- License: **MIT**

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
      └─ v1.2.0.md
```

`linkex-downloader.user.js` が唯一のtracked userscript正本です。version固定 `.user.js` / `.zip` はGit管理せず、release対象commitから `tools/build_release_assets.py` で生成してGitHub Releaseへ添付します。過去のv1.0.0 / v1.1.0配布物は各GitHub Release Assetとして保持し、リポジトリ直下からは削除します。
'''
dev = replace_regex(dev, r'## 現在の状態\n.*?(?=## プロジェクトの目的)', state + '\n', 'DEVELOPMENT current state', re.S)
dev = dev.replace('現行v1.1.0で確認できる範囲です。', '現行main（v1.2.0 release candidate）で確認できる範囲です。')
write('DEVELOPMENT.md', dev)

# --- ARCHITECTURE zero-byte/delete guard consistency ---
arch = read('docs/ARCHITECTURE.md')
arch = replace_once(
    arch,
    '- `downloadedBytes === expectedCdnBytes > 0`\n- `verifiedAt` が存在',
    '- `download.sizeVerified === true`\n- `downloadedBytes === expectedCdnBytes >= 0`（明示検証済み0 byteを含む）\n- `verifiedAt` が存在',
    'ARCHITECTURE delete guard zero-byte',
)
write('docs/ARCHITECTURE.md', arch)

# --- SHARE_PAGE_MODE: align with Quick Download UI and release packaging ---
share = read('docs/SHARE_PAGE_MODE.md')
share = replace_once(
    share,
    '- Show a page-context summary and label the analyze action `この共有を解析`.\n- Analyze only after explicit user action; merely opening a share page does not recursively enumerate the share.\n- After analysis, reuse the existing all-files / selected-files Queue flow.',
    '- Show a page-context summary.\n- Keep analysis lazy: merely opening a share page does not recursively enumerate the share.\n- `すべてダウンロード` resolves the destination first, then analyzes the current share as needed and starts a Full Queue without an extra confirmation click.\n- `ファイルを選ぶ` analyzes as needed and only then expands the selection UI. Explicit re-analysis remains under `詳細 → 共有を再解析`.',
    'SHARE_PAGE_MODE share behavior',
)
share = replace_once(
    share,
    '- Keep `共有リンクを解析`.\n- A manually supplied `https://l2e.click/d/...` URL or bare token is accepted as before.',
    '- Keep the manual URL field. `すべてダウンロード` / `ファイルを選ぶ` analyze the supplied URL as needed; explicit re-analysis lives under `詳細`.\n- A manually supplied `https://l2e.click/d/...` URL or bare token is accepted as before.',
    'SHARE_PAGE_MODE manual behavior',
)
share = replace_regex(
    share,
    r'## UI state\n.*?(?=## Safety invariants)',
    '''## UI state

Page-context element:

- Share page: `このページの共有: <short token>` plus credential / preferred destination summary.
- Storage/manual page: share-page context is hidden and the manual URL field is shown.

Primary actions:

- `すべてダウンロード` — preferred destination permission/picker → lazy analysis → Full Queue.
- `ファイルを選ぶ` — lazy analysis → selection UI.
- `Queueを再開` / `現在ファイル後に停止` — only when Queue state requires them.

Low-frequency controls, explicit re-analysis, diagnostics, safe abandon, and verbose logs live under `詳細`. The verbose log is collapsed during normal operation and opens automatically on an error.

''',
    'SHARE_PAGE_MODE UI state',
    re.S,
)
share = replace_once(share, '8. v1.1.0 fixed release artifacts remain byte-for-byte unchanged.', '8. Release packaging changes must not alter the transaction core; version-fixed distribution files are generated from the exact release commit and are not tracked in the repository.', 'SHARE_PAGE_MODE invariant 8')
share = replace_regex(
    share,
    r'## Release scope\n.*\Z',
    '''## Release scope

Share Page Mode, Quick Download, preferred destination reuse, compact UI, and collapsed verbose logs are included in the v1.2.0 release candidate. The source of truth remains `linkex-downloader.user.js`; version-fixed `.user.js` / `.zip` files are generated only during release publication and are not committed to the repository.
''',
    'SHARE_PAGE_MODE release scope',
    re.S,
)
write('docs/SHARE_PAGE_MODE.md', share)

# --- QUICK_DOWNLOAD_UI release policy ---
quick = read('docs/QUICK_DOWNLOAD_UI.md')
quick = replace_regex(
    quick,
    r'## リリース方針\n.*\Z',
    '''## リリース方針

Quick Download / compact UI / collapsed verbose logはv1.2.0 release candidateへ含める。`linkex-downloader.user.js` を正本とし、version固定 `.user.js` / `.zip` はrelease対象commitから `tools/build_release_assets.py` で生成してGitHub Releaseにだけ添付する。リポジトリ直下へ固定配布物を蓄積しない。
''',
    'QUICK_DOWNLOAD_UI release scope',
    re.S,
)
write('docs/QUICK_DOWNLOAD_UI.md', quick)

# --- TROUBLESHOOTING current UI ---
trouble = read('docs/TROUBLESHOOTING.md')
trouble = trouble.replace('`disk.linkex.io` を開いても右下に Linkex Downloader が出ない。', '`disk.linkex.io` または対応する `l2e.click/d/...` 共有ページを開いても右下に Linkex Downloader が出ない。')
trouble = trouble.replace('- 実行対象URLが `https://disk.linkex.io/*` ではない', '- 実行対象URLが `https://disk.linkex.io/*` / `https://l2e.click/d/*` / `https://www.l2e.click/d/*` のいずれでもない')
trouble = trouble.replace('- `https://disk.linkex.io/` を再読み込みする', '- 対応ページを再読み込みする')
trouble = replace_once(
    trouble,
    '4. **この共有を解析** → Queue開始を再実行する',
    '4. **すべてダウンロード** または **ファイルを選ぶ** をもう一度実行する',
    'TROUBLESHOOTING share-page action',
)
trouble = trouble.replace('診断ログを保存し、', '必要なら **詳細 → ログを表示** を開き、診断ログを保存し、')
write('docs/TROUBLESHOOTING.md', trouble)

# --- RELEASE.md: replace outdated repo-artifact workflow with release-only generation ---
release_doc = '''# Linkex Downloader — リリース手順

この文書は、Linkex Downloader の安定版を作成・検証・公開するための手順と配布方針を記録します。

実装の正本は `main` の `linkex-downloader.user.js` です。安全条件は [`../DEVELOPMENT.md`](../DEVELOPMENT.md)、変更履歴は [`../CHANGELOG.md`](../CHANGELOG.md) を参照してください。

## 現在の状態

2026-09-15 時点:

- `main` source: **v1.2.0**（release preparation）
- 最新公開Stable: **v1.1.0**
- 最新公開tag: **`v1.1.0`**
- v1.2.0: 実機確認済み、tag / GitHub Releaseは未作成
- License: **MIT**
- CI: `.github/workflows/ci.yml`

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

- `LOCAL_COMMITTED` 前に削除しない
- Downloader自身が作成したと証明できる `destId` だけ削除
- DELETEは `select_all:false` + 単一 `file_ids:[destId]`
- COPY / DELETE結果不明時はwriteを盲目的に再送しない
- `beforeIds` に含まれるIDを削除しない
- ダウンロードIDと所有権確定IDを一致確認
- `download.sizeVerified === true`
- `downloadedBytes === expectedCdnBytes >= 0` を満たし `verifiedAt` がある場合だけdelete可能
- 削除直前identityを再確認
- lease喪失時は停止
- page URL変更で既存Queueの `shareToken` / queueRootを変更しない

### 4. 実機確認

Chromium系 + Tampermonkeyで少なくとも次を確認します。

- `disk.linkex.io` でcredential bridge準備
- `l2e.click/d/...` 共有ページでパネル表示
- 初回 `すべてダウンロード` → 保存先picker → 自動解析 → Full Queue開始
- 次の共有で保存先permissionが残っていれば1クリック開始
- 選択ダウンロード
- CDN download / Range / 403 URL更新
- ローカルsize verification
- 所有済み一時copyだけdelete
- `現在ファイル後に停止` → `Queueを再開`
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
'''
write('docs/RELEASE.md', release_doc)

# --- v1.2.0 release notes source ---
release_notes = '''# Linkex Downloader v1.2.0 — 共有ページ・Quick Download・UI整理

v1.2.0は、v1.1.0の安全な1ファイルずつのtransactionを維持したまま、通常操作を共有リンクページへ移し、全件ダウンロードをほぼ1クリック化するUXリリースです。

> [!IMPORTANT]
> 本ツールはLinkex公式とは無関係の非公式ツールです。Linkex側のWeb / API / CDN仕様変更により将来動作しなくなる可能性があります。

## 主な追加

- `https://l2e.click/d/...` 共有ページ上からURLコピーなしで直接操作する **Share Page Mode**
- `disk.linkex.io` で検出したaccess tokenだけをuserscript-privateなGM storageへ短時間橋渡しするcredential bridge
- **すべてダウンロード** 1操作で保存先準備 → 共有解析 → Full Queue開始まで進むQuick Download
- 新規Queue用のpreferred DirectoryHandleを記憶し、permissionが残っていれば別共有でも保存先pickerを省略
- 共有ページのURL変更を監視し、stale manifestを無効化しつつ実行中Queueの `shareToken` / queueRootを固定するpage-context guard
- MIT License

## UI変更

通常の初期画面は主に次の2操作へ整理しました。

- **すべてダウンロード**
- **ファイルを選ぶ**

署名テスト、再解析、保存先変更、診断ログ保存、状態再表示、容量skip再試行、安全破棄は **詳細** へ移動しました。

常時表示していた詳細ログは折りたたみ、通常時は進捗バー・進捗率・1行状態だけを表示します。エラー時は詳細ログを自動展開します。

## 認証bridge

`l2e.click` と `disk.linkex.io` は別originのため、共有ページはdisk側Local Storageを直接読めません。

v1.2.0では:

- bridgeを書き込むのは `disk.linkex.io` のみ
- 保存するのはaccess tokenのみ
- refresh tokenは保存しない
- JWT expiryまたは最大12時間の早い方で失効
- `l2e.click` 側Local Storageのtokenらしき値をLinkexアカウント認証として信用しない
- disk側ログアウトを検出したらbridgeをclear

という境界を維持します。

## 安全設計

COPY / DOWNLOAD / VERIFY / DELETEの中核条件は弱めていません。

- lease取得後に共有Queue stateを変更
- COPY / DELETE writeは応答不明時に盲目的再送しない
- ownershipを一意に証明できた `destId` だけdownload/delete対象
- `LOCAL_COMMITTED` 前にdeleteしない
- `download.sizeVerified === true` とCDN実サイズ一致を要求（明示検証済み0 byteを含む）
- DELETEは `select_all:false` + proven owned `destId` 1件だけ
- page遷移で実行中Queueの共有tokenやローカル保存先を変更しない

## 実機確認

2026-09-15にChromium系ブラウザ + Tampermonkeyで次を確認しています。

- 共有ページからの直接操作
- 初回保存先picker後の自動Full Queue開始
- 次の共有でpreferred保存先を再利用した1クリック開始
- 選択ダウンロード
- CDN download / Range / 403 URL再取得
- 安全停止 / Queue再開
- Share A → B遷移時のstale manifest防止
- コンパクト初期UI
- 詳細ログの折りたたみ / error時自動展開

## 配布方針変更

v1.2.0から、version固定 `.user.js` / `.zip` はリポジトリへcommitしません。`linkex-downloader.user.js` を唯一のtracked正本とし、Release対象commitから `tools/build_release_assets.py` で配布Assetを生成してGitHub Releaseにだけ添付します。

過去のv1.0.0 / v1.1.0 Assetは各GitHub Releaseに残します。

## インストール / 更新

公開後は `linkex_downloader_v1.2.0.user.js` を推奨Assetとします。ZIPは同じuserscriptを含む補助Assetです。

未完了Queueがある場合は、可能なら更新前に完了または安全停止してください。

## 既知の制限

- File System Access APIを使うためChromium系デスクトップブラウザを前提とします。
- Queue実行中に別端末等からLinkexへファイル追加/コピーを行うとownership判定が曖昧になり、安全側で停止することがあります。
- 共有名と完全一致する名前の最上位フォルダが共有内に存在する特殊ケースでは、ローカルpathの先頭segmentが省略される可能性があります。
- Linkex側のWeb / API / CDN仕様変更で動作しなくなる可能性があります。
- 自動更新機能はありません。

## SHA-256

Release対象commitから生成した最終AssetのSHA-256を公開時に記録し、GitHub Release APIのAsset digestと照合します。
'''
write('docs/releases/v1.2.0.md', release_notes)

# --- persistent release asset builder ---
builder = r'''#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'linkex-downloader.user.js'


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_version(text: str) -> str:
    meta = re.search(r'^// @version\s+([^\s]+)\s*$', text, flags=re.M)
    runtime = re.search(r"const VERSION = '([^']+)';", text)
    if not meta or not runtime:
        raise SystemExit('version metadata not found')
    if meta.group(1) != runtime.group(1):
        raise SystemExit(f'version mismatch: @version={meta.group(1)} VERSION={runtime.group(1)}')
    return meta.group(1)


def main() -> None:
    parser = argparse.ArgumentParser(description='Build deterministic Linkex Downloader release assets.')
    parser.add_argument('--output-dir', default='dist')
    args = parser.parse_args()

    source_bytes = SOURCE.read_bytes()
    source_text = source_bytes.decode('utf-8')
    version = parse_version(source_text)
    out_dir = Path(args.output_dir)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    user_name = f'linkex_downloader_v{version}.user.js'
    zip_name = f'linkex_downloader_v{version}.zip'
    user_path = out_dir / user_name
    zip_path = out_dir / zip_name
    user_path.write_bytes(source_bytes)

    info = zipfile.ZipInfo(user_name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    with zipfile.ZipFile(zip_path, 'w') as zf:
        zf.writestr(info, source_bytes, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    if user_path.read_bytes() != source_bytes:
        raise SystemExit('standalone userscript is not byte-identical to source')
    with zipfile.ZipFile(zip_path, 'r') as zf:
        names = zf.namelist()
        if names != [user_name]:
            raise SystemExit(f'unexpected ZIP members: {names}')
        if zf.read(user_name) != source_bytes:
            raise SystemExit('ZIP userscript is not byte-identical to source')

    for path in (user_path, zip_path):
        data = path.read_bytes()
        print(f'{path.name}\t{len(data)} bytes\tsha256:{sha256(data)}')


if __name__ == '__main__':
    main()
'''
write('tools/build_release_assets.py', builder)

# --- persistent repository consistency check ---
checker = r'''#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


source = text('linkex-downloader.user.js')
meta = re.search(r'^// @version\s+([^\s]+)\s*$', source, flags=re.M)
runtime = re.search(r"const VERSION = '([^']+)';", source)
require(meta is not None and runtime is not None, 'userscript version markers missing')
version = meta.group(1)
require(version == runtime.group(1), f'version mismatch: @version={version} VERSION={runtime.group(1)}')
require(re.search(r'^// @license\s+MIT\s*$', source, flags=re.M) is not None, '@license MIT missing')

license_text = text('LICENSE')
require(license_text.startswith('MIT License\n'), 'LICENSE is not MIT text')
require('Copyright (c) 2026 Hoyomaru' in license_text, 'LICENSE copyright holder/year mismatch')

readme = text('README.md')
dev = text('DEVELOPMENT.md')
require(f'`main` source: **v{version}**' in readme, 'README main source version is stale')
require(f'`main` source: **v{version}**' in dev, 'DEVELOPMENT main source version is stale')
require((ROOT / f'docs/releases/v{version}.md').exists(), f'docs/releases/v{version}.md missing')
require('[MIT License](LICENSE)' in readme, 'README MIT license link missing')

arch = text('docs/ARCHITECTURE.md')
require('download.sizeVerified === true' in arch, 'ARCHITECTURE missing sizeVerified delete guard')
require('downloadedBytes === expectedCdnBytes >= 0' in arch, 'ARCHITECTURE zero-byte delete guard is stale')
require('downloadedBytes === expectedCdnBytes > 0' not in arch, 'ARCHITECTURE still contains obsolete > 0 guard')

share = text('docs/SHARE_PAGE_MODE.md')
trouble = text('docs/TROUBLESHOOTING.md')
require('この共有を解析' not in share, 'SHARE_PAGE_MODE still documents removed first-screen analyze action')
require('この共有を解析' not in trouble, 'TROUBLESHOOTING still documents removed first-screen analyze action')

ignore = set(text('.gitignore').splitlines())
for entry in {'dist/', 'linkex_downloader_v*.user.js', 'linkex_downloader_v*.zip'}:
    require(entry in ignore, f'.gitignore missing {entry}')

tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
for path in tracked:
    require(not re.fullmatch(r'linkex_downloader_v\d+\.\d+\.\d+\.user\.js', path), f'versioned userscript must not be tracked: {path}')
    require(not re.fullmatch(r'linkex_downloader_v\d+\.\d+\.\d+\.zip', path), f'versioned zip must not be tracked: {path}')

print(f'repository consistency OK: v{version}')
'''
write('tools/check_repo_consistency.py', checker)

# --- CI: test packaging / consistency and release branches ---
ci = '''name: CI

on:
  push:
    branches:
      - main
      - 'fix/**'
      - 'feat/**'
      - 'release/**'
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Show runtime versions
        run: |
          node --version
          python --version
      - name: Syntax check userscript
        run: node --check linkex-downloader.user.js
      - name: Run regression tests
        run: node --test tests/*.test.js
      - name: Check repository consistency
        run: python tools/check_repo_consistency.py
      - name: Build and verify release assets
        run: python tools/build_release_assets.py --output-dir "$RUNNER_TEMP/linkex-release"
'''
write('.github/workflows/ci.yml', ci)

# Remove repository copies of historical distribution assets. Releases remain untouched.
for name in [
    'linkex_downloader_v1.0.0.user.js',
    'linkex_downloader_v1.0.0.zip',
    'linkex_downloader_v1.1.0.user.js',
    'linkex_downloader_v1.1.0.zip',
]:
    p = ROOT / name
    if p.exists():
        p.unlink()

print('v1.2.0 preparation patch applied')
