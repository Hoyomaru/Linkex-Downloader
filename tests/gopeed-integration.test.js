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
const EXPOSE = "  globalThis.__gopeedTest = {normalizeGopeedBaseUrl, buildGopeedTaskPayload, compactGopeedTask, buildExternalPerformanceSummary};\n})();";

function loadRuntime() {
  assert.ok(SOURCE.includes(STARTUP), 'test harness could not find userscript startup block');
  const storage = new Map();
  const context = {
    console, TextEncoder, URL, URLSearchParams, Uint8Array, AbortController, Blob,
    setTimeout, clearTimeout, setInterval, clearInterval, crypto:webcrypto,
    navigator:{language:'ja-JP'}, location:new URL('https://disk.linkex.io/'),
    localStorage:{length:0,key(){return null;},getItem(){return null;}},
    atob(value) { return Buffer.from(String(value), 'base64').toString('binary'); },
    window:{}, unsafeWindow:{}, document:{readyState:'loading', addEventListener(){}},
    GM_getValue(key, fallback) { return storage.has(key) ? storage.get(key) : fallback; },
    GM_setValue(key, value) { storage.set(key, value); },
    GM_xmlhttpRequest() { throw new Error('unexpected GM_xmlhttpRequest'); },
    fetch:async () => { throw new Error('unexpected fetch'); },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE.replace(STARTUP, EXPOSE), context, {filename:SOURCE_PATH});
  return context.__gopeedTest;
}

test('Tampermonkey grants explicit loopback hosts for Gopeed', () => {
  assert.match(SOURCE, /@connect\s+localhost/);
  assert.match(SOURCE, /@connect\s+127\.0\.0\.1/);
  assert.doesNotMatch(SOURCE, /@connect\s+\*/);
});

test('Gopeed endpoint accepts loopback HTTP only', () => {
  const api = loadRuntime();
  assert.equal(api.normalizeGopeedBaseUrl('http://127.0.0.1:9999/'), 'http://127.0.0.1:9999');
  assert.equal(api.normalizeGopeedBaseUrl('http://localhost:9999'), 'http://localhost:9999');
  assert.throws(() => api.normalizeGopeedBaseUrl('https://127.0.0.1:9999'));
  assert.throws(() => api.normalizeGopeedBaseUrl('http://192.168.1.10:9999'));
  assert.throws(() => api.normalizeGopeedBaseUrl('http://127.0.0.1:9999/api'));
});

test('Gopeed task payload uses v1.9.3 opts and operation label', () => {
  const api = loadRuntime();
  const payload = api.buildGopeedTaskPayload({
    url:'https://cdn.example/file?sign=secret',
    name:'movie.mp4',
    operationId:'queue-op-test',
    connections:16
  });
  assert.equal(payload.opts.name, 'movie.mp4');
  assert.equal(payload.opts.extra.connections, 16);
  assert.equal(payload.req.labels.linkexOperationId, 'queue-op-test');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'opt'), false);
});

test('Gopeed completion cannot enter browser deletion gate', () => {
  const start = SOURCE.indexOf('async function processGopeedQueue');
  const end = SOURCE.indexOf('async function ensureDownloaded', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /EXTERNAL_COMPLETE_UNVERIFIED/);
  assert.doesNotMatch(block, /state:'LOCAL_COMMITTED'/);
  assert.doesNotMatch(block, /ensureDeleted\s*\(/);
  assert.match(block, /linkexAutoDelete:false/);
});

test('Gopeed persisted submit intent reconciles before any new POST', () => {
  const start = SOURCE.indexOf('async function processGopeedQueue');
  const end = SOURCE.indexOf('async function ensureDownloaded', start);
  const block = SOURCE.slice(start, end);
  const recoveryAt = block.indexOf("tx.state === 'GOPEED_SUBMIT_INTENT'");
  const postAt = block.indexOf('await client.createTask(payload)');
  assert.ok(recoveryAt >= 0 && postAt > recoveryAt);
  const recoveryBlock = block.slice(recoveryAt, postAt);
  assert.match(recoveryBlock, /reconcileGopeedSubmission\(client, operationId\)/);
  assert.match(recoveryBlock, /POST intentの送信結果を確定できません。自動再送しません。/);
});

test('Gopeed client exposes no task DELETE operation', () => {
  const start = SOURCE.indexOf('class GopeedClient');
  const end = SOURCE.indexOf('function buildGopeedTaskPayload', start);
  const block = SOURCE.slice(start, end);
  assert.doesNotMatch(block, /request\(['"]DELETE/);
  assert.doesNotMatch(block, /deleteTask/);
});

test('external performance is explicitly unverified and non-destructive', () => {
  const api = loadRuntime();
  const job = {
    kind:'gopeed-external',
    external:{connections:16, engineVersion:'1.9.3'},
    items:[{tx:{external:{gopeed:{
      taskId:'task-1',
      submittedAt:1000,
      runningStartedAt:1100,
      completedAt:2100,
      downloadedBytes:10*1024*1024,
      peakBytesPerSecond:20*1024*1024,
      task:{status:'done',progress:{downloaded:10*1024*1024}}
    }}}}]
  };
  const summary = api.buildExternalPerformanceSummary(job);
  assert.equal(summary.averageDownloadMBps, 10);
  assert.equal(summary.localVerified, false);
  assert.equal(summary.linkexAutoDelete, false);
});

test('Gopeed UI requires exactly one selected file and no browser directory handle', () => {
  assert.match(SOURCE, /selectedIndexes\.size !== 1/);
  const start = SOURCE.indexOf('async function startGopeedSelected');
  const end = SOURCE.indexOf('async function startManifestQueue', start);
  const block = SOURCE.slice(start, end);
  assert.doesNotMatch(block, /invokeDirectoryPicker/);
  assert.doesNotMatch(block, /getQueueRootHandle/);
  assert.match(block, /await runJob\(job, null, false\)/);
});
