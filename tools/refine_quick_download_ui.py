from pathlib import Path

p = Path('tests/linkex-downloader.test.js')
t = p.read_text(encoding='utf-8')

# Function-boundary tests should key on the function name, not its optional-argument spelling.
t = t.replace("SOURCE.indexOf('async function startManifestQueue(selection = null)', runAt)", "SOURCE.indexOf('async function startManifestQueue(', runAt)")
t = t.replace("SOURCE.indexOf('async function startManifestQueue(selection = null,', runAt)", "SOURCE.indexOf('async function startManifestQueue(', runAt)")
t = t.replace("SOURCE.indexOf('async function startManifestQueue(selection = null)')", "SOURCE.indexOf('async function startManifestQueue(')")
t = t.replace("SOURCE.indexOf('async function startManifestQueue(selection = null,')", "SOURCE.indexOf('async function startManifestQueue(')")

# Share-page invariant test follows the new compact wording and preparing guard.
t = t.replace(
    "assert.match(SOURCE, /analyzeBtn\\.textContent = 'この共有を解析'/);",
    "assert.match(SOURCE, /analyzeBtn\\.textContent = 'この共有を再解析'/);",
)
t = t.replace(
    "assert.match(SOURCE, /if \\(onShareHost && !running && manifest && manifest\\.shareToken !== nextToken\\)/);",
    "assert.match(SOURCE, /if \\(onShareHost && !running && !preparing && manifest && manifest\\.shareToken !== nextToken\\)/);",
)

p.write_text(t, encoding='utf-8')
print('quick-download structural tests refined')
