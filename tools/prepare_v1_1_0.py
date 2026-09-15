from __future__ import annotations

from pathlib import Path
import hashlib
import re
import shutil
import zipfile

VERSION = "1.1.0"
DATE = "2026-09-15"
SOURCE = Path("linkex-downloader.user.js")
FIXED = Path(f"linkex_downloader_v{VERSION}.user.js")
ZIP = Path(f"linkex_downloader_v{VERSION}.zip")
NOTES = Path(f"docs/releases/v{VERSION}.md")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


def replace_regex_once(text: str, pattern: str, repl: str, label: str) -> str:
    out, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, got {count}")
    return out


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# 1) Bump the tested main userscript version only. Runtime logic is intentionally unchanged.
source = SOURCE.read_text(encoding="utf-8")
source = replace_once(source, "// @version      1.0.0", f"// @version      {VERSION}", "metadata version")
source = replace_once(source, "const VERSION = '1.0.0';", f"const VERSION = '{VERSION}';", "runtime version")
SOURCE.write_text(source, encoding="utf-8", newline="\n")

# 2) Fixed userscript must be byte-identical to the release source.
shutil.copyfile(SOURCE, FIXED)
if SOURCE.read_bytes() != FIXED.read_bytes():
    raise SystemExit("fixed userscript is not byte-identical to source")

# 3) Create a deterministic ZIP containing only the fixed userscript.
info = zipfile.ZipInfo(FIXED.name, (2026, 9, 15, 0, 0, 0))
info.compress_type = zipfile.ZIP_DEFLATED
info.create_system = 3
info.external_attr = (0o644 & 0xFFFF) << 16
with zipfile.ZipFile(ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    zf.writestr(info, FIXED.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(ZIP, "r") as zf:
    names = zf.namelist()
    if names != [FIXED.name]:
        raise SystemExit(f"unexpected ZIP members: {names}")
    if zf.read(FIXED.name) != FIXED.read_bytes():
        raise SystemExit("ZIP userscript is not byte-identical to fixed userscript")

user_sha = sha256(FIXED)
zip_sha = sha256(ZIP)
user_size = FIXED.stat().st_size
zip_size = ZIP.stat().st_size

# 4) Move Unreleased changes into v1.1.0.
changelog_path = Path("CHANGELOG.md")
changelog = changelog_path.read_text(encoding="utf-8")
changelog = replace_once(
    changelog,
    "## [Unreleased]\n",
    f"## [Unreleased]\n\n次回リリース向けの変更はここへ追記します。\n\n## [{VERSION}] - {DATE}\n",
    "CHANGELOG release heading",
)
changelog = re.sub(
    r"\n> このUnreleasedセクションにはv1\.0\.0以降の未リリース変更を記録しています。正式リリースまでは `linkex-downloader\.user\.js` のVersionは1\.0\.0のままです。\n",
    "\n",
    changelog,
    count=1,
)
changelog_path.write_text(changelog, encoding="utf-8", newline="\n")

# 5) Update README current distribution/install sections while preserving v1.0.0 history.
readme_path = Path("README.md")
readme = readme_path.read_text(encoding="utf-8")
version_block = f"""## Version / 配布状態

- 現行Version: **v{VERSION}**
- Git tag: **`v{VERSION}`**
- GitHub Release: **v{VERSION} 公開済み（{DATE}）**
- Release title: **Linkex Downloader v{VERSION} — 選択Queue・安全性強化**
- 現行CI: **GitHub Actions (`.github/workflows/ci.yml`)** — userscript構文チェックと回帰テスト

正式配布先:

- https://github.com/Hoyomaru/Linkex-Downloader/releases/tag/v{VERSION}

Release Assets:

- `{FIXED.name}` — **推奨。v{VERSION} 固定userscript**
- `{ZIP.name}` — 同じuserscriptを含む補助配布ZIP

リポジトリ直下の `linkex-downloader.user.js` は最新ソースです。Release Assetとしてはversion固定 `.user.js` を第一選択とし、ZIPは保存・展開用の代替として扱います。
"""
readme = replace_regex_once(readme, r"## Version / 配布状態\n.*?(?=\n## 主な機能)", version_block.rstrip(), "README version block")
install_block = f"""## インストール

### GitHub Releaseから導入する場合（推奨）

1. Chrome / Edge に Tampermonkey をインストールします。
2. GitHub Releases の **v{VERSION}** を開きます。
3. Release Assets から **`{FIXED.name}`** をダウンロードします。
4. Tampermonkeyで新規スクリプトを作成します。
5. 新規スクリプトの内容をすべて削除し、userscript全文を貼り付けて保存します。
6. Linkexへログインした状態で `https://disk.linkex.io/` を開きます。
7. 右下に **Linkex Downloader v{VERSION}** パネルが表示されれば導入完了です。

`{ZIP.name}` は同じuserscriptを含む補助配布物です。ZIPを使用する場合は展開し、`{FIXED.name}` を取り出して同じ手順で導入してください。

Release Assetsを利用できない場合は、リポジトリ直下のversion固定 `{FIXED.name}` も利用できます。
"""
readme = replace_regex_once(readme, r"## インストール\n.*?(?=\n## 更新)", install_block.rstrip(), "README install block")
readme = readme.replace("v1.0.0 までの開発過程で", f"v{VERSION} までの開発過程で", 1)
old_migration = "現行v1.0.0では、同じv1.0.0内での置き換えを除き、将来Versionへのmigrationは **未確認**です。"
new_migration = f"v{VERSION} はv1.0.0の通常Queueとの互換性をできる限り維持していますが、未完了QueueをVersion跨ぎで再開する全パターンは実機網羅していません。更新前に可能ならQueueを完了または安全停止してください。"
if old_migration in readme:
    readme = readme.replace(old_migration, new_migration, 1)
if "- 診断ログ出力\n" in readme and "- 選択ファイルQueueの実行\n" not in readme:
    readme = readme.replace(
        "- 診断ログ出力\n",
        "- 診断ログ出力\n- 選択ファイルQueueの実行\n- 実行中の安全停止 → Queue再開\n- 画面高さを超える場合のパネル内部スクロール\n",
        1,
    )
readme_path.write_text(readme, encoding="utf-8", newline="\n")

# 6) Update developer handoff state and zero-byte verification documentation.
dev_path = Path("DEVELOPMENT.md")
dev = dev_path.read_text(encoding="utf-8")
state_block = f"""## 現在の状態

{DATE} 時点で確認した状態です。

- Stable: **v{VERSION}**
- userscript metadata `@version`: **{VERSION}**
- `const VERSION`: **{VERSION}**
- Git tag: **`v{VERSION}`**
- GitHub Release: **v{VERSION} 公開済み**
- Release title: **Linkex Downloader v{VERSION} — 選択Queue・安全性強化**
- Release URL: `https://github.com/Hoyomaru/Linkex-Downloader/releases/tag/v{VERSION}`
- 現行 GitHub Actions: **CIあり**（userscript構文チェック + Node標準回帰テスト）
- Runtime: Tampermonkey userscript
- Target: `https://disk.linkex.io/*`
- Main API origin: `https://prod.linksvc.xyz`
- 実機確認ブラウザ: Chromium系（Chrome / Edge）
- License: **未設定**
"""
dev = replace_regex_once(dev, r"## 現在の状態\n.*?(?=\n### リポジトリ直下)", state_block.rstrip(), "DEVELOPMENT state block")
old_tree = """```text
Linkex-Downloader/
├─ linkex-downloader.user.js
├─ linkex_downloader_v1.0.0.user.js
├─ linkex_downloader_v1.0.0.zip
├─ README.md
├─ DEVELOPMENT.md
├─ CHANGELOG.md
└─ docs/
   ├─ ARCHITECTURE.md
   ├─ RELEASE.md
   └─ TROUBLESHOOTING.md
```"""
new_tree = f"""```text
Linkex-Downloader/
├─ linkex-downloader.user.js
├─ {FIXED.name}
├─ {ZIP.name}
├─ linkex_downloader_v1.0.0.user.js
├─ linkex_downloader_v1.0.0.zip
├─ tests/linkex-downloader.test.js
├─ README.md
├─ DEVELOPMENT.md
├─ CHANGELOG.md
└─ docs/
   ├─ ARCHITECTURE.md
   ├─ RELEASE.md
   ├─ TROUBLESHOOTING.md
   └─ releases/v{VERSION}.md
```"""
if old_tree in dev:
    dev = dev.replace(old_tree, new_tree, 1)
old_blob_note = "`linkex-downloader.user.js` とリポジトリ直下の `linkex_downloader_v1.0.0.user.js` は現在同じGit blob内容です。前者を最新ソース、後者をv1.0.0固定配布物として扱います。"
new_blob_note = f"`linkex-downloader.user.js` とリポジトリ直下の `{FIXED.name}` はv{VERSION} release時点でbyte-identicalです。v1.0.0固定配布物は過去Releaseの再現用として変更せず保持します。"
if old_blob_note in dev:
    dev = dev.replace(old_blob_note, new_blob_note, 1)
dev = dev.replace("現行v1.0.0", f"現行v{VERSION}")
dev = dev.replace(
    "- `downloadedBytes === expectedCdnBytes > 0`\n- `verifiedAt` が存在",
    "- `downloadedBytes === expectedCdnBytes >= 0`\n- 新規transactionでは `download.sizeVerified === true`\n- `verifiedAt` が存在",
    1,
)
dev_path.write_text(dev, encoding="utf-8", newline="\n")

# 7) Release notes become the source used by the publish workflow.
NOTES.parent.mkdir(parents=True, exist_ok=True)
notes = f"""# Linkex Downloader v{VERSION} — 選択Queue・安全性強化

Linkex Downloader **v{VERSION}** です。v1.0.0の安全な1ファイルずつの処理を維持しつつ、選択ファイルQueue、復旧性、検証、UIを強化しました。

> [!IMPORTANT]
> 本ツールはLinkex公式とは無関係の非公式ツールです。Linkex側のWeb / API / CDN仕様変更により将来動作しなくなる可能性があります。

## 主な追加

- 共有解析後にファイルを検索・チェックして **選択したファイルだけQueue実行**
- 全件選択 / 全解除 / 表示中を選択 / 表示中を解除
- 未完了Queueのローカル状態だけを消す **Queueを安全に破棄**
- read-only GETのHTTP 429 / 5xx retry（COPY / DELETE等のwriteは自動retryしません）
- GitHub Actions CIとNode標準回帰テスト

## 主な修正・安全性強化

- Queue state更新前にtab leaseを取得し、古いsnapshotによる巻き戻しを防止
- Range 416でローカル完成済みの場合も `LOCAL_COMMITTED` を永続化
- `Content-Length` 不明と0 byteを区別し、0 byte fileを明示検証して安全に完了
- ownership確定時の `confirmedDest` をimmutable snapshotとして維持し、download前/URL再取得時にidentity再確認
- 長いfilenameのcollision suffixがtruncateで消えないよう修正
- DONE transactionをcompact化し、完了QueueのDirectoryHandleをcleanup
- Downloaderパネルをviewport内へ収め、必要時は本文を内部スクロール
- 実行中の **現在ファイル後に停止** を正しく有効化し、停止予約を処理中Queueへ確実に反映

## 安全設計

v1.1.0でも次の原則は維持・強化しています。

- `LOCAL_COMMITTED` 前にLinkex側を削除しない
- Downloader自身が作成したと証明できる `destId` だけ削除
- DELETEは `select_all:false` + 単一 `file_ids:[destId]`
- COPY / DELETEの応答不明時はwriteを盲目的に再送しない
- ownership / identity / local size検証が曖昧なら安全側で停止

## 実機確認

2026-09-15にChromium系ブラウザ + Tampermonkeyで、共有解析、Queue処理、選択ファイル処理、UI表示、安全停止/再開を確認しています。GitHub Actionsの構文チェック・回帰テストもPASSしています。

## インストール / 更新

**推奨:** `{FIXED.name}`

Tampermonkeyの既存Linkex Downloaderを更新する場合は、スクリプト本文をこのv{VERSION}固定 `.user.js` の内容へ置き換えて保存してください。未完了Queueがある場合は、可能なら更新前に完了または安全停止してから更新してください。

`{ZIP.name}` は同じuserscriptを含む補助配布物です。

## 既知の制限

- File System Access APIを使用するため、Chrome / Edge等のChromium系デスクトップブラウザを前提とします。
- Queue実行中に別端末等からLinkexへファイル追加/コピーを行うとownership判定が曖昧になり、安全側で停止することがあります。
- 共有名と完全一致する名前の最上位フォルダが共有内に存在する特殊ケースでは、ローカルpathの先頭segmentが省略される可能性があります。
- Linkex側のWeb / API / CDN仕様変更で動作しなくなる可能性があります。
- 自動更新機能はありません。

## SHA-256

```text
{FIXED.name}
{user_sha}

{ZIP.name}
{zip_sha}
```

詳細な使い方・安全設計・トラブルシューティングはリポジトリの `README.md` を参照してください。
"""
NOTES.write_text(notes, encoding="utf-8", newline="\n")

# 8) Update release documentation with current release and immutable artifact hashes.
release_path = Path("docs/RELEASE.md")
release = release_path.read_text(encoding="utf-8")
current_block = f"""## 現在のリリース状態

{DATE} 時点:

- 現行Version: **v{VERSION}**
- Git tag: **`v{VERSION}`**
- GitHub Release: **公開済み**
- Release title: **Linkex Downloader v{VERSION} — 選択Queue・安全性強化**
- Draft: **false**
- Prerelease: **false**
- Release URL: `https://github.com/Hoyomaru/Linkex-Downloader/releases/tag/v{VERSION}`
- 現行 GitHub Actions: **CIあり**（`.github/workflows/ci.yml`）

v{VERSION} はrelease準備commitの `main` CI成功後に一時publish workflowでtag / GitHub Releaseを作成し、公開Asset digestの照合後にそのworkflowを削除する手順を採用します。本体のCOPY / DOWNLOAD / VERIFY / DELETEロジックはrelease準備では変更しません。
"""
release = replace_regex_once(release, r"## 現在のリリース状態\n.*?(?=\n## v1\.0\.0 Release Assets)", current_block.rstrip(), "RELEASE current block")
asset_block = f"""

## v{VERSION} Release Assets

| Asset | 位置づけ | 推奨度 |
|---|---|---|
| `{FIXED.name}` | Tampermonkeyへ導入するversion固定userscript | **推奨 / 第一選択** |
| `{ZIP.name}` | version固定userscriptを含む補助配布物 | 任意 / 代替 |

### v{VERSION} SHA-256

```text
{FIXED.name}
{user_sha}

{ZIP.name}
{zip_sha}
```

`{FIXED.name}` は `linkex-downloader.user.js` とbyte-identicalな **{user_size:,} bytes** です。ZIPは **{zip_size:,} bytes** で、内部の `{FIXED.name}` もbyte-identicalであることを生成時に検証します。公開後はGitHub Release APIが返すAsset `digest` と上記SHA-256を再照合します。
"""
marker = "\n## v1.0.0 Release Assets"
if marker not in release:
    raise SystemExit("RELEASE v1.0.0 asset marker missing")
release = release.replace(marker, asset_block + marker, 1)
release_path.write_text(release, encoding="utf-8", newline="\n")

# 9) One-off publisher: only runs after main CI succeeds, verifies bytes/hashes, then creates tag+Release.
publish = Path(".github/workflows/publish-v1.1.0.yml")
publish.parent.mkdir(parents=True, exist_ok=True)
publish.write_text(f"""name: Publish v{VERSION}

on:
  workflow_run:
    workflows: [\"CI\"]
    branches: [main]
    types: [completed]

permissions:
  contents: write

jobs:
  publish:
    if: ${{{{ github.event.workflow_run.conclusion == 'success' }}}}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{{{ github.event.workflow_run.head_sha }}}}
          fetch-depth: 0

      - name: Verify release commit and artifacts
        shell: bash
        run: |
          set -euo pipefail
          test \"$(git rev-parse HEAD)\" = \"${{{{ github.event.workflow_run.head_sha }}}}\"
          grep -Fq '// @version      {VERSION}' linkex-downloader.user.js
          grep -Fq \"const VERSION = '{VERSION}';\" linkex-downloader.user.js
          cmp linkex-downloader.user.js {FIXED.name}
          unzip -p {ZIP.name} {FIXED.name} > /tmp/release.user.js
          cmp /tmp/release.user.js {FIXED.name}
          USER_SHA=$(sha256sum {FIXED.name} | awk '{{print $1}}')
          ZIP_SHA=$(sha256sum {ZIP.name} | awk '{{print $1}}')
          grep -Fq \"$USER_SHA\" {NOTES.as_posix()}
          grep -Fq \"$ZIP_SHA\" {NOTES.as_posix()}
          node --check linkex-downloader.user.js
          node --test tests/*.test.js

      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{{{ github.token }}}}
        shell: bash
        run: |
          set -euo pipefail
          if gh release view v{VERSION} >/dev/null 2>&1; then
            echo 'v{VERSION} already exists; nothing to publish.'
            exit 0
          fi
          gh release create v{VERSION} \\
            {FIXED.name} \\
            {ZIP.name} \\
            --target \"${{{{ github.event.workflow_run.head_sha }}}}\" \\
            --title \"Linkex Downloader v{VERSION} — 選択Queue・安全性強化\" \\
            --notes-file {NOTES.as_posix()}
""", encoding="utf-8", newline="\n")

print(f"VERSION={VERSION}")
print(f"USER_ASSET={FIXED.name}")
print(f"USER_SIZE={user_size}")
print(f"USER_SHA256={user_sha}")
print(f"ZIP_ASSET={ZIP.name}")
print(f"ZIP_SIZE={zip_size}")
print(f"ZIP_SHA256={zip_sha}")
