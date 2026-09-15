from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    if text.count(old) != 1:
        raise SystemExit(f'non-unique patch anchor ({text.count(old)}): {label}')
    return text.replace(old, new, 1)


source_path = Path('linkex-downloader.user.js')
source = source_path.read_text(encoding='utf-8')

source = replace_once(
    source,
    "      if (!chosenFiles.length) { write('処理するファイルが選択されていません。', 'err'); return; }\n      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }",
    "      if (!chosenFiles.length) { write('処理するファイルが選択されていません。', 'err'); return; }\n      const currentHref = String(globalThis.location?.href || '');\n      const currentPageTarget = detectSharePageTarget(currentHref);\n      if (isSharePageHost(currentHref) && (!currentPageTarget || currentPageTarget.shareToken !== manifest.shareToken)) {\n        manifest = null;\n        selectedIndexes.clear();\n        fileFilter.value = '';\n        renderSelection();\n        write('共有ページが解析時点から変わっています。現在の共有をもう一度解析してください。', 'err');\n        syncSharePageContext({initial:true});\n        return;\n      }\n      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }",
    'start page-token guard',
)

source = replace_once(
    source,
    "      } finally { running = false; releaseLease(); refreshQueueUi(); }\n    }\n\n    startBtn.addEventListener",
    "      } finally { running = false; releaseLease(); syncSharePageContext({initial:true}); refreshQueueUi(); }\n    }\n\n    startBtn.addEventListener",
    'start completion page resync',
)

source = replace_once(
    source,
    "      } finally { running = false; releaseLease(); refreshQueueUi(); }\n    });\n\n    pauseBtn.addEventListener",
    "      } finally { running = false; releaseLease(); syncSharePageContext({initial:true}); refreshQueueUi(); }\n    });\n\n    pauseBtn.addEventListener",
    'resume completion page resync',
)

source = replace_once(
    source,
    "    if (isDiskStoragePage()) {\n      syncCredentialBridgeFromDisk();\n      setTimeout(() => syncCredentialBridgeFromDisk({clearIfMissing:true}), 4000);\n    }\n    syncSharePageContext({initial:true});",
    "    if (isDiskStoragePage()) {\n      syncCredentialBridgeFromDisk();\n      setTimeout(() => syncCredentialBridgeFromDisk({clearIfMissing:true}), 4000);\n      setInterval(() => syncCredentialBridgeFromDisk({clearIfMissing:true}), 60000);\n    }\n    syncSharePageContext({initial:true});",
    'periodic disk credential sync',
)

source = replace_once(
    source,
    "    globalThis.addEventListener?.('focus', () => syncSharePageContext({initial:true}));",
    "    globalThis.addEventListener?.('focus', () => {\n      if (isDiskStoragePage()) syncCredentialBridgeFromDisk();\n      syncSharePageContext({initial:true});\n    });",
    'focus credential refresh',
)

source_path.write_text(source, encoding='utf-8')

# Tests: assert both route-race protections and bridge refresh hooks exist.
test_path = Path('tests/linkex-downloader.test.js')
tests = test_path.read_text(encoding='utf-8')
tests += r'''

test('share-page start rechecks the current token and Queue completion resynchronizes stale page context', () => {
  const startAt = SOURCE.indexOf('async function startManifestQueue(selection = null)');
  const resumeAt = SOURCE.indexOf("resumeBtn.addEventListener('click'", startAt);
  const pauseAt = SOURCE.indexOf("pauseBtn.addEventListener('click'", resumeAt);
  assert.ok(startAt > 0 && resumeAt > startAt && pauseAt > resumeAt);
  const startBlock = SOURCE.slice(startAt, resumeAt);
  assert.match(startBlock, /currentPageTarget\.shareToken !== manifest\.shareToken/);
  assert.match(startBlock, /共有ページが解析時点から変わっています/);
  assert.match(startBlock, /finally \{ running = false; releaseLease\(\); syncSharePageContext\(\{initial:true\}\); refreshQueueUi\(\); \}/);
  const resumeBlock = SOURCE.slice(resumeAt, pauseAt);
  assert.match(resumeBlock, /finally \{ running = false; releaseLease\(\); syncSharePageContext\(\{initial:true\}\); refreshQueueUi\(\); \}/);
});

test('disk credential bridge refreshes on focus and periodically clears a logged-out session', () => {
  assert.match(SOURCE, /setInterval\(\(\) => syncCredentialBridgeFromDisk\(\{clearIfMissing:true\}\), 60000\)/);
  assert.match(SOURCE, /addEventListener\?\.\('focus',[\s\S]*syncCredentialBridgeFromDisk\(\);[\s\S]*syncSharePageContext/);
});
'''
test_path.write_text(tests, encoding='utf-8')

# Development guide: document the new trust boundary and invariants.
path = Path('DEVELOPMENT.md')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    '- Target: `https://disk.linkex.io/*`',
    '- Targets: `https://disk.linkex.io/*`, `https://l2e.click/d/*`, `https://www.l2e.click/d/*`\n- Share Page Mode design: [`docs/SHARE_PAGE_MODE.md`](docs/SHARE_PAGE_MODE.md)',
    'development targets',
)
text = replace_once(
    text,
    '13. 危険な曖昧状態は「失敗して止まる」側を選ぶ。誤削除より停止を優先する。',
    '13. 危険な曖昧状態は「失敗して止まる」側を選ぶ。誤削除より停止を優先する。\n14. 共有ページのURL変更で既存Queueの `job.shareToken` を書き換えない。Queueは作成時の共有へ固定する。\n15. `l2e.click` 側のLocal StorageをLinkexアカウント認証として信用しない。認証bridgeは `disk.linkex.io` で検出したtokenだけを書き込む。\n16. credential bridgeへrefresh tokenを保存しない。access tokenもJWT expiryまたは12時間の早い方で失効させる。',
    'development share safety invariants',
)
text = replace_once(
    text,
    '| 認証検出 | Local Storageからcredential候補検出 | `discoverCredentials()` |\n| 共有解析 | URL解析、再帰manifest | `parseShareToken()`, `buildManifest()` |',
    '| 認証検出/bridge | disk Local Storageからcredential候補検出、access tokenだけGM bridgeへ同期 | `discoverCredentials()`, `syncCredentialBridgeFromDisk()`, `resolveCredentials()` |\n| Page context | share pageの現在token検出、URL変更時のmanifest guard | `detectSharePageTarget()`, `syncSharePageContext()` |\n| 共有解析 | URL解析、再帰manifest | `parseShareToken()`, `buildManifest()` |',
    'development component table',
)
text = replace_once(
    text,
    '@match   https://disk.linkex.io/*\n@connect prod.linksvc.xyz',
    '@match   https://disk.linkex.io/*\n@match   https://l2e.click/d/*\n@match   https://www.l2e.click/d/*\n@connect prod.linksvc.xyz',
    'development metadata',
)
needle = '''`discoverCredentials()` が `localStorage` 内のJSONを走査し、JWTらしい `token` / `accessToken` / `diskToken` 等を候補化して、パス名等からscoreを付けて選択します。\n\n実tokenをソース・ドキュメント・Issue・診断ログへ貼らないでください。'''
replacement = '''`discoverCredentials()` が `disk.linkex.io` の `localStorage` 内JSONを走査し、JWTらしい `token` / `accessToken` / `diskToken` 等を候補化して、パス名等からscoreを付けて選択します。\n\nShare Page Modeでは `l2e.click` が別originのためdisk Local Storageを直接読めません。`syncCredentialBridgeFromDisk()` が **access tokenだけ**を `linkexCredentialBridgeV1` へ保存し、`resolveCredentials()` が共有ページ側でそれを利用します。refresh tokenはbridgeへ保存しません。bridgeはJWT expiryまたは12時間の早い方で失効し、disk側ログアウトを検出した場合はclearします。\n\n`l2e.click` 側のLocal Storageにtokenらしき値があっても、Linkexアカウント認証には使わないでください。このorigin境界は安全条件です。\n\n実tokenをソース・ドキュメント・Issue・診断ログへ貼らないでください。'''
text = replace_once(text, needle, replacement, 'development credential section')
path.write_text(text, encoding='utf-8')

print('share-page refinements applied')
