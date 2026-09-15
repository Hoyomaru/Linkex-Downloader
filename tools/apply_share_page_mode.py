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
    '// @match        https://disk.linkex.io/*\n// @connect      prod.linksvc.xyz',
    '// @match        https://disk.linkex.io/*\n// @match        https://l2e.click/d/*\n// @match        https://www.l2e.click/d/*\n// @connect      prod.linksvc.xyz',
    'userscript share-page matches',
)

credential_bridge = r'''

  const CREDENTIAL_BRIDGE_KEY = 'linkexCredentialBridgeV1';
  const CREDENTIAL_BRIDGE_FALLBACK_TTL_MS = 12 * 60 * 60 * 1000;

  function currentPageUrl(input = null) {
    try { return new URL(input == null ? String(globalThis.location?.href || '') : String(input)); }
    catch { return null; }
  }

  function isDiskStoragePage(input = null) {
    const url = currentPageUrl(input);
    return !!url && url.protocol === 'https:' && url.hostname.toLowerCase() === 'disk.linkex.io';
  }

  function jwtExpiryMs(token) {
    if (!isJwtLike(token) || typeof atob !== 'function') return null;
    try {
      let payload = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      payload += '='.repeat((4 - payload.length % 4) % 4);
      const parsed = JSON.parse(atob(payload));
      const exp = Number(parsed?.exp);
      return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
    } catch { return null; }
  }

  function writeCredentialBridge(credential) {
    if (!credential?.token || !isDiskStoragePage()) return null;
    const cachedAt = Date.now();
    const jwtExpiry = jwtExpiryMs(credential.token);
    if (jwtExpiry !== null && jwtExpiry <= cachedAt) {
      GM_setValue(CREDENTIAL_BRIDGE_KEY, null);
      return null;
    }
    const expiresAt = Math.min(jwtExpiry ?? Number.POSITIVE_INFINITY, cachedAt + CREDENTIAL_BRIDGE_FALLBACK_TTL_MS);
    const value = {schemaVersion:1, token:credential.token, cachedAt, expiresAt, sourceOrigin:'https://disk.linkex.io'};
    GM_setValue(CREDENTIAL_BRIDGE_KEY, value);
    return value;
  }

  function readCredentialBridge(now = Date.now()) {
    const value = GM_getValue(CREDENTIAL_BRIDGE_KEY, null);
    if (!value || typeof value !== 'object' || !isJwtLike(value.token)) return null;
    const expiresAt = Number(value.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      GM_setValue(CREDENTIAL_BRIDGE_KEY, null);
      return null;
    }
    return {token:value.token, refreshToken:null, source:'gm-bridge', cachedAt:Number(value.cachedAt || 0), expiresAt};
  }

  function syncCredentialBridgeFromDisk({clearIfMissing = false} = {}) {
    if (!isDiskStoragePage()) return null;
    const credential = discoverCredentials();
    if (credential?.token) {
      writeCredentialBridge(credential);
      return {...credential, source:'disk-localStorage'};
    }
    if (clearIfMissing) GM_setValue(CREDENTIAL_BRIDGE_KEY, null);
    return null;
  }

  function resolveCredentials() {
    if (isDiskStoragePage()) {
      const local = syncCredentialBridgeFromDisk();
      if (local?.token) return local;
    }
    return readCredentialBridge();
  }

  function credentialBootstrapMessage() {
    if (isDiskStoragePage()) return 'Linkexログイン情報を検出できませんでした。disk.linkex.ioでログイン後にページを再読み込みしてください。';
    return 'Linkexログイン情報を利用できません。disk.linkex.ioへログインした状態で一度ページを開き、この共有ページへ戻ってください。';
  }
'''
source = replace_once(
    source,
    '\n  function getNativePageWindow() {',
    credential_bridge + '\n  function getNativePageWindow() {',
    'credential bridge insertion',
)

share_detection = r'''

  function isSharePageHost(input = null) {
    const url = currentPageUrl(input);
    if (!url || url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'l2e.click' || host === 'www.l2e.click';
  }

  function detectSharePageTarget(input = null) {
    const url = currentPageUrl(input);
    if (!url || !isSharePageHost(url.href)) return null;
    const match = url.pathname.match(/^\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match) return null;
    return {shareToken:match[1], href:url.href, hostname:url.hostname.toLowerCase()};
  }
'''
source = replace_once(
    source,
    "    return match[1];\n  }\n\n  async function buildManifest",
    "    return match[1];\n  }" + share_detection + "\n  async function buildManifest",
    'share-page detector',
)

source = replace_once(
    source,
    "    const creds = discoverCredentials();\n    if (!creds) throw new LinkexError('Linkexログイン情報を検出できません。');\n    const api = new LinkexApi({token:creds.token});",
    "    const creds = resolveCredentials();\n    if (!creds) throw new LinkexError(credentialBootstrapMessage(), {kind:'auth'});\n    const api = new LinkexApi({token:creds.token});",
    'queue credential resolution',
)

source = replace_once(
    source,
    "        #linkex-full-queue .notice { font-size:11px; color:#9ca3af; margin-top:8px; line-height:1.45; }",
    "        #linkex-full-queue .notice { font-size:11px; color:#9ca3af; margin-top:8px; line-height:1.45; }\n        #linkex-full-queue .share-context { margin:0 0 8px; padding:8px 10px; border:1px solid #1d4ed8; border-radius:8px; background:#0b1b38; color:#bfdbfe; font-size:11px; line-height:1.45; overflow-wrap:anywhere; }\n        #linkex-full-queue .share-context[hidden] { display:none; }",
    'share context CSS',
)
source = replace_once(
    source,
    '          <input id="lf-url" placeholder="https://l2e.click/d/xxxxxxxx" />',
    '          <div id="lf-share-context" class="share-context" hidden></div>\n          <input id="lf-url" placeholder="https://l2e.click/d/xxxxxxxx" />',
    'share context markup',
)
source = replace_once(
    source,
    "    const input = root.querySelector('#lf-url');\n    const status = root.querySelector('#lf-status');",
    "    const input = root.querySelector('#lf-url');\n    const shareContextEl = root.querySelector('#lf-share-context');\n    const status = root.querySelector('#lf-status');",
    'share context element lookup',
)
source = replace_once(
    source,
    "    let activeRunJob = null;\n    let selectedIndexes = new Set();\n    input.value = GM_getValue(LAST_URL_KEY, '') || '';",
    "    let activeRunJob = null;\n    let selectedIndexes = new Set();\n    let pageShareTarget = null;\n    input.value = GM_getValue(LAST_URL_KEY, '') || '';",
    'page share state',
)

page_sync = r'''

    function shortShareToken(token) {
      const value = String(token || '');
      return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-4)}`;
    }

    function syncSharePageContext({initial = false} = {}) {
      const next = detectSharePageTarget(globalThis.location?.href || '');
      const previousToken = pageShareTarget?.shareToken || null;
      const nextToken = next?.shareToken || null;
      const changed = previousToken !== nextToken;
      const onShareHost = isSharePageHost(globalThis.location?.href || '');
      pageShareTarget = next;

      if (next) {
        input.value = next.href;
        input.hidden = true;
        shareContextEl.hidden = false;
        const authReady = !!readCredentialBridge();
        shareContextEl.textContent = `このページの共有: ${shortShareToken(next.shareToken)} · Linkex認証連携: ${authReady ? '準備済み' : '未準備（初回はdisk.linkex.ioを開いてください）'}`;
        analyzeBtn.textContent = 'この共有を解析';
      } else {
        input.hidden = false;
        shareContextEl.hidden = true;
        shareContextEl.textContent = '';
        analyzeBtn.textContent = '共有リンクを解析';
      }

      if (onShareHost && !running && manifest && manifest.shareToken !== nextToken) {
        manifest = null;
        selectedIndexes.clear();
        fileFilter.value = '';
        renderSelection();
        if (!initial) write('共有ページが変わりました。現在の共有を解析してください。');
      } else if (changed && running) {
        recordEvent('warn', 'share-page-change-during-run', 'Queue実行中に共有ページURLが変わりました。実行中Queueは作成時のshareTokenを維持します。', {jobId:activeRunJob?.jobId || null});
      }
      refreshQueueUi();
      return next;
    }
'''
source = replace_once(
    source,
    "    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }\n\n    function visibleManifestIndexes()",
    "    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }" + page_sync + "\n    function visibleManifestIndexes()",
    'share-page UI synchronization',
)

old_analyze = r'''    analyzeBtn.addEventListener('click', async () => {
      analyzeBtn.disabled = true;
      try {
        const token = parseShareToken(input.value);
        GM_setValue(LAST_URL_KEY, input.value.trim());
        const api = new LinkexApi({token:null});
        write('共有manifestを読み取り中…');
        manifest = await buildManifest(api, token, x => write(`共有manifestを読み取り中…\nfiles: ${x.files}\n${x.path || ''}`));
        selectedIndexes = new Set(manifest.files.map((_, i) => i));'''
new_analyze = r'''    analyzeBtn.addEventListener('click', async () => {
      analyzeBtn.disabled = true;
      try {
        const pageTargetAtStart = detectSharePageTarget(globalThis.location?.href || '');
        const sourceInput = pageTargetAtStart?.href || input.value;
        const token = pageTargetAtStart?.shareToken || parseShareToken(sourceInput);
        GM_setValue(LAST_URL_KEY, String(sourceInput || '').trim());
        const api = new LinkexApi({token:null});
        write('共有manifestを読み取り中…');
        const nextManifest = await buildManifest(api, token, x => write(`共有manifestを読み取り中…\nfiles: ${x.files}\n${x.path || ''}`));
        if (pageTargetAtStart) {
          const currentTarget = detectSharePageTarget(globalThis.location?.href || '');
          if (currentTarget?.shareToken !== token) throw new LinkexError('解析中に共有ページが変わりました。現在の共有をもう一度解析してください。', {kind:'share_context_changed'});
        }
        manifest = nextManifest;
        selectedIndexes = new Set(manifest.files.map((_, i) => i));'''
source = replace_once(source, old_analyze, new_analyze, 'analyze current share target')

source = replace_once(
    source,
    "      if (!chosenFiles.length) { write('処理するファイルが選択されていません。', 'err'); return; }\n      const totalBytes = chosenFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);",
    "      if (!chosenFiles.length) { write('処理するファイルが選択されていません。', 'err'); return; }\n      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }\n      const totalBytes = chosenFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);",
    'new queue credential preflight',
)
source = replace_once(
    source,
    "      const snapshot = loadQueueJob();\n      if (!snapshot || isTerminal(snapshot)) { refreshQueueUi(); return; }\n      running = true;",
    "      const snapshot = loadQueueJob();\n      if (!snapshot || isTerminal(snapshot)) { refreshQueueUi(); return; }\n      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }\n      running = true;",
    'resume credential preflight',
)

startup_anchor = "    const existing = refreshQueueUi();\n"
startup_insert = r'''    if (isDiskStoragePage()) {
      syncCredentialBridgeFromDisk();
      setTimeout(() => syncCredentialBridgeFromDisk({clearIfMissing:true}), 4000);
    }
    syncSharePageContext({initial:true});
    let observedPageHref = String(globalThis.location?.href || '');
    setInterval(() => {
      const currentHref = String(globalThis.location?.href || '');
      if (currentHref === observedPageHref) return;
      observedPageHref = currentHref;
      syncSharePageContext();
    }, 750);
    globalThis.addEventListener?.('focus', () => syncSharePageContext({initial:true}));

'''
source = replace_once(source, startup_anchor, startup_insert + startup_anchor, 'page/credential startup hooks')

source_path.write_text(source, encoding='utf-8')

# --- tests ---
test_path = Path('tests/linkex-downloader.test.js')
tests = test_path.read_text(encoding='utf-8')
tests = replace_once(
    tests,
    "const EXPOSE = \"  globalThis.__linkexTest = {allocateLocalPaths, assertDeleteGuards, downloadOwnedFile, sameOwnedIdentity, LinkexApi, compactDoneTx, createQueueFromManifest};\\n})();\";",
    "const EXPOSE = \"  globalThis.__linkexTest = {allocateLocalPaths, assertDeleteGuards, downloadOwnedFile, sameOwnedIdentity, LinkexApi, compactDoneTx, createQueueFromManifest, parseShareToken, detectSharePageTarget, isSharePageHost, readCredentialBridge, syncCredentialBridgeFromDisk, resolveCredentials};\\n})();\";",
    'test exports',
)
old_load = r'''function loadRuntime() {
  assert.ok(SOURCE.includes(STARTUP), 'test harness could not find userscript startup block');
  const storage = new Map();
  const context = {
    console,
    TextEncoder,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto: webcrypto,
    navigator: {language: 'ja-JP'},
    localStorage: {length: 0, key: () => null, getItem: () => null},
    window: {},
    unsafeWindow: {},
    document: {readyState: 'loading', addEventListener() {}},'''
new_load = r'''function loadRuntime({href = 'https://disk.linkex.io/', localStorageEntries = {}} = {}) {
  assert.ok(SOURCE.includes(STARTUP), 'test harness could not find userscript startup block');
  const storage = new Map();
  const localValues = new Map(Object.entries(localStorageEntries));
  const localStorage = {
    get length() { return localValues.size; },
    key(index) { return Array.from(localValues.keys())[index] ?? null; },
    getItem(key) { return localValues.has(key) ? localValues.get(key) : null; },
  };
  const context = {
    console,
    TextEncoder,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto: webcrypto,
    navigator: {language: 'ja-JP'},
    location: new URL(href),
    localStorage,
    atob(value) { return Buffer.from(String(value), 'base64').toString('binary'); },
    window: {},
    unsafeWindow: {},
    document: {readyState: 'loading', addEventListener() {}},'''
tests = replace_once(tests, old_load, new_load, 'test runtime page/localStorage support')

tests += r'''

function makeJwt(expSeconds = Math.floor(Date.now() / 1000) + 3600) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({alg:'none',typ:'JWT'})}.${enc({exp:expSeconds,sub:'test-user'})}.test-signature`;
}

test('share-page target detection is restricted to l2e /d/ pages while manual parsing stays compatible', () => {
  const {api} = loadRuntime({href:'https://l2e.click/d/AbCd_123?from=test'});
  const target = api.detectSharePageTarget('https://l2e.click/d/AbCd_123?from=test');
  assert.equal(target.shareToken, 'AbCd_123');
  assert.equal(api.detectSharePageTarget('https://www.l2e.click/d/token-99').shareToken, 'token-99');
  assert.equal(api.detectSharePageTarget('https://evil.example/d/AbCd_123'), null);
  assert.equal(api.detectSharePageTarget('https://l2e.click/other/AbCd_123'), null);
  assert.equal(api.parseShareToken('https://l2e.click/d/AbCd_123'), 'AbCd_123');
  assert.equal(api.parseShareToken('AbCd_123'), 'AbCd_123');
});

test('credential bridge is written only from disk origin and l2e ignores its own localStorage credentials', () => {
  const trustedToken = makeJwt();
  const untrustedToken = makeJwt(Math.floor(Date.now() / 1000) + 7200);
  const disk = loadRuntime({
    href:'https://disk.linkex.io/',
    localStorageEntries:{credential:JSON.stringify({credential:{token:trustedToken}})},
  });
  const local = disk.api.resolveCredentials();
  assert.equal(local.token, trustedToken);
  assert.equal(local.source, 'disk-localStorage');
  const bridge = disk.storage.get('linkexCredentialBridgeV1');
  assert.equal(bridge.token, trustedToken);
  assert.equal(bridge.sourceOrigin, 'https://disk.linkex.io');

  const share = loadRuntime({
    href:'https://l2e.click/d/share123',
    localStorageEntries:{credential:JSON.stringify({credential:{token:untrustedToken}})},
  });
  assert.equal(share.api.resolveCredentials(), null, 'l2e localStorage must never be trusted for account auth');
  share.storage.set('linkexCredentialBridgeV1', bridge);
  const bridged = share.api.resolveCredentials();
  assert.equal(bridged.token, trustedToken);
  assert.equal(bridged.source, 'gm-bridge');
});

test('expired credential bridge fails closed and clears itself', () => {
  const {api, storage} = loadRuntime({href:'https://l2e.click/d/share123'});
  storage.set('linkexCredentialBridgeV1', {
    schemaVersion:1,
    token:makeJwt(Math.floor(Date.now() / 1000) - 60),
    cachedAt:Date.now() - 10000,
    expiresAt:Date.now() - 1,
    sourceOrigin:'https://disk.linkex.io',
  });
  assert.equal(api.readCredentialBridge(), null);
  assert.equal(storage.get('linkexCredentialBridgeV1'), null);
});

test('share-page mode keeps runtime transaction core and invalidates stale manifest only outside a running Queue', () => {
  assert.match(SOURCE, /@match\s+https:\/\/l2e\.click\/d\/\*/);
  assert.match(SOURCE, /@match\s+https:\/\/www\.l2e\.click\/d\/\*/);
  assert.match(SOURCE, /analyzeBtn\.textContent = 'この共有を解析'/);
  assert.match(SOURCE, /if \(onShareHost && !running && manifest && manifest\.shareToken !== nextToken\)/);
  assert.match(SOURCE, /Queue実行中に共有ページURLが変わりました。実行中Queueは作成時のshareTokenを維持します。/);
  assert.match(SOURCE, /const creds = resolveCredentials\(\);/);
  assert.match(SOURCE, /await ensureCopyOwned\(api, job, i, onStatus\);[\s\S]*await ensureDownloaded\(api, job, i, queueRoot, onStatus\);[\s\S]*await ensureDeleted\(api, job, i, onStatus\);/);
});
'''
test_path.write_text(tests, encoding='utf-8')

# --- CHANGELOG ---
path = Path('CHANGELOG.md')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    '## [Unreleased]\n\n次回リリース向けの変更はここへ追記します。',
    '## [Unreleased]\n\n### Added\n\n- `l2e.click/d/...` 共有ページ上から現在の共有を直接解析・Queue開始できる Share Page Mode\n- `disk.linkex.io` で検出したaccess tokenだけを短時間GM storageへ橋渡しし、別originの共有ページから安全に認証済みQueueを実行するcredential bridge\n- 共有ページのSPA/URL変更を検知し、実行中Queueの `shareToken` は固定したまま古いmanifestだけを安全に無効化するpage-context guard',
    'changelog unreleased share-page mode',
)
path.write_text(text, encoding='utf-8')

# --- README ---
path = Path('README.md')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    '- `https://l2e.click/d/...` 共有URLの解析',
    '- `https://l2e.click/d/...` 共有ページ上から「この共有を解析」（URLコピー不要）\n- `disk.linkex.io` 上での従来の共有URL手入力解析も継続対応',
    'README features',
)
text = replace_once(
    text,
    '- `https://disk.linkex.io/` へのログイン',
    '- `https://disk.linkex.io/` へのログイン\n- Share Page Modeを使う場合、更新後に一度 `disk.linkex.io` を開いて認証連携を準備（access tokenのみ最大12時間のGM storage bridge。refresh tokenは保存しません）',
    'README requirements auth bridge',
)
old_basic = '''## 基本的な使い方\n\n1. Linkexへログインした状態で `https://disk.linkex.io/` を開きます。\n2. 右下の Linkex Downloader パネルへ `https://l2e.click/d/...` 形式の共有URLを入力します。\n3. **共有リンクを解析** を押します。\n4. ファイル数・フォルダ数・合計サイズを確認します。\n5. **全ファイル開始** を押します。\n6. 確認ダイアログで開始を承認します。\n7. 必要なファイルだけ保存したい場合は、解析後の一覧で「全解除」→検索/チェックを使って対象を選び、**選択ファイル開始** を押します。全件ならそのまま **全ファイル開始** を使います。\n8. ローカルの保存先フォルダを選択します。\n9. あとはQueueが1ファイルずつ処理します。'''
new_basic = '''## 基本的な使い方\n\n### 共有ページから使う（推奨）\n\n1. 更新後の初回だけ、Linkexへログインした状態で `https://disk.linkex.io/` を一度開きます。Downloaderがuserscript-privateなGM storageへaccess tokenを短時間連携します。\n2. 保存したい `https://l2e.click/d/...` 共有リンクをブラウザでそのまま開きます。\n3. 右下の Linkex Downloader で **この共有を解析** を押します。URLのコピー/貼り付けは不要です。\n4. ファイル数・フォルダ数・合計サイズを確認します。\n5. 全件なら **全ファイル開始**、必要なものだけなら検索/チェック後に **選択ファイル開始** を押します。\n6. ローカルの保存先フォルダを選択します。\n7. あとは従来と同じ安全Queueが1ファイルずつ処理します。\n\n共有ページを開くだけでは再帰解析を開始しません。解析は必ず **この共有を解析** の明示操作から始まります。\n\n### 自ストレージページから使う（従来互換）\n\n`https://disk.linkex.io/` 上では従来どおりURL入力欄が表示されます。`https://l2e.click/d/...` を貼り付けて **共有リンクを解析** を押す方式も引き続き利用できます。'''
text = replace_once(text, old_basic, new_basic, 'README basic usage')
text = replace_once(
    text,
    '| **共有リンクを解析** | 共有をread-onlyで走査しmanifestを作成 |',
    '| **この共有を解析 / 共有リンクを解析** | 共有ページでは現在URLのtokenを自動使用。自ストレージページでは入力URLをread-onlyで走査しmanifestを作成 |',
    'README UI analyze button',
)
path.write_text(text, encoding='utf-8')

# --- ARCHITECTURE ---
path = Path('docs/ARCHITECTURE.md')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    'Linkex Downloader は、`https://disk.linkex.io/*` 上で動作する Tampermonkey userscript です。',
    'Linkex Downloader は、`https://disk.linkex.io/*` と `https://l2e.click/d/*`（`www`含む）上で動作する Tampermonkey userscript です。共有ページでは現在URLからshare tokenを自動検出し、自ストレージページでは従来の手入力導線も維持します。',
    'architecture page origins',
)
text = replace_once(
    text,
    '| 認証検出 | Linkex Web が Local Storage に保持する資格情報候補を検出 | `discoverCredentials()` |\n| 共有解析 | 共有URL解析、フォルダ再帰、manifest生成 | `parseShareToken()`, `buildManifest()` |',
    '| 認証検出/橋渡し | `disk.linkex.io` Local Storageの資格情報候補を検出し、access tokenのみ短時間GM bridgeへ同期 | `discoverCredentials()`, `syncCredentialBridgeFromDisk()`, `resolveCredentials()` |\n| Page context | `l2e.click/d/...` の現在share token検出、SPA URL変更時のmanifest guard | `detectSharePageTarget()`, `syncSharePageContext()` |\n| 共有解析 | 共有URL解析、フォルダ再帰、manifest生成 | `parseShareToken()`, `buildManifest()` |',
    'architecture components',
)
text = replace_once(
    text,
    '### `prod.linksvc.xyz`',
    '''### `l2e.click`\n\n- Share Page Mode の操作起点。\n- `/d/<shareToken>` を現在共有として自動検出します。\n- 別originのため `disk.linkex.io` Local Storageは直接読めません。認証済みwriteにはuserscript-privateなGM credential bridgeを使います。\n- URL変更中でも既存Queueの `job.shareToken` は変更しません。\n\n### Credential bridge\n\n- 保存先: GM storage `linkexCredentialBridgeV1`。\n- `disk.linkex.io` で検出したaccess tokenのみ保存し、refresh tokenは保存しません。\n- JWT expiryが利用できる場合はそれ以前、利用できない場合も最大12時間で失効させます。\n- `l2e.click` 側のLocal Storageにあるtokenらしき値はアカウント認証として信用しません。\n- diskページでログアウト状態が確定した場合はbridgeをclearします。\n\n### `prod.linksvc.xyz`''',
    'architecture share page and bridge sections',
)
text = replace_once(
    text,
    '| GM storage | `lastShareUrl` | 最後に入力した共有URL |',
    '| GM storage | `lastShareUrl` | 最後に入力/検出した共有URL |\n| GM storage | `linkexCredentialBridgeV1` | `disk.linkex.io` から共有ページへ短時間橋渡しするaccess token（refresh tokenは保存しない） |',
    'architecture persistence bridge',
)
path.write_text(text, encoding='utf-8')

# --- TROUBLESHOOTING ---
path = Path('docs/TROUBLESHOOTING.md')
text = path.read_text(encoding='utf-8')
text = text.replace('Tampermonkeyで Linkex Downloader v1.0.0 が有効か', 'Tampermonkeyで Linkex Downloader が有効か')
needle = '''認証tokenを手作業でコードへ貼り付けないでください。\n\n## 「このブラウザでは showDirectoryPicker が利用できません」'''
replacement = '''認証tokenを手作業でコードへ貼り付けないでください。\n\n## 共有ページで「Linkex認証連携: 未準備」になる\n\n**症状**\n\n`https://l2e.click/d/...` 上で共有解析はできるが、Queue開始前に認証連携が未準備と表示される。\n\n**原因**\n\n共有ページと自ストレージページは別originです。Downloaderは安全のため `l2e.click` のLocal Storageをアカウント認証として信用せず、`disk.linkex.io` で検出したaccess tokenだけをTampermonkey GM storage経由で短時間橋渡しします。\n\n**対処**\n\n1. `https://disk.linkex.io/` をログイン済み状態で一度開く\n2. 数秒待ってから共有ページへ戻る\n3. 共有ページを再フォーカスするか再読み込みする\n4. **この共有を解析** → Queue開始を再実行する\n\nbridgeはrefresh tokenを保存せず、最大12時間またはJWT expiryの早い方で失効します。期限切れの場合は同じ手順で再準備してください。\n\n## 「このブラウザでは showDirectoryPicker が利用できません」'''
text = replace_once(text, needle, replacement, 'troubleshooting credential bridge')
path.write_text(text, encoding='utf-8')

print('share-page mode patch applied')
