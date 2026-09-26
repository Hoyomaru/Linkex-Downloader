'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SOURCE = fs.readFileSync('linkex-downloader.user.js', 'utf8');

test('early-delete pipeline keeps COPY serialized while DELETE=2 and DOWNLOAD=8 overlap', () => {
  assert.match(SOURCE, /const EARLY_DELETE_DOWNLOAD_WORKERS = 8;/);
  assert.match(SOURCE, /const EARLY_DELETE_DELETE_WORKERS = 2;/);
  assert.match(SOURCE, /const EARLY_DELETE_MAX_IN_FLIGHT = EARLY_DELETE_DOWNLOAD_WORKERS \* 2;/);
  const start = SOURCE.indexOf('async function processEarlyDeletePipeline');
  const end = SOURCE.indexOf('function assertEarlyDeleteProbeGuards', start);
  assert.ok(start > 0 && end > start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /createAsyncSemaphore\(EARLY_DELETE_DOWNLOAD_WORKERS\)/);
  assert.match(block, /createAsyncSemaphore\(EARLY_DELETE_DELETE_WORKERS\)/);
  assert.match(block, /createAsyncSemaphore\(EARLY_DELETE_MAX_IN_FLIGHT\)/);
  assert.match(block, /earlyDeleteWorkers:EARLY_DELETE_DELETE_WORKERS/);
});

test('early-delete opens the download stream before destructive DELETE and still lets the next COPY prepare', () => {
  const start = SOURCE.indexOf('async function processEarlyDeletePipeline');
  const end = SOURCE.indexOf('function assertEarlyDeleteProbeGuards', start);
  const block = SOURCE.slice(start, end);
  const copyAt = block.indexOf('await ensureCopyOwned');
  const signedAt = block.indexOf('getTransientSignedUrl', copyAt);
  const launchAt = block.indexOf('launchEarlyDeleteTransaction(i, signedUrl', signedAt);
  assert.ok(copyAt >= 0 && signedAt > copyAt && launchAt > signedAt);

  const launchStart = block.indexOf('const launchEarlyDeleteTransaction');
  const loopStart = block.indexOf('for (let i = 0;', launchStart);
  const launchBlock = block.slice(launchStart, loopStart);
  const downloadStartAt = launchBlock.indexOf('const downloadPromise = ensureDetachedDownloaded');
  const barrierAt = launchBlock.indexOf('streamReady.then', downloadStartAt);
  const deleteAt = launchBlock.indexOf('await deleteOwnedTempForEarlyDeletePipeline', barrierAt);
  const downloadJoinAt = launchBlock.indexOf('const downloadResult = await downloadSettled', deleteAt);
  assert.ok(downloadStartAt >= 0, 'download must be started without awaiting completion');
  assert.ok(barrierAt > downloadStartAt, 'DELETE barrier must wait for stream-ready');
  assert.ok(deleteAt > barrierAt, 'DELETE starts only after stream-ready');
  assert.ok(downloadJoinAt > deleteAt, 'download completion is joined after DELETE has started');
  assert.match(launchBlock, /stream-ready/);
  assert.match(launchBlock, /zero-byte EOF/);
  assert.match(launchBlock, /capacity\.release\(reservation\)/);

  const loopBlock = block.slice(loopStart);
  const afterSigned = loopBlock.slice(loopBlock.indexOf('let signedUrl'));
  assert.doesNotMatch(afterSigned.slice(0, afterSigned.indexOf('launchEarlyDeleteTransaction')), /await deleteOwnedTempForEarlyDeletePipeline/);
});

test('early-delete concurrent state uses nested delete.phase so Worker checkpoints cannot overwrite destructive-action state', () => {
  assert.match(SOURCE, /function earlyDeletePhase\(tx\)/);
  assert.match(SOURCE, /delete:\{[\s\S]*phase:'INTENT'/);
  assert.match(SOURCE, /phase:'REQUEST_SENT'/);
  assert.match(SOURCE, /phase:'UNCERTAIN'/);
  assert.match(SOURCE, /phase:'CONFIRMED'/);
  assert.match(SOURCE, /needsEarlyDeleteReconcile\(item\.tx\)/);
  assert.match(SOURCE, /item\.tx\?\.state === 'LOCAL_COMMITTED' && item\.tx\?\.delete\?\.confirmedAbsentAt/);
});

test('COPY ownership reuses a conservative root snapshot after the first file', () => {
  assert.match(SOURCE, /const transientRootSnapshots = new Map\(\);/);
  assert.match(SOURCE, /rememberTransientRootSnapshot\(tx\.operationId, rec\.root\)/);
  assert.match(SOURCE, /let rootBaselineIds = null;/);
  assert.match(SOURCE, /beforeIdsHint:rootBaselineIds/);
  assert.match(SOURCE, /if \(reconciledRootIds\) rootBaselineIds = reconciledRootIds;/);
  assert.match(SOURCE, /const beforeRoot = hintedBeforeIds \? null : await listAllRoot\(api\);/);
});

test('fresh ownership signed URL is memory-only and persisted confirmedDest is identity-only', () => {
  assert.match(SOURCE, /const transientSignedUrls = new Map\(\);/);
  assert.match(SOURCE, /rememberTransientSignedUrl\(tx\.operationId, rec\.item\)/);
  assert.match(SOURCE, /confirmedDest:ownedIdentitySnapshot\(rec\.item\)/);
  const snapshotStart = SOURCE.indexOf('function ownedIdentitySnapshot');
  const snapshotEnd = SOURCE.indexOf('function rememberTransientSignedUrl', snapshotStart);
  const snapshot = SOURCE.slice(snapshotStart, snapshotEnd);
  assert.doesNotMatch(snapshot, /url:/);

  const start = SOURCE.indexOf('async function processEarlyDeletePipeline');
  const end = SOURCE.indexOf('function assertEarlyDeleteProbeGuards', start);
  const block = SOURCE.slice(start, end);
  assert.match(block, /getTransientSignedUrl\(tx\.operationId\)/);
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

test('DL8 early-delete is primary all/selected path and post-commit delete remains compatibility fallback', () => {
  assert.match(SOURCE, /id="lf-start" class="primary action-main" disabled>すべてダウンロード<\/button>/);
  assert.match(SOURCE, /id="lf-start-early-delete" class="secondary" disabled>互換方式ですべてダウンロード<\/button>/);
  assert.match(SOURCE, /id="lf-start-selected" class="primary" disabled>選択をダウンロード<\/button>/);
  assert.match(SOURCE, /id="lf-start-selected-early-delete" class="secondary" disabled>互換方式で選択をダウンロード<\/button>/);

  const detailsAt = SOURCE.indexOf('<details id="lf-more" class="more">');
  assert.ok(SOURCE.indexOf('id="lf-start-early-delete"', detailsAt) > detailsAt);

  const compatAt = SOURCE.indexOf("earlyDeleteStartBtn.addEventListener('click'");
  const mainAt = SOURCE.indexOf("startBtn.addEventListener('click'", compatAt);
  const selectAt = SOURCE.indexOf("selectModeBtn.addEventListener('click'", mainAt);
  const selectedCompatAt = SOURCE.indexOf("selectedEarlyDeleteStartBtn.addEventListener('click'", selectAt);
  const selectedMainAt = SOURCE.indexOf("selectedStartBtn.addEventListener('click'", selectedCompatAt);
  const destinationAt = SOURCE.indexOf("destinationBtn.addEventListener('click'", selectedMainAt);

  assert.match(SOURCE.slice(compatAt, mainAt), /startManifestQueue\(null, \{baseDir, skipConfirm:true\}\)/);
  assert.match(SOURCE.slice(mainAt, selectAt), /startEarlyDeletePipeline\(null, \{baseDir, skipConfirm:true\}\)/);
  assert.match(SOURCE.slice(selectedCompatAt, selectedMainAt), /startManifestQueue\(new Set\(selectedIndexes\), \{baseDir, skipConfirm:true\}\)/);
  assert.match(SOURCE.slice(selectedMainAt, destinationAt), /startEarlyDeletePipeline\(new Set\(selectedIndexes\), \{baseDir, skipConfirm:true\}\)/);
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

test('release UI hides fault-injection controls while recovery implementation remains regression-tested', () => {
  assert.doesNotMatch(SOURCE, /id="lf-early-delete-recovery"/);
  assert.doesNotMatch(SOURCE, /id="lf-early-delete-probe"/);
  assert.match(SOURCE, /recoveryProbe && chosenFiles\.length !== 1/);
  assert.match(SOURCE, /kind:'recovery_probe_interrupt'/);
  assert.match(SOURCE, /early-delete-recovery-result/);
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
