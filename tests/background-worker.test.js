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

test('Worker signals stream-ready only after first body chunk or clean zero-byte EOF', () => {
  const start = SOURCE.indexOf('function detachedDownloadWorkerBootstrap()');
  const end = SOURCE.indexOf('function resolveDownloadWorkerConstructor', start);
  const worker = SOURCE.slice(start, end);
  const readAt = worker.indexOf('const {done, value} = await reader.read()');
  const readyAt = worker.indexOf("type:'stream-ready'", readAt);
  assert.ok(readAt > 0 && readyAt > readAt);
  assert.match(worker, /firstChunkBytes:value\.byteLength/);
  assert.match(worker, /firstChunkBytes:0, eof:true/);

  const bridgeStart = SOURCE.indexOf('async function downloadOwnedFileInWorker');
  const bridgeEnd = SOURCE.indexOf('async function downloadOwnedFile({api, state, handle', bridgeStart);
  const bridge = SOURCE.slice(bridgeStart, bridgeEnd);
  assert.match(bridge, /data\.type === 'stream-ready'/);
  assert.match(bridge, /phase:'stream-ready'/);
});

test('inline fallback exposes the same stream-ready barrier', () => {
  const start = SOURCE.indexOf('async function downloadOwnedFile({api, state, handle');
  const end = SOURCE.indexOf('// --- I: destructive action guard', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /let streamReadySignaled = false;/);
  assert.match(block, /phase:'stream-ready'/);
  assert.match(block, /firstChunkBytes:value\.byteLength/);
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
  assert.match(block, /'worker_unavailable','worker_start','worker_filesystem','range_416','network'/);
  assert.match(block, /falling back to inline transfer/);
  assert.match(block, /if \(res\.status === 416\)/);
});

test('Worker-only filesystem restrictions are classified for inline fallback', () => {
  const start = SOURCE.indexOf('function detachedDownloadWorkerBootstrap()');
  const end = SOURCE.indexOf('function resolveDownloadWorkerConstructor', start);
  const worker = SOURCE.slice(start, end);
  assert.match(worker, /NotAllowedError/);
  assert.match(worker, /SecurityError/);
  assert.match(worker, /worker_filesystem/);
});

test('Web Worker object URL is generated from a self-contained bootstrap function', () => {
  assert.match(SOURCE, /detachedDownloadWorkerBootstrap\.toString\(\)/);
  assert.match(SOURCE, /URL\.createObjectURL\(new Blob/);
  assert.match(SOURCE, /worker\.postMessage\(\{/);
  assert.match(SOURCE, /handle,/);
});
