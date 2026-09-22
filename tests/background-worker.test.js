'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SOURCE = fs.readFileSync('linkex-downloader.user.js', 'utf8');

test('primary detached downloads prefer a Web Worker but recovery-probe interruptions stay inline', () => {
  assert.match(SOURCE, /function canUseDetachedDownloadWorker/);
  assert.match(SOURCE, /!!detachedUrl/);
  assert.match(SOURCE, /interruptAfterBytes/);
  assert.match(SOURCE, /typeof globalThis\.Worker === 'function'/);

  const start = SOURCE.indexOf('async function downloadOwnedFile({api, state, handle');
  const end = SOURCE.indexOf('// --- I: destructive action guard', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /canUseDetachedDownloadWorker\(\{detachedUrl, interruptAfterBytes\}\)/);
  assert.match(block, /return await downloadOwnedFileInWorker/);
});

test('download worker owns fetch, stream buffering, and FileSystem writable I/O', () => {
  const start = SOURCE.indexOf('function detachedDownloadWorkerBootstrap()');
  const end = SOURCE.indexOf('function canUseDetachedDownloadWorker', start);
  assert.ok(start > 0 && end > start);
  const worker = SOURCE.slice(start, end);
  assert.match(worker, /await fetch\(String\(url\)/);
  assert.match(worker, /res\.body\.getReader\(\)/);
  assert.match(worker, /handle\.createWritable/);
  assert.match(worker, /await writable\.write\(batch\)/);
  assert.match(worker, /type:'checkpoint'/);
  assert.match(worker, /type:'progress'/);
  assert.match(worker, /type:'done'/);
});

test('worker checkpoints are persisted on the main side and errors preserve partial size', () => {
  const start = SOURCE.indexOf('async function downloadOwnedFileInWorker');
  const end = SOURCE.indexOf('async function downloadOwnedFile({api, state, handle', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /data\.type === 'checkpoint'/);
  assert.match(block, /saveProbeState/);
  assert.match(block, /state:'DOWNLOAD_PAUSED'/);
  assert.match(block, /downloadedBytes:Number\(partial\.size \|\| 0\)/);
  assert.match(block, /worker:true/);
});

test('worker startup and Range-416 compatibility failures fall back to proven inline downloader', () => {
  const start = SOURCE.indexOf('async function downloadOwnedFile({api, state, handle');
  const end = SOURCE.indexOf('// --- I: destructive action guard', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /'worker_unavailable','worker_start','range_416'/);
  assert.match(block, /falling back to inline transfer/);
  assert.match(block, /if \(res\.status === 416\)/);
});

test('Web Worker object URL is generated from a self-contained bootstrap function', () => {
  assert.match(SOURCE, /detachedDownloadWorkerBootstrap\.toString\(\)/);
  assert.match(SOURCE, /URL\.createObjectURL\(new Blob/);
  assert.match(SOURCE, /worker\.postMessage\(\{/);
  assert.match(SOURCE, /handle,/);
});
