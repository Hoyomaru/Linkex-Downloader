'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SOURCE = fs.readFileSync('linkex-downloader.user.js', 'utf8');

test('early-delete pipeline is COPY=1 / early DELETE=1 / DOWNLOAD=4 with one prefetch slot', () => {
  assert.match(SOURCE, /const EARLY_DELETE_DOWNLOAD_WORKERS = 4;/);
  assert.match(SOURCE, /const EARLY_DELETE_MAX_IN_FLIGHT = EARLY_DELETE_DOWNLOAD_WORKERS \+ 1;/);
  const start = SOURCE.indexOf('async function processEarlyDeletePipeline');
  const end = SOURCE.indexOf('function assertEarlyDeleteProbeGuards', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /createAsyncSemaphore\(EARLY_DELETE_DOWNLOAD_WORKERS\)/);
  assert.match(block, /createAsyncSemaphore\(EARLY_DELETE_MAX_IN_FLIGHT\)/);
});

test('early-delete order is ownership -> signed URL -> confirmed delete -> download launch', () => {
  const start = SOURCE.indexOf('async function processEarlyDeletePipeline');
  const end = SOURCE.indexOf('function assertEarlyDeleteProbeGuards', start);
  const block = SOURCE.slice(start, end);
  const copyAt = block.indexOf('await ensureCopyOwned');
  const urlAt = block.indexOf('await refreshOwnedFileUrl');
  const deleteAt = block.indexOf('await deleteOwnedTempForEarlyDeletePipeline');
  const releaseAt = block.indexOf('capacity.release(reservation)', deleteAt);
  const launchAt = block.indexOf('launchDetachedDownload(i, signedUrl', deleteAt);
  assert.ok(copyAt >= 0 && urlAt > copyAt);
  assert.ok(deleteAt > urlAt);
  assert.ok(releaseAt > deleteAt);
  assert.ok(launchAt > releaseAt);
});

test('signed URL is closure-only and never placed in persisted transaction', () => {
  const start = SOURCE.indexOf('async function processEarlyDeletePipeline');
  const end = SOURCE.indexOf('function assertEarlyDeleteProbeGuards', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /const signedUrl = owned\.url; \/\/ Memory-only; never persisted\./);
  assert.match(block, /signedUrlPersisted:false/);
  assert.doesNotMatch(block, /signedUrl\s*:/);
});

test('experimental early DELETE still proves new ID and exact identity before single-file delete', () => {
  const guardStart = SOURCE.indexOf('function assertEarlyDeletePipelineGuards');
  const deleteStart = SOURCE.indexOf('async function deleteOwnedTempForEarlyDeletePipeline', guardStart);
  const guard = SOURCE.slice(guardStart, deleteStart);
  assert.match(guard, /beforeIds\.map\(String\)\.includes\(destId\)/);
  assert.match(guard, /confirmedDest\?\.id/);

  const deleteEnd = SOURCE.indexOf('function canRearmEarlyDeleteItem', deleteStart);
  const del = SOURCE.slice(deleteStart, deleteEnd);
  assert.match(del, /sameOwnedIdentity\(current, tx\)/);
  assert.match(del, /api\.deleteSingleFile\(guard\.destId\)/);
  assert.match(del, /DELETE POST再送: NO/);
  assert.match(del, /reconcileDelete\(api, tx/);
});

test('normal delete gate still requires LOCAL_COMMITTED', () => {
  const start = SOURCE.indexOf('function assertDeleteGuards(state)');
  const end = SOURCE.indexOf('function sameOwnedIdentity', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /state !== 'LOCAL_COMMITTED'/);
  assert.match(block, /verifiedAt/);
});

test('detached CDN 403 does not try to refresh a deleted destId', () => {
  const start = SOURCE.indexOf('async function downloadOwnedFile');
  const end = SOURCE.indexOf('// --- I: destructive action guard', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /if \(detachedUrl\)/);
  assert.match(block, /kind:'signed_url_expired'/);
  const detachedAt = block.indexOf('if (detachedUrl)');
  const refreshAfter = block.indexOf('owned = await refreshOwnedFileUrl', detachedAt);
  assert.ok(refreshAfter > detachedAt, 'normal path refresh remains after detached guard');
  assert.ok(block.indexOf("throw new LinkexError('早期DELETE後のsigned URLが403", detachedAt) < refreshAfter);
});

test('resume after confirmed early delete rearms with a new COPY while preserving local partial on disk', () => {
  const start = SOURCE.indexOf('function rearmEarlyDeleteItem');
  const end = SOURCE.indexOf('async function ensureDetachedDownloaded', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /item\.tx = null;/);
  assert.match(block, /item\.earlyDeleteHistory/);
  assert.doesNotMatch(block, /truncate|createWritable|getLocalFileHandle/);

  const processStart = SOURCE.indexOf('async function processEarlyDeletePipeline');
  const processEnd = SOURCE.indexOf('function assertEarlyDeleteProbeGuards', processStart);
  const processBlock = SOURCE.slice(processStart, processEnd);
  assert.match(processBlock, /rearmEarlyDeleteItem\(job, i\)/);
  assert.match(processBlock, /await ensureCopyOwned/);
});

test('real-write experimental UI supports all or selected files', () => {
  assert.match(SOURCE, /id="lf-start-early-delete"/);
  assert.match(SOURCE, /id="lf-start-selected-early-delete"/);
  assert.match(SOURCE, /startEarlyDeletePipeline\(null, \{baseDir, skipConfirm:false\}\)/);
  assert.match(SOURCE, /startEarlyDeletePipeline\(new Set\(selectedIndexes\), \{baseDir, skipConfirm:false\}\)/);
});
