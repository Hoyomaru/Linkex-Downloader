'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SOURCE = fs.readFileSync('linkex-downloader.user.js', 'utf8');

test('early-delete pipeline is COPY=1 / early DELETE=1 / DOWNLOAD=8 with eight prefetch slots', () => {
  assert.match(SOURCE, /const EARLY_DELETE_DOWNLOAD_WORKERS = 8;/);
  assert.match(SOURCE, /const EARLY_DELETE_MAX_IN_FLIGHT = EARLY_DELETE_DOWNLOAD_WORKERS \* 2;/);
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
  const urlAt = block.indexOf('await refreshOwnedFileUrl', copyAt);
  const deleteAt = block.indexOf('await deleteOwnedTempForEarlyDeletePipeline', urlAt);
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


test('recovery probe is one-file only and intentionally interrupts only after a flushed partial exists', () => {
  assert.match(SOURCE, /recoveryProbe && chosenFiles\.length !== 1/);
  assert.match(SOURCE, /Number\(chosenFiles\[0\]\?\.size \|\| 0\) < 16 \* 1024 \* 1024/);
  const start = SOURCE.indexOf('const interruptAt = Number(interruptAfterBytes)');
  const end = SOURCE.indexOf('if (now - lastUi >= UI_UPDATE_INTERVAL_MS)', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /await flushBufferedWrite\(\)/);
  assert.match(block, /await handle\.getFile\(\)/);
  assert.match(block, /kind:'recovery_probe_interrupt'/);
});

test('recovery interruption is armed once and signed URL remains memory-only', () => {
  const start = SOURCE.indexOf('const recoveryProbe = job.experimental?.recoveryProbe');
  const end = SOURCE.indexOf('tx = syncTxFromProbe', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /!recoveryProbe\.interruptTriggeredAt/);
  assert.match(block, /interruptAfterBytes:/);
  assert.match(block, /firstOperationId:tx\.operationId/);
  assert.match(block, /firstDestId:tx\.confirmedDest\?\.id/);
  assert.doesNotMatch(block, /signedUrl\s*:/);
});

test('recovery FULL_PASS requires new op, new dest, Range resume, replacement delete, and local verification', () => {
  const start = SOURCE.indexOf('if (job.experimental?.recoveryProbe?.enabled && job.experimental.recoveryProbe.interruptTriggeredAt)');
  const end = SOURCE.indexOf('return tx;', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /operationChanged/);
  assert.match(block, /destChanged/);
  assert.match(block, /rangeResumed/);
  assert.match(block, /newDeleteConfirmed/);
  assert.match(block, /localVerified/);
  assert.match(block, /const fullPass = operationChanged && destChanged && rangeResumed && newDeleteConfirmed && localVerified/);
});

test('recovery UI requires one selection and uses the normal persisted Queue resume path', () => {
  assert.match(SOURCE, /id="lf-early-delete-recovery"/);
  assert.match(SOURCE, /selectedIndexes\.size !== 1/);
  assert.match(SOURCE, /recoveryProbe:true/);
  assert.match(SOURCE, /再読み込み後、「Queueを再開」を1回だけ押し、完了まで操作せず待ってください/);
});


test('recovery v2 requires a new userscript context before Queue resume', () => {
  assert.match(SOURCE, /interruptContextId:TAB_ID/);
  assert.match(SOURCE, /recoveryNeedsNewContext/);
  assert.match(SOURCE, /resumeBtn\.textContent = recoveryNeedsNewContext \? '先にページ再読み込み' : 'Queueを再開'/);
  assert.match(SOURCE, /kind:'recovery_reload_required'/);
  assert.match(SOURCE, /resumeContextId:TAB_ID/);
});

test('recovery v2 FULL_PASS includes context change and reports correct forced partial bytes', () => {
  const resultStart = SOURCE.indexOf('const interruptContextId = job.experimental?.recoveryProbe?.interruptContextId');
  const resultEnd = SOURCE.indexOf('return tx;', resultStart);
  const resultBlock = SOURCE.slice(resultStart, resultEnd);
  assert.match(resultBlock, /const contextChanged =/);
  assert.match(resultBlock, /localVerified && contextChanged/);
  assert.match(resultBlock, /contextChanged,/);

  const interruptStart = SOURCE.indexOf('const interruptedBytes = Number(partial.size || written)');
  const interruptEnd = SOURCE.indexOf("kind:'recovery_probe_interrupt'", interruptStart);
  const interruptBlock = SOURCE.slice(interruptStart, interruptEnd + 100);
  assert.match(interruptBlock, /partial=\$\{interruptedBytes\} bytes/);
  assert.match(interruptBlock, /partialBytes:interruptedBytes/);
});
