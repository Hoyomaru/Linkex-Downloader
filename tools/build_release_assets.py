#!/usr/bin/env python3
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
