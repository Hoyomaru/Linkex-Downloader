from pathlib import Path

source_path = Path('tools/apply_quick_download_ui.py')
source = source_path.read_text(encoding='utf-8')
old = "result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)"
new = "result, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)"
if old not in source:
    raise SystemExit('regex helper target not found')
source = source.replace(old, new, 1)
exec(compile(source, str(source_path), 'exec'), {'__name__': '__main__'})
