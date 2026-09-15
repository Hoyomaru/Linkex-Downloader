#!/usr/bin/env python3
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
