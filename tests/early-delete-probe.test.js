'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SOURCE = fs.readFileSync('linkex-downloader.user.js', 'utf8');

test('normal production delete guard still requires LOCAL_COMMITTED', () => {
  const start = SOURCE.indexOf('function assertDeleteGuards(state)');
  const end = SOURCE.indexOf('function sameOwnedIdentity', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /state !== 'LOCAL_COMMITTED'/);
  assert.match(block, /verifiedAt/);
});

test('early-delete bypass is isolated to one-file probe kind and proven-new destId', () => {
  const start = SOURCE.indexOf('function assertEarlyDeleteProbeGuards');
  const end = SOURCE.indexOf('async function deleteOwnedTempForEarlyDeleteProbe', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /job\?\.kind !== 'early-delete-probe'/);
  assert.match(block, /job\.items\?\.length !== 1/);
  assert.match(block, /beforeIds\.map\(String\)\.includes\(destId\)/);
  assert.match(block, /confirmedDest\?\.id/);
});

test('probe opens stream before experimental delete and tests fresh + Range requests after confirmed delete', () => {
  const start = SOURCE.indexOf('async function processEarlyDeleteProbe');
  const end = SOURCE.indexOf('async function ensureDeleted', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  const initialFetch = block.indexOf("await fetch(signedUrl");
  const deleteCall = block.indexOf('await deleteOwnedTempForEarlyDeleteProbe');
  const consume = block.indexOf('await consumeProbeStreamToEof');
  const fresh = block.indexOf('await probeSignedUrlRequest(signedUrl)');
  const range = block.indexOf('await probeSignedUrlRequest(signedUrl, {rangeOffset})');
  assert.ok(initialFetch >= 0 && deleteCall > initialFetch);
  assert.ok(consume > deleteCall);
  assert.ok(fresh > consume);
  assert.ok(range > fresh);
  assert.match(block, /status === 206/);
  assert.match(block, /FULL_PASS/);
});

test('experimental DELETE still uses existing single-file API and uncertain result is not replayed', () => {
  const apiStart = SOURCE.indexOf('deleteSingleFile(fileId)');
  const apiEnd = SOURCE.indexOf('parseShareToken', apiStart);
  const apiBlock = SOURCE.slice(apiStart, apiEnd);
  assert.match(apiBlock, /select_all:false, file_ids:\[id\]/);

  const start = SOURCE.indexOf('async function deleteOwnedTempForEarlyDeleteProbe');
  const end = SOURCE.indexOf('async function readProbeFirstChunk', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /DELETE POST再送: NO/);
  assert.match(block, /reconcileDelete\(api, tx/);
  const uncertainAt = block.indexOf("'PROBE_DELETE_UNCERTAIN'");
  const sendAt = block.indexOf('api.deleteSingleFile');
  assert.ok(uncertainAt >= 0 && sendAt > uncertainAt);
});

test('probe URL is memory-only and support bundle exports results separately', () => {
  assert.match(SOURCE, /const signedUrl = owned\.url;/);
  assert.doesNotMatch(SOURCE, /probe:\{[^}]*signedUrl/s);
  assert.match(SOURCE, /earlyDeleteProbe: redactForExport/);
  assert.match(SOURCE, /signedUrlPersisted:false/);
});

test('release UI hides signed-URL fault injection while the probe helper stays local-directory independent', () => {
  assert.doesNotMatch(SOURCE, /id="lf-early-delete-probe"/);
  const start = SOURCE.indexOf('async function startEarlyDeleteProbe');
  const end = SOURCE.indexOf('async function startManifestQueue', start);
  const block = SOURCE.slice(start, end);
  assert.doesNotMatch(block, /invokeDirectoryPicker/);
  assert.doesNotMatch(block, /acquirePreferredBaseDirFromGesture/);
  assert.match(block, /processEarlyDeleteProbe/);
});
