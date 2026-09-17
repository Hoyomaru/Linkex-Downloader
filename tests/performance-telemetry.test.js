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
const EXPOSE = "  globalThis.__perfTest = {perfPhaseStart, perfPhaseEnd, perfPhaseSet, buildPerformanceSummary};\n})();";

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
  return context.__perfTest;
}

test('performance phase helpers preserve start time and calculate duration', () => {
  const api = loadRuntime();
  let tx = {operationId:'op-1'};
  tx = api.perfPhaseStart(tx, 'copy', 1000);
  tx = api.perfPhaseStart(tx, 'copy', 1200);
  tx = api.perfPhaseEnd(tx, 'copy', 1600, {outcome:'ok'});
  assert.equal(tx.performance.copy.startedAt, 1000);
  assert.equal(tx.performance.copy.endedAt, 1600);
  assert.equal(tx.performance.copy.durationMs, 600);
  assert.equal(tx.performance.copy.outcome, 'ok');
});

test('performance summary aggregates phase timing and transfer throughput', () => {
  const api = loadRuntime();
  const MiB = 1024 * 1024;
  const job = {items:[
    {state:'DONE', tx:{state:'DONE', download:{telemetry:{durationMs:1000, transferredBytes:10*MiB, peakBytesPerSecond:20*MiB}}, performance:{
      copy:{durationMs:10}, ownershipReconcile:{durationMs:20}, download:{durationMs:1100},
      verify:{durationMs:5}, delete:{durationMs:7}, total:{durationMs:1142}
    }}},
    {state:'DONE', tx:{state:'DONE', download:{telemetry:{durationMs:500, transferredBytes:5*MiB, peakBytesPerSecond:12*MiB}}, performance:{
      copy:{durationMs:11}, ownershipReconcile:{durationMs:21}, download:{durationMs:600},
      verify:{durationMs:6}, delete:{durationMs:8}, total:{durationMs:646}
    }}}
  ]};
  const summary = api.buildPerformanceSummary(job);
  assert.equal(summary.completedTransactions, 2);
  assert.equal(summary.measuredTransactions, 2);
  assert.equal(summary.transferredBytes, 15*MiB);
  assert.equal(summary.phaseMs.download, 1700);
  assert.equal(summary.measuredTransferMs, 1500);
  assert.equal(summary.aggregateDownloadMBps, 10);
  assert.equal(summary.peakBytesPerSecond, 20*MiB);
});
