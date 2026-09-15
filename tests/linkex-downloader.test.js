'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {TextEncoder} = require('node:util');

const SOURCE_PATH = 'linkex-downloader.user.js';
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const STARTUP = "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel, {once:true});\n  else createPanel();\n})();";
const EXPOSE = "  globalThis.__linkexTest = {allocateLocalPaths, assertDeleteGuards, downloadOwnedFile, sameOwnedIdentity, LinkexApi, compactDoneTx, createQueueFromManifest, parseShareToken, detectSharePageTarget, isSharePageHost, readCredentialBridge, syncCredentialBridgeFromDisk, resolveCredentials};\n})();";

function loadRuntime({href = 'https://disk.linkex.io/', localStorageEntries = {}} = {}) {
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
    document: {readyState: 'loading', addEventListener() {}},
    GM_getValue(key, fallback) { return storage.has(key) ? storage.get(key) : fallback; },
    GM_setValue(key, value) { storage.set(key, value); },
    GM_xmlhttpRequest() { throw new Error('unexpected GM_xmlhttpRequest in unit test'); },
    fetch: async () => { throw new Error('unexpected fetch'); },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE.replace(STARTUP, EXPOSE), context, {filename: SOURCE_PATH});
  return {api: context.__linkexTest, context, storage};
}

function ownedApi(item) {
  return {
    async listFiles() {
      return {list: [item], pagination: {has_next: false, hasNext: false}};
    },
  };
}

function response({status, length = null, reader = null}) {
  const body = {
    async cancel() {},
    getReader() {
      if (!reader) throw new Error('reader was not configured');
      return reader;
    },
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {get(name) { return name.toLowerCase() === 'content-length' ? length : null; }},
    body,
  };
}

test('long sanitized filename collisions keep a hash suffix inside the 140-char limit', () => {
  const {api} = loadRuntime();
  const common = 'a'.repeat(150);
  const paths = api.allocateLocalPaths([
    {sourceId: '1', name: `${common}A.txt`, remotePath: `${common}A.txt`},
    {sourceId: '2', name: `${common}B.txt`, remotePath: `${common}B.txt`},
  ], 'share');

  const first = paths[0].at(-1);
  const second = paths[1].at(-1);
  assert.notEqual(first.toLowerCase(), second.toLowerCase());
  assert.ok(first.length <= 140);
  assert.ok(second.length <= 140);
  assert.match(second, /__[0-9a-f]{8}\.txt$/);
});

test('new explicit size verification permits a verified zero-byte file', () => {
  const {api} = loadRuntime();
  const state = {
    state: 'LOCAL_COMMITTED',
    confirmedDest: {id: 'd1', name: 'empty.txt', size: 0},
    beforeIds: [],
    download: {destId: 'd1', downloadedBytes: 0, expectedCdnBytes: 0, sizeVerified: true, verifiedAt: Date.now()},
  };
  assert.deepEqual({...api.assertDeleteGuards(state)}, {destId: 'd1', downloaded: 0, expected: 0});
});

test('legacy positive-size LOCAL_COMMITTED state remains compatible, but legacy zero-byte state is not trusted', () => {
  const {api} = loadRuntime();
  const base = {state: 'LOCAL_COMMITTED', confirmedDest: {id: 'd1'}, beforeIds: []};
  assert.doesNotThrow(() => api.assertDeleteGuards({...base, download: {destId: 'd1', downloadedBytes: 10, expectedCdnBytes: 10, verifiedAt: 1}}));
  assert.throws(() => api.assertDeleteGuards({...base, download: {destId: 'd1', downloadedBytes: 0, expectedCdnBytes: 0, verifiedAt: 1}}));
});

test('Range 416 with an already-complete local file commits LOCAL_COMMITTED before returning', async () => {
  const {api, context, storage} = loadRuntime();
  const owned = {id: 'd1', name: 'file.bin', size: 10, url: 'https://cdn.example/file'};
  const state = {state: 'DOWNLOAD_PAUSED', confirmedDest: {id: 'd1', name: 'file.bin', size: 10}, source: {size: 10}};
  const handle = {
    async queryPermission() { return 'granted'; },
    async getFile() { return {size: 10, name: 'file.bin'}; },
  };
  context.fetch = async (_url, options = {}) => {
    if (options.headers?.Range) return response({status: 416, length: null, reader: {async read() { return {done: true}; }}});
    return response({status: 200, length: '10', reader: {async read() { return {done: true}; }}});
  };

  const result = await api.downloadOwnedFile({api: ownedApi(owned), state, handle});
  assert.equal(result.status, 'ALREADY_COMPLETE');
  assert.equal(result.state.state, 'LOCAL_COMMITTED');
  assert.equal(result.state.download.sizeVerified, true);
  assert.equal(result.state.download.expectedCdnBytes, 10);
  assert.equal(storage.get('linkexCopyProbeStateV1').state, 'LOCAL_COMMITTED');
});

test('Content-Length: 0 is a known size and completes as a verified zero-byte download', async () => {
  const {api, context} = loadRuntime();
  const owned = {id: 'd0', name: 'empty.txt', size: 0, url: 'https://cdn.example/empty'};
  const state = {state: 'OWNERSHIP_CONFIRMED', confirmedDest: {id: 'd0', name: 'empty.txt', size: 0}, source: {size: 0}};
  let size = 0;
  const handle = {
    async queryPermission() { return 'granted'; },
    async getFile() { return {size, name: 'empty.txt'}; },
    async createWritable() {
      return {
        async seek() {},
        async truncate(n) { size = n; },
        async write(value) { size += value?.byteLength || 0; },
        async close() {},
      };
    },
  };
  context.fetch = async () => response({status: 200, length: '0', reader: {async read() { return {done: true}; }, async cancel() {}}});

  const result = await api.downloadOwnedFile({api: ownedApi(owned), state, handle});
  assert.equal(result.state.state, 'LOCAL_COMMITTED');
  assert.equal(result.state.download.downloadedBytes, 0);
  assert.equal(result.state.download.expectedCdnBytes, 0);
  assert.equal(result.state.download.sizeVerified, true);
  assert.doesNotThrow(() => api.assertDeleteGuards({...result.state, beforeIds: []}));
});

test('missing Content-Length never becomes LOCAL_COMMITTED', async () => {
  const {api, context, storage} = loadRuntime();
  const owned = {id: 'd1', name: 'file.bin', size: 10, url: 'https://cdn.example/file'};
  const state = {state: 'OWNERSHIP_CONFIRMED', confirmedDest: {id: 'd1', name: 'file.bin', size: 10}, source: {size: 10}};
  const handle = {
    async queryPermission() { return 'granted'; },
    async getFile() { return {size: 0, name: 'file.bin'}; },
  };
  context.fetch = async () => response({status: 200, length: null, reader: {async read() { return {done: true}; }}});

  await assert.rejects(() => api.downloadOwnedFile({api: ownedApi(owned), state, handle}), error => error?.kind === 'protocol');
  assert.notEqual(storage.get('linkexCopyProbeStateV1')?.state, 'LOCAL_COMMITTED');
});

test('download refuses a destId whose identity changed after ownership confirmation', async () => {
  const {api, context} = loadRuntime();
  const changed = {id: 'd1', name: 'renamed.bin', size: 10, url: 'https://cdn.example/file'};
  const state = {state: 'OWNERSHIP_CONFIRMED', confirmedDest: {id: 'd1', name: 'file.bin', size: 10}, source: {size: 10}};
  const handle = {
    async queryPermission() { return 'granted'; },
    async getFile() { return {size: 0, name: 'file.bin'}; },
  };
  let fetched = false;
  context.fetch = async () => { fetched = true; throw new Error('must not fetch CDN after identity change'); };

  await assert.rejects(() => api.downloadOwnedFile({api: ownedApi(changed), state, handle}), error => error?.kind === 'ownership_lost');
  assert.equal(fetched, false);
});

test('queue start and resume acquire the lease before shared Queue mutations', () => {
  const startAt = SOURCE.indexOf('async function startManifestQueue(');
  const resumeAt = SOURCE.indexOf("resumeBtn.addEventListener('click'", startAt);
  const pauseAt = SOURCE.indexOf("pauseBtn.addEventListener('click'", resumeAt);
  assert.ok(startAt > 0 && resumeAt > startAt && pauseAt > resumeAt);

  const startBlock = SOURCE.slice(startAt, resumeAt);
  assert.ok(startBlock.indexOf('await acquireLease();') >= 0);
  assert.ok(startBlock.indexOf('await acquireLease();') < startBlock.indexOf('saveQueueJob(job);'));

  const resumeBlock = SOURCE.slice(resumeAt, pauseAt);
  assert.ok(resumeBlock.indexOf('await acquireLease();') >= 0);
  assert.ok(resumeBlock.indexOf('await acquireLease();') < resumeBlock.indexOf('job.stopRequested = false;'));
  assert.ok(resumeBlock.indexOf('await acquireLease();') < resumeBlock.lastIndexOf('const job = loadQueueJob();'));
});

test('runJob itself no longer acquires or releases the lease', () => {
  const runAt = SOURCE.indexOf('async function runJob(job, queueRoot, resume=false)');
  const startAt = SOURCE.indexOf('async function startManifestQueue(', runAt);
  const block = SOURCE.slice(runAt, startAt);
  assert.doesNotMatch(block, /await acquireLease\(\)/);
  assert.doesNotMatch(block, /releaseLease\(\)/);
  assert.match(block, /assertLease\(\)/);
});

test('read-only GET retries HTTP 429 and honors an immediate Retry-After', async () => {
  const {api, context} = loadRuntime();
  let calls = 0;
  context.GM_xmlhttpRequest = options => {
    calls += 1;
    if (calls === 1) {
      options.onload({status: 429, response: {code: 429, message: 'rate limited'}, responseHeaders: 'Retry-After: 0\r\n'});
    } else {
      options.onload({status: 200, response: {code: 0, data: {ok: true}}, responseHeaders: ''});
    }
  };
  const client = new api.LinkexApi({lang: 'en'});
  const result = await client.getShare('abcde');
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test('write request is never automatically retried on 5xx', async () => {
  const {api, context} = loadRuntime();
  let calls = 0;
  context.GM_xmlhttpRequest = options => {
    calls += 1;
    options.onload({status: 503, response: {code: 503, message: 'unavailable'}, responseHeaders: ''});
  };
  const client = new api.LinkexApi({token: 'token', lang: 'en'});
  await assert.rejects(() => client.copySharedFile({shareToken: 'abcde', sourceId: 'source-1'}), error => error?.status === 503);
  assert.equal(calls, 1);
});

test('DONE transaction compaction drops reconciliation snapshots and signed URL data', () => {
  const {api} = loadRuntime();
  const compact = api.compactDoneTx({
    schemaVersion: 1,
    operationId: 'op-1',
    state: 'DONE',
    source: {sourceId: 's1', name: 'file.bin', size: 10},
    beforeIds: ['old-1', 'old-2'],
    candidates: [{id: 'other'}],
    copyResponse: {task_id: 'task'},
    confirmedDest: {id: 'd1', name: 'file.bin', size: 10, url: 'https://signed.example/?token=secret'},
    download: {destId: 'd1', downloadedBytes: 10, expectedCdnBytes: 10, sizeVerified: true, verifiedAt: 123, localName: 'file.bin'},
    delete: {destId: 'd1', confirmedAbsentAt: 456, response: {large: true}},
    startedAt: 1,
    reconciledAt: 2,
    queueJobId: 'job-1',
    queueIndex: 0,
  });
  assert.equal(compact.state, 'DONE');
  assert.equal(compact.confirmedDest.id, 'd1');
  assert.equal(compact.confirmedDest.url, undefined);
  assert.equal(compact.beforeIds, undefined);
  assert.equal(compact.candidates, undefined);
  assert.equal(compact.copyResponse, undefined);
  assert.equal(compact.delete.response, undefined);
  assert.equal(compact.download.sizeVerified, true);
});

test('safe Queue discard is local-state-only and never calls Linkex delete', () => {
  const helperAt = SOURCE.indexOf('async function abandonQueueJob(job)');
  const nextAt = SOURCE.indexOf('function resetRetryableSkips(job)', helperAt);
  assert.ok(helperAt > 0 && nextAt > helperAt);
  const helper = SOURCE.slice(helperAt, nextAt);
  assert.doesNotMatch(helper, /deleteSingleFile|\/file\/delete|LinkexApi/);
  assert.match(helper, /GM_setValue\(QUEUE_KEY, null\)/);
  assert.match(SOURCE, /id="lf-abandon"/);
});

test('selected Queue contains only requested manifest indexes and recalculates total bytes', () => {
  const {api} = loadRuntime();
  const manifest = {
    shareToken: 'share-token',
    shareName: 'sample',
    totalBytes: 60,
    files: [
      {sourceId: 'a', name: 'a.bin', size: 10, remotePath: 'a.bin'},
      {sourceId: 'b', name: 'b.bin', size: 20, remotePath: 'folder/b.bin'},
      {sourceId: 'c', name: 'c.bin', size: 30, remotePath: 'c.bin'},
    ],
  };
  const selected = api.createQueueFromManifest(manifest, [1]);
  assert.equal(selected.selectionMode, 'selected');
  assert.equal(selected.sourceOriginalCount, 3);
  assert.equal(selected.items.length, 1);
  assert.equal(selected.items[0].manifestIndex, 1);
  assert.equal(selected.items[0].source.sourceId, 'b');
  assert.equal(selected.sourceTotalBytes, 20);

  const all = api.createQueueFromManifest(manifest);
  assert.equal(all.selectionMode, 'all');
  assert.equal(all.items.length, 3);
  assert.equal(all.sourceTotalBytes, 60);
});

test('selected Queue rejects an empty selection', () => {
  const {api} = loadRuntime();
  const manifest = {shareToken:'share-token', shareName:'sample', totalBytes:10, files:[{sourceId:'a', name:'a.bin', size:10, remotePath:'a.bin'}]};
  assert.throws(() => api.createQueueFromManifest(manifest, []), error => error?.kind === 'selection');
});

test('panel is constrained to the viewport and its body scrolls instead of escaping the screen', () => {
  assert.match(SOURCE, /width:min\(540px, calc\(100vw - 24px\)\)/);
  assert.match(SOURCE, /max-height:calc\(100dvh - 24px\)/);
  assert.match(SOURCE, /#linkex-full-queue \.box \{[^\n]*display:flex; flex-direction:column;/);
  assert.match(SOURCE, /#linkex-full-queue \.body \{[^\n]*overflow-y:auto;[^\n]*min-height:0;/);
});

test('safe pause controls the active in-memory Queue and is enabled while runJob is active', () => {
  assert.match(SOURCE, /let activeRunJob = null;/);

  const refreshAt = SOURCE.indexOf('function refreshQueueUi()');
  const collapseAt = SOURCE.indexOf("collapseBtn.addEventListener('click'", refreshAt);
  assert.ok(refreshAt > 0 && collapseAt > refreshAt);
  const refreshBlock = SOURCE.slice(refreshAt, collapseAt);
  assert.match(refreshBlock, /pauseBtn\.disabled = !running \|\| !activeRunJob \|\| !!activeRunJob\.stopRequested;/);

  const runAt = SOURCE.indexOf('async function runJob(job, queueRoot, resume=false)');
  const startAt = SOURCE.indexOf('async function startManifestQueue(', runAt);
  assert.ok(runAt > 0 && startAt > runAt);
  const runBlock = SOURCE.slice(runAt, startAt);
  assert.ok(runBlock.indexOf('activeRunJob = job;') >= 0);
  assert.ok(runBlock.indexOf('activeRunJob = job;') < runBlock.indexOf('await processQueue('));
  assert.ok(runBlock.indexOf('refreshQueueUi();') < runBlock.indexOf('await processQueue('));
  assert.match(runBlock, /finally \{\s*activeRunJob = null;\s*refreshQueueUi\(\);\s*\}/);

  const pauseAt = SOURCE.indexOf("pauseBtn.addEventListener('click'", startAt);
  const retryAt = SOURCE.indexOf("retryBtn.addEventListener('click'", pauseAt);
  assert.ok(pauseAt > startAt && retryAt > pauseAt);
  const pauseBlock = SOURCE.slice(pauseAt, retryAt);
  assert.match(pauseBlock, /const job = activeRunJob;/);
  assert.match(pauseBlock, /job\.stopRequested = true;/);
  assert.doesNotMatch(pauseBlock, /const job = loadQueueJob\(\);/);
});



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
  assert.match(SOURCE, /analyzeBtn\.textContent = 'この共有を再解析'/);
  assert.match(SOURCE, /if \(onShareHost && !running && !preparing && manifest && manifest\.shareToken !== nextToken\)/);
  assert.match(SOURCE, /Queue実行中に共有ページURLが変わりました。実行中Queueは作成時のshareTokenを維持します。/);
  assert.match(SOURCE, /const creds = resolveCredentials\(\);/);
  assert.match(SOURCE, /await ensureCopyOwned\(api, job, i, onStatus\);[\s\S]*await ensureDownloaded\(api, job, i, queueRoot, onStatus\);[\s\S]*await ensureDeleted\(api, job, i, onStatus\);/);
});


test('share-page start rechecks the current token and Queue completion resynchronizes stale page context', () => {
  const startAt = SOURCE.indexOf('async function startManifestQueue(');
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


test('compact first screen centers quick all-download and file selection while advanced controls live under details', () => {
  assert.match(SOURCE, /id="lf-start" class="primary action-main" disabled>すべてダウンロード<\/button>/);
  assert.match(SOURCE, /id="lf-select-mode" class="secondary action-secondary" disabled>ファイルを選ぶ<\/button>/);
  const detailsAt = SOURCE.indexOf('<details id="lf-more" class="more">');
  const detailsEnd = SOURCE.indexOf('</details>', detailsAt);
  assert.ok(detailsAt > 0 && detailsEnd > detailsAt);
  const detailsBlock = SOURCE.slice(detailsAt, detailsEnd);
  for (const id of ['lf-destination', 'lf-analyze', 'lf-selftest', 'lf-export', 'lf-refresh', 'lf-retry', 'lf-abandon']) {
    assert.match(detailsBlock, new RegExp(`id="${id}"`));
  }
});

test('preferred download directory is separate from Queue-specific handles and is preloaded before quick actions enable', () => {
  assert.match(SOURCE, /const PREFERRED_DIR_HANDLE_KEY = 'preferred-download-root:v1';/);
  assert.match(SOURCE, /const QUEUE_HANDLE_PREFIX = 'queue-full:';/);
  assert.match(SOURCE, /idbPutHandle\(PREFERRED_DIR_HANDLE_KEY, handle\)/);
  assert.match(SOURCE, /void refreshPreferredDirectoryState\(\{reloadHandle:true\}\)/);
  const refreshAt = SOURCE.indexOf('function refreshQueueUi()');
  const collapseAt = SOURCE.indexOf("collapseBtn.addEventListener('click'", refreshAt);
  const block = SOURCE.slice(refreshAt, collapseAt);
  assert.match(block, /startBtn\.disabled = busy \|\| !!active \|\| !hasShareInput \|\| !preferredHandleReady;/);
});

test('quick all-download resolves directory permission before network manifest analysis and starts without confirm', () => {
  const quickAt = SOURCE.indexOf("startBtn.addEventListener('click', async () => {");
  const selectAt = SOURCE.indexOf("selectModeBtn.addEventListener('click'", quickAt);
  assert.ok(quickAt > 0 && selectAt > quickAt);
  const block = SOURCE.slice(quickAt, selectAt);
  const dirAt = block.indexOf('await acquirePreferredBaseDirFromGesture()');
  const analyzeAt = block.indexOf('await analyzeCurrentShare({announceSuccess:false})');
  const startAt = block.indexOf('await startManifestQueue(null, {baseDir, skipConfirm:true})');
  assert.ok(dirAt >= 0 && analyzeAt > dirAt && startAt > analyzeAt);
  assert.doesNotMatch(block, /confirm\(/);
});

test('preferred directory picker branch has no network or IndexedDB await before showDirectoryPicker', () => {
  const helperAt = SOURCE.indexOf('async function acquirePreferredBaseDirFromGesture');
  const nextAt = SOURCE.indexOf('function shortShareToken', helperAt);
  assert.ok(helperAt > 0 && nextAt > helperAt);
  const block = SOURCE.slice(helperAt, nextAt);
  const pickerAt = block.indexOf("await invokeDirectoryPicker({mode:'readwrite'})");
  assert.ok(pickerAt > 0);
  const beforePicker = block.slice(0, pickerAt);
  assert.doesNotMatch(beforePicker, /buildManifest|idbGetHandle|GM_xmlhttpRequest|LinkexApi/);
});

test('selection UI stays collapsed after analysis until explicit file-selection mode', () => {
  assert.match(SOURCE, /let selectionExpanded = false;/);
  assert.match(SOURCE, /selectionPanel\.hidden = !hasManifest \|\| !selectionExpanded;/);
  const selectAt = SOURCE.indexOf("selectModeBtn.addEventListener('click'");
  const selectedStartAt = SOURCE.indexOf("selectedStartBtn.addEventListener('click'", selectAt);
  const block = SOURCE.slice(selectAt, selectedStartAt);
  assert.match(block, /selectionExpanded = true;/);
});

test('Queue resume remains bound to its Queue-specific directory handle, never the preferred new-Queue destination', () => {
  const resumeAt = SOURCE.indexOf("resumeBtn.addEventListener('click'");
  const pauseAt = SOURCE.indexOf("pauseBtn.addEventListener('click'", resumeAt);
  const block = SOURCE.slice(resumeAt, pauseAt);
  assert.match(block, /const queueRoot = await getQueueRootHandle\(job\);/);
  assert.doesNotMatch(block, /PREFERRED_DIR_HANDLE_KEY|preferredBaseDirHandle/);
});
