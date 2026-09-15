from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'target not found: {label}')
    return text.replace(old, new, 1)


src_path = Path('linkex-downloader.user.js')
src = src_path.read_text(encoding='utf-8')

src = replace_once(
    src,
    "        #linkex-full-queue .progress > i { display:block; height:100%; width:0%; background:#2563eb; transition:width .2s ease; }\n        #linkex-full-queue .status { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; background:#0b1220; border:1px solid #374151; border-radius:8px; padding:10px; max-height:350px; overflow:auto; }",
    "        #linkex-full-queue .progress > i { display:block; height:100%; width:0%; background:#2563eb; transition:width .2s ease; }\n        #linkex-full-queue .state-line { font-size:11px; color:#cbd5e1; margin:-2px 0 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n        #linkex-full-queue .state-line.ok { color:#bbf7d0; }\n        #linkex-full-queue .state-line.err { color:#fecaca; }\n        #linkex-full-queue details.log { margin-top:8px; }\n        #linkex-full-queue details.log > summary { cursor:pointer; color:#9ca3af; font-size:11px; font-weight:700; user-select:none; padding:4px 1px; }\n        #linkex-full-queue .status { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; background:#0b1220; border:1px solid #374151; border-radius:8px; padding:10px; margin-top:6px; max-height:350px; overflow:auto; }",
    'compact state/log css',
)

src = replace_once(
    src,
    "          </div>\n          <div id=\"lf-status\" class=\"status\">共有ページでは「すべてダウンロード」だけで解析からQueue開始まで進めます。\\n安全処理は1ファイルずつ COPY → DL → VERIFY → 所有destIdだけDELETE します。</div>\n          <details id=\"lf-more\" class=\"more\">\n            <summary>詳細</summary>\n            <div class=\"more-body\">\n              <div class=\"row\"><button id=\"lf-destination\" class=\"secondary\">保存先を変更</button><button id=\"lf-analyze\" class=\"secondary\">共有を再解析</button></div>\n              <div class=\"row\"><button id=\"lf-selftest\" class=\"secondary\">署名テスト</button><button id=\"lf-export\" class=\"secondary\">診断ログを保存</button></div>\n              <div class=\"row\"><button id=\"lf-refresh\" class=\"secondary\">状態を再表示</button><button id=\"lf-retry\" class=\"secondary\" disabled>容量スキップを再試行</button></div>\n              <div class=\"row\" style=\"margin-bottom:0\"><button id=\"lf-abandon\" class=\"secondary\" disabled>Queueを安全に破棄</button></div>\n            </div>\n          </details>",
    "          </div>\n          <div id=\"lf-state-line\" class=\"state-line\">待機中</div>\n          <details id=\"lf-more\" class=\"more\">\n            <summary>詳細</summary>\n            <div class=\"more-body\">\n              <div class=\"row\"><button id=\"lf-destination\" class=\"secondary\">保存先を変更</button><button id=\"lf-analyze\" class=\"secondary\">共有を再解析</button></div>\n              <div class=\"row\"><button id=\"lf-selftest\" class=\"secondary\">署名テスト</button><button id=\"lf-export\" class=\"secondary\">診断ログを保存</button></div>\n              <div class=\"row\"><button id=\"lf-refresh\" class=\"secondary\">状態を再表示</button><button id=\"lf-retry\" class=\"secondary\" disabled>容量スキップを再試行</button></div>\n              <div class=\"row\" style=\"margin-bottom:0\"><button id=\"lf-abandon\" class=\"secondary\" disabled>Queueを安全に破棄</button></div>\n              <details id=\"lf-log-details\" class=\"log\">\n                <summary>ログを表示</summary>\n                <div id=\"lf-status\" class=\"status\">共有ページでは「すべてダウンロード」だけで解析からQueue開始まで進めます。\\n安全処理は1ファイルずつ COPY → DL → VERIFY → 所有destIdだけDELETE します。</div>\n              </details>\n            </div>\n          </details>",
    'move verbose log under details',
)

src = replace_once(
    src,
    "    const status = root.querySelector('#lf-status');\n    const analyzeBtn = root.querySelector('#lf-analyze');",
    "    const status = root.querySelector('#lf-status');\n    const stateLine = root.querySelector('#lf-state-line');\n    const moreDetails = root.querySelector('#lf-more');\n    const logDetails = root.querySelector('#lf-log-details');\n    const analyzeBtn = root.querySelector('#lf-analyze');",
    'log element refs',
)

src = replace_once(
    src,
    "    const write = (text, cls='') => {\n      status.className = `status ${cls}`;\n      status.textContent = text;\n      const now = Date.now();\n      // Download progress can update frequently; avoid flooding persistent diagnostics.\n      const isProgress = /^DOWNLOADING\\b/.test(text);\n      if (text !== lastUiEventText && (!isProgress || now - lastUiEventAt >= 5000)) {\n        recordEvent(cls === 'err' ? 'error' : 'info', 'ui', text);\n        lastUiEventText = text;\n        lastUiEventAt = now;\n      }\n      refreshProgress();\n    };",
    "    const write = (text, cls='') => {\n      const message = String(text ?? '');\n      status.className = `status ${cls}`;\n      status.textContent = message;\n      const firstLine = message.split('\\n').find(line => line.trim())?.trim() || '待機中';\n      stateLine.textContent = firstLine.length > 110 ? `${firstLine.slice(0, 107)}…` : firstLine;\n      stateLine.title = firstLine;\n      stateLine.className = `state-line ${cls}`;\n      if (cls === 'err') {\n        moreDetails.open = true;\n        logDetails.open = true;\n      }\n      const now = Date.now();\n      // Download progress can update frequently; avoid flooding persistent diagnostics.\n      const isProgress = /^DOWNLOADING\\b/.test(message);\n      if (message !== lastUiEventText && (!isProgress || now - lastUiEventAt >= 5000)) {\n        recordEvent(cls === 'err' ? 'error' : 'info', 'ui', message);\n        lastUiEventText = message;\n        lastUiEventAt = now;\n      }\n      refreshProgress();\n    };",
    'compact state write path',
)

src_path.write_text(src, encoding='utf-8')

test_path = Path('tests/linkex-downloader.test.js')
tests = test_path.read_text(encoding='utf-8')
marker = "test('preferred download directory is separate from Queue-specific handles and is preloaded before quick actions enable', () => {"
new_test = '''test('verbose status log is collapsed under details while one-line state stays visible and errors reveal the log', () => {\n  const progressAt = SOURCE.indexOf('id=\"lf-progress-bar\"');\n  const stateAt = SOURCE.indexOf('id=\"lf-state-line\"');\n  const moreAt = SOURCE.indexOf('<details id=\"lf-more\" class=\"more\">');\n  const logAt = SOURCE.indexOf('<details id=\"lf-log-details\" class=\"log\">');\n  const statusAt = SOURCE.indexOf('id=\"lf-status\" class=\"status\"');\n  assert.ok(progressAt > 0 && stateAt > progressAt && moreAt > stateAt && logAt > moreAt && statusAt > logAt);\n\n  const writeAt = SOURCE.indexOf(\"const write = (text, cls='') => {\");\n  const manifestAt = SOURCE.indexOf('let manifest = null;', writeAt);\n  assert.ok(writeAt > 0 && manifestAt > writeAt);\n  const writeBlock = SOURCE.slice(writeAt, manifestAt);\n  assert.match(writeBlock, /stateLine\\.textContent =/);\n  assert.match(writeBlock, /stateLine\\.className = `state-line \\$\\{cls\\}`;/);\n  assert.match(writeBlock, /if \\(cls === 'err'\\) \\{\\s*moreDetails\\.open = true;\\s*logDetails\\.open = true;\\s*\\}/);\n});\n\n'''
if marker not in tests:
    raise SystemExit('test insertion marker not found')
tests = tests.replace(marker, new_test + marker, 1)
test_path.write_text(tests, encoding='utf-8')

changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text(encoding='utf-8')
changelog = replace_once(
    changelog,
    "- 初期UIを「すべてダウンロード」「ファイルを選ぶ」中心に整理し、診断・再試行・安全破棄等を `詳細` へ集約\n",
    "- 初期UIを「すべてダウンロード」「ファイルを選ぶ」中心に整理し、診断・再試行・安全破棄等を `詳細` へ集約\n- 常時表示していた詳細ログを `詳細 → ログを表示` へ折りたたみ、通常時は進捗バー＋1行状態表示だけに簡素化。エラー時はログを自動展開\n",
    'changelog',
)
changelog_path.write_text(changelog, encoding='utf-8')

doc_path = Path('docs/QUICK_DOWNLOAD_UI.md')
doc = doc_path.read_text(encoding='utf-8')
doc = replace_once(
    doc,
    "│ progress                                    │\n│ status                                      │",
    "│ progress                                    │\n│ 状態: 現在処理を1行表示                     │",
    'ui diagram status',
)
doc = replace_once(
    doc,
    "- Queueを安全に破棄\n\n有効でない操作はdisabled/hiddenにする。",
    "- Queueを安全に破棄\n- ログを表示（通常は折りたたみ。エラー時は自動展開）\n\n詳細ログは初期画面に常時表示せず、通常時は進捗バーと1行の状態表示だけを見せる。処理履歴自体は従来どおり保持し、診断ログJSON出力にも含める。\n\n有効でない操作はdisabled/hiddenにする。",
    'details log docs',
)
doc = replace_once(
    doc,
    "7. resumeがpreferred handleへフォールバックせず既存Queue handleだけを使う。\n8. COPY -> DOWNLOAD -> DELETE安全中核の既存テストは全件維持する。",
    "7. resumeがpreferred handleへフォールバックせず既存Queue handleだけを使う。\n8. 詳細ログが初期画面では折りたたまれ、1行状態表示が常時見え、エラー時だけログが自動展開される。\n9. COPY -> DOWNLOAD -> DELETE安全中核の既存テストは全件維持する。",
    'test docs',
)
doc_path.write_text(doc, encoding='utf-8')

print('collapsible log UI patch applied')
