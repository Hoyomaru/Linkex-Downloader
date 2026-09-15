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
const EXPOSE = "  globalThis.__linkexTest = {allocateLocalPaths, assertDeleteGuards, downloadOwnedFile, sameOwnedIdentity, LinkexApi, compactDoneTx};\n})();";

function loadRuntime() {
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
  const startAt = SOURCE.indexOf("startBtn.addEventListener('click'");
  const resumeAt = SOURCE.indexOf("resumeBtn.addEventListener('click'");
  const pauseAt = SOURCE.indexOf("pauseBtn.addEventListener('click'");
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
  const startAt = SOURCE.indexOf("startBtn.addEventListener('click'", runAt);
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
