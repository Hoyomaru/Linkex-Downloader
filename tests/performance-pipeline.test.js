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
const EXPOSE = "  globalThis.__pipelineTest = {saveProbeState, loadProbeState, clearProbeState, createAsyncSemaphore};\n})();";

function loadRuntime() {
  assert.ok(SOURCE.includes(STARTUP), 'test harness could not find userscript startup block');
  const storage = new Map();
  const context = {
    console,
    TextEncoder,
    URL,
    URLSearchParams,
    Uint8Array,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto:webcrypto,
    navigator:{language:'ja-JP'},
    location:new URL('https://disk.linkex.io/'),
    localStorage:{length:0,key(){return null;},getItem(){return null;}},
    atob(value) { return Buffer.from(String(value), 'base64').toString('binary'); },
    window:{},
    unsafeWindow:{},
    document:{readyState:'loading', addEventListener(){}},
    GM_getValue(key, fallback) { return storage.has(key) ? storage.get(key) : fallback; },
    GM_setValue(key, value) { storage.set(key, value); },
    GM_xmlhttpRequest() { throw new Error('unexpected GM_xmlhttpRequest'); },
    fetch:async () => { throw new Error('unexpected fetch'); },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE.replace(STARTUP, EXPOSE), context, {filename:SOURCE_PATH});
  return context.__pipelineTest;
}

test('pipeline configuration is COPY=1 / DOWNLOAD=2 / DELETE=1 and bounded', () => {
  assert.match(SOURCE, /const PIPELINE_DOWNLOAD_WORKERS = 2;/);
  assert.match(SOURCE, /const PIPELINE_DELETE_WORKERS = 1;/);
  assert.match(SOURCE, /const PIPELINE_MAX_IN_FLIGHT = 3;/);
  assert.match(SOURCE, /const downloadSlots = createAsyncSemaphore\(PIPELINE_DOWNLOAD_WORKERS\);/);
  assert.match(SOURCE, /const deleteSlots = createAsyncSemaphore\(PIPELINE_DELETE_WORKERS\);/);
  assert.match(SOURCE, /await ensureCopyOwned\(api, job, i, onStatus, \{capacityReserved:!!reservation\}\);/);
});

test('download probe state is operation-scoped rather than a shared worker slot', () => {
  assert.match(SOURCE, /const PROBE_KEY_PREFIX = 'linkexCopyProbeStateV2:';/);
  assert.equal((SOURCE.match(/loadProbeState\(\)/g) || []).length, 1, 'only the legacy cleanup call may use empty parentheses');
  const api = loadRuntime();
  api.saveProbeState({operationId:'op-a', state:'DOWNLOADING', download:{downloadedBytes:11}});
  api.saveProbeState({operationId:'op-b', state:'DOWNLOADING', download:{downloadedBytes:22}});
  assert.equal(api.loadProbeState('op-a').download.downloadedBytes, 11);
  assert.equal(api.loadProbeState('op-b').download.downloadedBytes, 22);
  api.clearProbeState('op-a');
  assert.equal(api.loadProbeState('op-a'), null);
  assert.equal(api.loadProbeState('op-b').download.downloadedBytes, 22);
});

test('capacity uses a local reservation ledger and refreshes usage only when it would block', () => {
  assert.match(SOURCE, /async function createCapacityReservation\(api\)/);
  const start = SOURCE.indexOf('async function createCapacityReservation(api)');
  const end = SOURCE.indexOf('function loadQueueJob()', start);
  const block = SOURCE.slice(start, end);
  const shortageAt = block.indexOf('if (needed > availableBytes');
  const refreshAt = block.indexOf('const usage = await api.getUsage()', shortageAt);
  assert.ok(shortageAt > 0 && refreshAt > shortageAt);
  assert.equal((block.match(/api\.getUsage\(\)/g) || []).length, 2, 'one initial usage request plus shortage refresh');
  assert.match(SOURCE, /reservation = await capacity\.reserve\(item\.source\?\.size \|\| 0\);/);
  assert.match(SOURCE, /capacity\.release\(reservation \|\| Number\(item\.source\?\.size \|\| 0\)\);/);
});

test('delete safety gate remains LOCAL_COMMITTED and one confirmed destId only', () => {
  assert.match(SOURCE, /state\.state !== 'LOCAL_COMMITTED'/);
  assert.match(SOURCE, /collection:\{select_all:false, file_ids:\[id\]\}/);
  assert.match(SOURCE, /if \(String\(state\.download\?\.destId \|\| ''\) !== destId\)/);
  assert.match(SOURCE, /if \(!Number\(state\.download\?\.verifiedAt \|\| 0\)\)/);
});

test('semaphore blocks work beyond the configured permit count', async () => {
  const api = loadRuntime();
  const sem = api.createAsyncSemaphore(2);
  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  let acquiredThird = false;
  const third = sem.acquire().then(release => { acquiredThird = true; release(); });
  await Promise.resolve();
  assert.equal(acquiredThird, false);
  r1();
  await third;
  assert.equal(acquiredThird, true);
  r2();
});


test('pause or fatal observed during capacity recheck prevents a new COPY', () => {
  const reserveAt = SOURCE.indexOf('reservation = await capacity.reserve(item.source?.size || 0);');
  const guardAt = SOURCE.indexOf('if (fatalError || job.stopRequested) {', reserveAt);
  const copyAt = SOURCE.indexOf('await ensureCopyOwned(api, job, i, onStatus, {capacityReserved:!!reservation});', reserveAt);
  assert.ok(reserveAt > 0 && guardAt > reserveAt && copyAt > guardAt);
  const block = SOURCE.slice(guardAt, copyAt);
  assert.match(block, /if \(reservation\) capacity\.release\(reservation\);/);
  assert.match(block, /releaseInFlight\(\);/);
});
