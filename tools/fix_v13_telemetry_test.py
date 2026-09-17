from pathlib import Path

path = Path("tests/performance-telemetry.test.js")
text = path.read_text(encoding="utf-8")
if text.startswith("\\\n"):
    text = text[2:]
path.write_text(text, encoding="utf-8")
