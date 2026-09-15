from pathlib import Path

p = Path('linkex-downloader.user.js')
s = p.read_text(encoding='utf-8')


def rep(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 match, got {n}')
    s = s.replace(old, new, 1)

rep(
"""  function createQueueFromManifest(manifest) {
    if (!manifest?.files?.length) throw new LinkexError('共有内にファイルがありません。');
    const sources = manifest.files.map(compactSource);
    const localPaths = allocateLocalPaths(sources, manifest.shareName);
    const jobId = makeId('full');
    const base = sanitizeSegment(manifest.shareName || manifest.shareToken || 'share');
    const folderName = sanitizeSegment(`Linkex_${base}_${stampForFolder()}_${jobId.slice(-6)}`);
    return {
      schemaVersion:2,
      kind:'full-queue',
      version:VERSION,
      jobId,
      shareToken:manifest.shareToken,
      shareName:manifest.shareName || manifest.shareToken,
      folderName,
      sourceTotalBytes:Number(manifest.totalBytes || 0),
      createdAt:Date.now(),
      state:'READY',
      currentIndex:0,
      stopRequested:false,
      items:sources.map((source,index) => ({
        index,
        source,
        localSegments:localPaths[index],
        state:'PENDING',
        tx:null,
        attempts:{download:0},
        lastError:null
      }))
    };
  }
""",
"""  function createQueueFromManifest(manifest, selectedIndexes = null) {
    if (!manifest?.files?.length) throw new LinkexError('共有内にファイルがありません。');
    const selected = selectedIndexes == null ? null : new Set(Array.from(selectedIndexes, x => Number(x)).filter(Number.isInteger));
    const chosen = manifest.files
      .map((source, manifestIndex) => ({source, manifestIndex}))
      .filter(x => selected == null || selected.has(x.manifestIndex));
    if (!chosen.length) throw new LinkexError('処理するファイルが選択されていません。', {kind:'selection'});
    const sources = chosen.map(x => compactSource(x.source));
    const localPaths = allocateLocalPaths(sources, manifest.shareName);
    const jobId = makeId(selected == null ? 'full' : 'selected');
    const base = sanitizeSegment(manifest.shareName || manifest.shareToken || 'share');
    const folderName = sanitizeSegment(`Linkex_${base}_${stampForFolder()}_${jobId.slice(-6)}`);
    return {
      schemaVersion:2,
      kind:'full-queue',
      selectionMode:selected == null ? 'all' : 'selected',
      sourceOriginalCount:manifest.files.length,
      version:VERSION,
      jobId,
      shareToken:manifest.shareToken,
      shareName:manifest.shareName || manifest.shareToken,
      folderName,
      sourceTotalBytes:sources.reduce((sum, source) => sum + (Number.isFinite(source.size) ? source.size : 0), 0),
      createdAt:Date.now(),
      state:'READY',
      currentIndex:0,
      stopRequested:false,
      items:sources.map((source,index) => ({
        index,
        manifestIndex:chosen[index].manifestIndex,
        source,
        localSegments:localPaths[index],
        state:'PENDING',
        tx:null,
        attempts:{download:0},
        lastError:null
      }))
    };
  }
""", 'createQueue selection')

rep(
"""        #linkex-full-queue .notice { font-size:11px; color:#9ca3af; margin-top:8px; line-height:1.45; }
""",
"""        #linkex-full-queue .notice { font-size:11px; color:#9ca3af; margin-top:8px; line-height:1.45; }
        #linkex-full-queue .selection { margin:0 0 9px; padding:8px; border:1px solid #374151; border-radius:8px; background:#0b1220; }
        #linkex-full-queue .selection[hidden] { display:none; }
        #linkex-full-queue .selection-meta { font-size:11px; color:#cbd5e1; margin-bottom:6px; }
        #linkex-full-queue .selection-actions { display:flex; gap:6px; margin-bottom:6px; }
        #linkex-full-queue .selection-actions button { padding:6px 7px; font-size:11px; }
        #linkex-full-queue .file-list { max-height:190px; overflow:auto; border:1px solid #1f2937; border-radius:6px; }
        #linkex-full-queue .file-option { display:flex; align-items:flex-start; gap:7px; padding:6px 7px; border-bottom:1px solid #1f2937; font-size:11px; line-height:1.35; cursor:pointer; }
        #linkex-full-queue .file-option:last-child { border-bottom:0; }
        #linkex-full-queue .file-option input { width:auto; margin:2px 0 0; flex:0 0 auto; }
        #linkex-full-queue .file-path { overflow-wrap:anywhere; }
        #linkex-full-queue .file-size { color:#9ca3af; white-space:nowrap; margin-left:auto; }
""", 'selection CSS')

rep(
"""          <div class=\"row\"><button id=\"lf-start\" class=\"warn\" disabled>全ファイル開始</button><button id=\"lf-resume\" class=\"primary\" disabled>Queueを再開</button></div>
          <div class=\"row\"><button id=\"lf-pause\" class=\"secondary\" disabled>現在ファイル後に停止</button><button id=\"lf-retry\" class=\"secondary\" disabled>容量スキップを再試行</button></div>
""",
"""          <div class=\"row\"><button id=\"lf-start\" class=\"warn\" disabled>全ファイル開始</button><button id=\"lf-start-selected\" class=\"primary\" disabled>選択ファイル開始</button></div>
          <div id=\"lf-selection\" class=\"selection\" hidden>
            <div id=\"lf-selection-meta\" class=\"selection-meta\">0 / 0 selected</div>
            <input id=\"lf-file-filter\" placeholder=\"ファイル名 / パスで絞り込み\" />
            <div class=\"selection-actions\"><button id=\"lf-select-all\" class=\"secondary\">全件選択</button><button id=\"lf-clear-all\" class=\"secondary\">全解除</button><button id=\"lf-select-visible\" class=\"secondary\">表示中を選択</button><button id=\"lf-clear-visible\" class=\"secondary\">表示中を解除</button></div>
            <div id=\"lf-file-list\" class=\"file-list\"></div>
            <div id=\"lf-selection-note\" class=\"notice\"></div>
          </div>
          <div class=\"row\"><button id=\"lf-resume\" class=\"primary\" disabled>Queueを再開</button><button id=\"lf-pause\" class=\"secondary\" disabled>現在ファイル後に停止</button></div>
          <div class=\"row\"><button id=\"lf-retry\" class=\"secondary\" disabled>容量スキップを再試行</button><button id=\"lf-abandon\" class=\"secondary\" disabled>Queueを安全に破棄</button></div>
""", 'selection markup')

# Remove duplicate abandon row produced by markup replacement.
rep(
"""          <div class=\"row\"><button id=\"lf-abandon\" class=\"secondary\" disabled>Queueを安全に破棄</button><button id=\"lf-export\" class=\"secondary\">診断ログを保存</button></div>
          <div class=\"row\"><button id=\"lf-refresh\" class=\"secondary\">状態を再表示</button></div>
""",
"""          <div class=\"row\"><button id=\"lf-export\" class=\"secondary\">診断ログを保存</button><button id=\"lf-refresh\" class=\"secondary\">状態を再表示</button></div>
""", 'deduplicate abandon row')

rep(
"""    const startBtn = root.querySelector('#lf-start');
    const resumeBtn = root.querySelector('#lf-resume');
""",
"""    const startBtn = root.querySelector('#lf-start');
    const selectedStartBtn = root.querySelector('#lf-start-selected');
    const selectionPanel = root.querySelector('#lf-selection');
    const selectionMeta = root.querySelector('#lf-selection-meta');
    const fileFilter = root.querySelector('#lf-file-filter');
    const fileList = root.querySelector('#lf-file-list');
    const selectionNote = root.querySelector('#lf-selection-note');
    const selectAllBtn = root.querySelector('#lf-select-all');
    const clearAllBtn = root.querySelector('#lf-clear-all');
    const selectVisibleBtn = root.querySelector('#lf-select-visible');
    const clearVisibleBtn = root.querySelector('#lf-clear-visible');
    const resumeBtn = root.querySelector('#lf-resume');
""", 'selection bindings')

rep(
"""    let manifest = null;
    let running = false;
""",
"""    let manifest = null;
    let running = false;
    let selectedIndexes = new Set();
""", 'selection state')

rep(
"""    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }

    function refreshProgress() {
""",
"""    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }

    function visibleManifestIndexes() {
      if (!manifest?.files?.length) return [];
      const q = String(fileFilter.value || '').trim().toLocaleLowerCase('ja-JP');
      const matches = [];
      for (let i = 0; i < manifest.files.length; i++) {
        const file = manifest.files[i];
        const haystack = `${file.remotePath || file.name || ''} ${file.name || ''}`.toLocaleLowerCase('ja-JP');
        if (!q || haystack.includes(q)) matches.push(i);
      }
      return matches;
    }

    function selectedBytes() {
      if (!manifest?.files?.length) return 0;
      let total = 0;
      for (const index of selectedIndexes) total += Number(manifest.files[index]?.size || 0);
      return total;
    }

    function renderSelection() {
      const hasManifest = !!manifest?.files?.length;
      selectionPanel.hidden = !hasManifest;
      if (!hasManifest) {
        fileList.replaceChildren();
        selectionMeta.textContent = '0 / 0 selected';
        selectionNote.textContent = '';
        return;
      }
      const visible = visibleManifestIndexes();
      const shown = visible.slice(0, 300);
      const fragment = document.createDocumentFragment();
      for (const index of shown) {
        const file = manifest.files[index];
        const label = document.createElement('label');
        label.className = 'file-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.index = String(index);
        checkbox.checked = selectedIndexes.has(index);
        const path = document.createElement('span');
        path.className = 'file-path';
        path.textContent = file.remotePath || file.name || `(file ${index + 1})`;
        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatBytes(file.size);
        label.append(checkbox, path, size);
        fragment.appendChild(label);
      }
      fileList.replaceChildren(fragment);
      selectionMeta.textContent = `${selectedIndexes.size} / ${manifest.files.length} selected · ${formatBytes(selectedBytes())}`;
      selectionNote.textContent = visible.length > shown.length ? `絞り込み結果 ${visible.length}件のうち先頭300件を表示しています。検索欄で絞り込めます。` : `表示中: ${visible.length}件`;
    }

    fileFilter.addEventListener('input', renderSelection);
    fileList.addEventListener('change', event => {
      const checkbox = event.target?.closest?.('input[type="checkbox"][data-index]');
      if (!checkbox) return;
      const index = Number(checkbox.dataset.index);
      if (checkbox.checked) selectedIndexes.add(index); else selectedIndexes.delete(index);
      renderSelection();
      refreshQueueUi();
    });
    selectAllBtn.addEventListener('click', () => {
      if (!manifest) return;
      selectedIndexes = new Set(manifest.files.map((_, i) => i));
      renderSelection(); refreshQueueUi();
    });
    clearAllBtn.addEventListener('click', () => {
      selectedIndexes.clear();
      renderSelection(); refreshQueueUi();
    });
    selectVisibleBtn.addEventListener('click', () => {
      for (const index of visibleManifestIndexes()) selectedIndexes.add(index);
      renderSelection(); refreshQueueUi();
    });
    clearVisibleBtn.addEventListener('click', () => {
      for (const index of visibleManifestIndexes()) selectedIndexes.delete(index);
      renderSelection(); refreshQueueUi();
    });

    function refreshProgress() {
""", 'selection renderer')

rep(
"""      startBtn.disabled = running || !manifest?.files?.length || !!active;
      pauseBtn.disabled = !running || !job || !!job.stopRequested;
""",
"""      startBtn.disabled = running || !manifest?.files?.length || !!active;
      selectedStartBtn.disabled = running || !manifest?.files?.length || selectedIndexes.size === 0 || !!active;
      pauseBtn.disabled = !running || !job || !!job.stopRequested;
""", 'selected button state')

rep(
"""        manifest = await buildManifest(api, token, x => write(`共有manifestを読み取り中…\\nfiles: ${x.files}\\n${x.path || ''}`));
        const largest = [...manifest.files].sort((a,b)=>Number(b.size||0)-Number(a.size||0))[0];
""",
"""        manifest = await buildManifest(api, token, x => write(`共有manifestを読み取り中…\\nfiles: ${x.files}\\n${x.path || ''}`));
        selectedIndexes = new Set(manifest.files.map((_, i) => i));
        fileFilter.value = '';
        renderSelection();
        const largest = [...manifest.files].sort((a,b)=>Number(b.size||0)-Number(a.size||0))[0];
""", 'initialize selection after analyze')

rep(
"""          '開始するとジョブ専用ローカルフォルダを作成し、全ファイルを1件ずつ処理します。'
""",
"""          '「全ファイル開始」または一覧で絞り込んだ「選択ファイル開始」を選べます。処理自体は従来どおり1件ずつ安全に実行します。'
""", 'analyze guidance')

rep(
"""        manifest = null;
      } finally { analyzeBtn.disabled = false; refreshQueueUi(); }
""",
"""        manifest = null;
        selectedIndexes.clear();
        renderSelection();
      } finally { analyzeBtn.disabled = false; refreshQueueUi(); }
""", 'analysis failure selection cleanup')

old_start = """    startBtn.addEventListener('click', async () => {
      if (!manifest || running) return;
      const pageWindow = getNativePageWindow();
      const ok = Reflect.apply(pageWindow.confirm, pageWindow, [`${manifest.files.length}ファイル（合計 ${formatBytes(manifest.totalBytes)}）を順番に処理します。\n\n各ファイルはLinkexへ一時コピー → ローカル検証 → 確定済み一時コピーだけ削除します。\n開始しますか？`]);
      if (!ok) return;
      let baseDir;
      try { baseDir = await invokeDirectoryPicker({mode:'readwrite'}); }
      catch (e) { if (e?.name !== 'AbortError') write(`保存先選択失敗: ${e?.message || e}`, 'err'); return; }
      running = true;
      try {
        await acquireLease();
        const activeJob = loadQueueJob();
        if (activeJob && !isTerminal(activeJob)) throw new LinkexError('別の未完了Queueを検出しました。状態を再表示してから再開または整理してください。', {kind:'queue_conflict'});
        await ensureHandlePermission(baseDir);
        const job = createQueueFromManifest(manifest);
        const queueRoot = await baseDir.getDirectoryHandle(job.folderName, {create:true});
        await putQueueRootHandle(job, queueRoot);
        saveQueueJob(job);
        recordEvent('info', 'queue-created', `Queue作成: ${job.jobId}`, {jobId:job.jobId, shareName:job.shareName, folderName:job.folderName, items:job.items.length, totalBytes:job.sourceTotalBytes});
        write(`Full Queue作成\n\n${queueSummary(job)}\n\n全ファイルを順次処理します。`, 'ok');
        await runJob(job, queueRoot, false);
      } catch (e) {
        console.error('[Linkex Queue]', e);
        const job = loadQueueJob();
        write(`Queue停止: ${e?.message || e}\n\n${queueSummary(job)}\n\n危険な状態では安全側で停止します。「Queueを再開」はcopy/delete POSTを盲目的に再送しません。`, 'err');
      } finally { running = false; releaseLease(); refreshQueueUi(); }
    });
"""
new_start = """    async function startManifestQueue(selection = null) {
      if (!manifest || running) return;
      const selected = selection == null ? null : Array.from(selection).sort((a,b) => a - b);
      const chosenFiles = selected == null ? manifest.files : selected.map(index => manifest.files[index]).filter(Boolean);
      if (!chosenFiles.length) { write('処理するファイルが選択されていません。', 'err'); return; }
      const totalBytes = chosenFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);
      const modeText = selected == null ? '全ファイル' : '選択ファイル';
      const pageWindow = getNativePageWindow();
      const ok = Reflect.apply(pageWindow.confirm, pageWindow, [`${modeText} ${chosenFiles.length}件（合計 ${formatBytes(totalBytes)}）を順番に処理します。\n\n各ファイルはLinkexへ一時コピー → ローカル検証 → 確定済み一時コピーだけ削除します。\n開始しますか？`]);
      if (!ok) return;
      let baseDir;
      try { baseDir = await invokeDirectoryPicker({mode:'readwrite'}); }
      catch (e) { if (e?.name !== 'AbortError') write(`保存先選択失敗: ${e?.message || e}`, 'err'); return; }
      running = true;
      try {
        await acquireLease();
        const activeJob = loadQueueJob();
        if (activeJob && !isTerminal(activeJob)) throw new LinkexError('別の未完了Queueを検出しました。状態を再表示してから再開または整理してください。', {kind:'queue_conflict'});
        await ensureHandlePermission(baseDir);
        const job = createQueueFromManifest(manifest, selected);
        const queueRoot = await baseDir.getDirectoryHandle(job.folderName, {create:true});
        await putQueueRootHandle(job, queueRoot);
        saveQueueJob(job);
        recordEvent('info', 'queue-created', `Queue作成: ${job.jobId}`, {jobId:job.jobId, selectionMode:job.selectionMode, sourceOriginalCount:job.sourceOriginalCount, shareName:job.shareName, folderName:job.folderName, items:job.items.length, totalBytes:job.sourceTotalBytes});
        write(`${modeText} Queue作成\n\n${queueSummary(job)}\n\n${job.items.length}ファイルを順次処理します。`, 'ok');
        await runJob(job, queueRoot, false);
      } catch (e) {
        console.error('[Linkex Queue]', e);
        const job = loadQueueJob();
        write(`Queue停止: ${e?.message || e}\n\n${queueSummary(job)}\n\n危険な状態では安全側で停止します。「Queueを再開」はcopy/delete POSTを盲目的に再送しません。`, 'err');
      } finally { running = false; releaseLease(); refreshQueueUi(); }
    }

    startBtn.addEventListener('click', () => startManifestQueue(null));
    selectedStartBtn.addEventListener('click', () => startManifestQueue(new Set(selectedIndexes)));
"""
rep(old_start, new_start, 'refactor start handlers')

p.write_text(s, encoding='utf-8', newline='\n')

# README: describe selective queue and button.
r = Path('README.md')
t = r.read_text(encoding='utf-8')
t = t.replace('- 複数ファイルFull Queue\n', '- 複数ファイルFull Queue\n- 解析後のファイル検索・選択Queue（全件処理も従来どおり利用可能）\n', 1)
t = t.replace('| **全ファイル開始** | 新しいFull Queueを作成して処理開始 |', '| **全ファイル開始** | 解析した全ファイルで新しいQueueを作成して処理開始 |\n| **選択ファイル開始** | 解析結果のチェック済みファイルだけでQueueを作成して処理開始 |', 1)
usage = '7. ローカルの保存先フォルダを選択します。\n8. あとはQueueが1ファイルずつ処理します。'
usage_new = '7. 必要なファイルだけ保存したい場合は、解析後の一覧で「全解除」→検索/チェックを使って対象を選び、**選択ファイル開始** を押します。全件ならそのまま **全ファイル開始** を使います。\n8. ローカルの保存先フォルダを選択します。\n9. あとはQueueが1ファイルずつ処理します。'
if usage not in t:
    raise SystemExit('README usage anchor not found')
t = t.replace(usage, usage_new, 1)
r.write_text(t, encoding='utf-8', newline='\n')

c = Path('CHANGELOG.md')
t = c.read_text(encoding='utf-8')
anchor = '- Node標準回帰テストとGitHub Actions CI\n'
if anchor not in t:
    raise SystemExit('CHANGELOG anchor not found')
t = t.replace(anchor, anchor + '- 共有解析後の検索・チェックによる選択ファイルQueue（全ファイルQueueと併用可能）\n', 1)
c.write_text(t, encoding='utf-8', newline='\n')

print('file selection feature applied')
