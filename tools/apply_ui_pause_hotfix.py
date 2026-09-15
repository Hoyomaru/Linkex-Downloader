from pathlib import Path

SOURCE = Path('linkex-downloader.user.js')
TESTS = Path('tests/linkex-downloader.test.js')
CHANGELOG = Path('CHANGELOG.md')

src = SOURCE.read_text(encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

src = replace_once(
    src,
    '#linkex-full-queue { position:fixed; right:18px; bottom:18px; width:540px; z-index:2147483647; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; color:#eef2ff; }',
    '#linkex-full-queue { position:fixed; right:12px; bottom:12px; width:min(540px, calc(100vw - 24px)); max-width:calc(100vw - 24px); z-index:2147483647; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; color:#eef2ff; }',
    'responsive root',
)
src = replace_once(
    src,
    '#linkex-full-queue .box { background:#111827; border:1px solid #374151; border-radius:14px; box-shadow:0 18px 45px rgba(0,0,0,.4); overflow:hidden; }',
    '#linkex-full-queue .box { background:#111827; border:1px solid #374151; border-radius:14px; box-shadow:0 18px 45px rgba(0,0,0,.4); overflow:hidden; max-height:calc(100vh - 24px); max-height:calc(100dvh - 24px); display:flex; flex-direction:column; }',
    'viewport height cap',
)
src = replace_once(
    src,
    '#linkex-full-queue .hd { padding:11px 12px 11px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; background:#0b1220; border-bottom:1px solid #374151; }',
    '#linkex-full-queue .hd { padding:11px 12px 11px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; background:#0b1220; border-bottom:1px solid #374151; flex:0 0 auto; }',
    'fixed header',
)
src = replace_once(
    src,
    '#linkex-full-queue .body { padding:12px; }',
    '#linkex-full-queue .body { padding:12px; overflow-y:auto; overscroll-behavior:contain; min-height:0; scrollbar-gutter:stable; }',
    'scrollable body',
)
src = replace_once(
    src,
    '    let manifest = null;\n    let running = false;\n    let selectedIndexes = new Set();',
    '    let manifest = null;\n    let running = false;\n    let activeRunJob = null;\n    let selectedIndexes = new Set();',
    'active run job state',
)
src = replace_once(
    src,
    '      pauseBtn.disabled = !running || !job || !!job.stopRequested;',
    '      pauseBtn.disabled = !running || !activeRunJob || !!activeRunJob.stopRequested;',
    'pause button state',
)
src = replace_once(
    src,
    "    async function runJob(job, queueRoot, resume=false) {\n      // 呼び出し側がleaseを取得済みであること。Queue stateのmutationより先に排他を確立する。\n      assertLease();\n      recordEvent('info', resume ? 'queue-resume' : 'queue-start', `${resume ? 'Queue再開' : 'Queue開始'}: ${job.jobId}`, {jobId:job.jobId, items:job.items?.length, folderName:job.folderName});\n      try {",
    "    async function runJob(job, queueRoot, resume=false) {\n      // 呼び出し側がleaseを取得済みであること。Queue stateのmutationより先に排他を確立する。\n      assertLease();\n      // 停止ボタンは実行中の同一job objectを直接更新する。GM storageの別snapshot経由だと\n      // 後続saveQueueJob(job)で停止予約が巻き戻る可能性があるため、in-memory参照を保持する。\n      activeRunJob = job;\n      refreshQueueUi();\n      recordEvent('info', resume ? 'queue-resume' : 'queue-start', `${resume ? 'Queue再開' : 'Queue開始'}: ${job.jobId}`, {jobId:job.jobId, items:job.items?.length, folderName:job.folderName});\n      try {",
    'runJob active binding',
)
src = replace_once(
    src,
    "      } catch (e) {\n        recordEvent('error', 'queue-stop', `Queue停止: ${e?.message || e}`, {jobId:job?.jobId, kind:e?.kind || null});\n        throw e;\n      }\n    }\n\n    async function startManifestQueue(selection = null) {",
    "      } catch (e) {\n        recordEvent('error', 'queue-stop', `Queue停止: ${e?.message || e}`, {jobId:job?.jobId, kind:e?.kind || null});\n        throw e;\n      } finally {\n        activeRunJob = null;\n        refreshQueueUi();\n      }\n    }\n\n    async function startManifestQueue(selection = null) {",
    'runJob cleanup',
)
src = replace_once(
    src,
    "    pauseBtn.addEventListener('click', () => {\n      const job = loadQueueJob();\n      if (!job || !running) return;",
    "    pauseBtn.addEventListener('click', () => {\n      const job = activeRunJob;\n      if (!job || !running) return;",
    'pause active job mutation',
)
SOURCE.write_text(src, encoding='utf-8')

tests = TESTS.read_text(encoding='utf-8')
addition = r'''

test('panel is constrained to the viewport and its body scrolls instead of escaping the screen', () => {
  assert.match(SOURCE, /width:min\(540px, calc\(100vw - 24px\)\)/);
  assert.match(SOURCE, /max-height:calc\(100dvh - 24px\)/);
  assert.match(SOURCE, /#linkex-full-queue \.box \{[^\n]*display:flex; flex-direction:column;/);
  assert.match(SOURCE, /#linkex-full-queue \.body \{[^\n]*overflow-y:auto;[^\n]*min-height:0;/);
});

test('safe pause controls the active in-memory Queue and is enabled while runJob is active', () => {
  assert.match(SOURCE, /let activeRunJob = null;/);

  const refreshAt = SOURCE.indexOf('function refreshQueueUi()');
  const collapseAt = SOURCE.indexOf("collapseBtn.addEventListener('click'", refreshAt);
  assert.ok(refreshAt > 0 && collapseAt > refreshAt);
  const refreshBlock = SOURCE.slice(refreshAt, collapseAt);
  assert.match(refreshBlock, /pauseBtn\.disabled = !running \|\| !activeRunJob \|\| !!activeRunJob\.stopRequested;/);

  const runAt = SOURCE.indexOf('async function runJob(job, queueRoot, resume=false)');
  const startAt = SOURCE.indexOf('async function startManifestQueue(selection = null)', runAt);
  assert.ok(runAt > 0 && startAt > runAt);
  const runBlock = SOURCE.slice(runAt, startAt);
  assert.ok(runBlock.indexOf('activeRunJob = job;') >= 0);
  assert.ok(runBlock.indexOf('activeRunJob = job;') < runBlock.indexOf('await processQueue('));
  assert.ok(runBlock.indexOf('refreshQueueUi();') < runBlock.indexOf('await processQueue('));
  assert.match(runBlock, /finally \{\s*activeRunJob = null;\s*refreshQueueUi\(\);\s*\}/);

  const pauseAt = SOURCE.indexOf("pauseBtn.addEventListener('click'", startAt);
  const retryAt = SOURCE.indexOf("retryBtn.addEventListener('click'", pauseAt);
  assert.ok(pauseAt > startAt && retryAt > pauseAt);
  const pauseBlock = SOURCE.slice(pauseAt, retryAt);
  assert.match(pauseBlock, /const job = activeRunJob;/);
  assert.match(pauseBlock, /job\.stopRequested = true;/);
  assert.doesNotMatch(pauseBlock, /const job = loadQueueJob\(\);/);
});
'''
if "panel is constrained to the viewport" in tests:
    raise SystemExit('tests already patched')
TESTS.write_text(tests.rstrip() + addition + '\n', encoding='utf-8')

changelog = CHANGELOG.read_text(encoding='utf-8')
changelog = replace_once(
    changelog,
    '### Fixed\n\n',
    '### Fixed\n\n- Downloaderパネルをviewport内に制限し、縦に収まらない場合はパネル本文をスクロール可能に修正\n- 実行中の「現在ファイル後に停止」を有効化し、停止予約を実行中Queueへ確実に反映するよう修正\n',
    'changelog fixed bullets',
)
old_note = '> このUnreleasedセクションはドキュメント整備のみです。`linkex-downloader.user.js` の実行ロジックおよびVersionは変更していません。'
new_note = '> このUnreleasedセクションにはv1.0.0以降の未リリース変更を記録しています。正式リリースまでは `linkex-downloader.user.js` のVersionは1.0.0のままです。'
changelog = replace_once(changelog, old_note, new_note, 'changelog note')
CHANGELOG.write_text(changelog, encoding='utf-8')
