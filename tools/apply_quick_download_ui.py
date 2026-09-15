from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing replacement target: {label}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'expected one regex replacement for {label}, got {count}')
    return result


path = Path('linkex-downloader.user.js')
s = path.read_text(encoding='utf-8')

s = replace_once(
    s,
    "  const DOWNLOAD_STORE = 'handles';\n  const CHECKPOINT_BYTES = 2 * 1024 * 1024;",
    "  const DOWNLOAD_STORE = 'handles';\n  const PREFERRED_DIR_HANDLE_KEY = 'preferred-download-root:v1';\n  const CHECKPOINT_BYTES = 2 * 1024 * 1024;",
    'preferred directory key',
)

s = replace_once(
    s,
    "        #linkex-full-queue .secondary { background:#374151; color:#fff; }\n",
    "        #linkex-full-queue .secondary { background:#374151; color:#fff; }\n"
    "        #linkex-full-queue .primary-actions { display:grid; grid-template-columns:1fr; gap:7px; margin-bottom:9px; }\n"
    "        #linkex-full-queue .action-main { padding:12px 12px; font-size:14px; }\n"
    "        #linkex-full-queue .action-secondary { padding:8px 10px; font-size:12px; }\n"
    "        #linkex-full-queue details.more { margin-top:9px; border-top:1px solid #374151; padding-top:7px; }\n"
    "        #linkex-full-queue details.more > summary { cursor:pointer; color:#cbd5e1; font-size:12px; font-weight:700; user-select:none; padding:4px 1px 7px; }\n"
    "        #linkex-full-queue details.more .more-body { padding-top:2px; }\n"
    "        #linkex-full-queue [hidden] { display:none !important; }\n",
    'compact UI css',
)

body_prefix_pattern = r'''        <div class="body">\n          <div id="lf-share-context" class="share-context" hidden></div>\n          <input id="lf-url" placeholder="https://l2e\.click/d/xxxxxxxx" />\n          <div class="row"><button id="lf-analyze" class="primary">共有リンクを解析</button><button id="lf-selftest" class="secondary">署名テスト</button></div>\n          <div class="row"><button id="lf-start" class="warn" disabled>全ファイル開始</button><button id="lf-start-selected" class="primary" disabled>選択ファイル開始</button></div>\n          <div id="lf-selection" class="selection" hidden>.*?          </div>\n          <div class="row"><button id="lf-resume" class="primary" disabled>Queueを再開</button><button id="lf-pause" class="secondary" disabled>現在ファイル後に停止</button></div>\n          <div class="row"><button id="lf-retry" class="secondary" disabled>容量スキップを再試行</button><button id="lf-abandon" class="secondary" disabled>Queueを安全に破棄</button></div>\n          <div class="row"><button id="lf-export" class="secondary">診断ログを保存</button><button id="lf-refresh" class="secondary">状態を再表示</button></div>\n(?=          <div class="progress-wrap">)'''

new_body_prefix = '''        <div class="body">\n          <div id="lf-share-context" class="share-context" hidden></div>\n          <input id="lf-url" placeholder="https://l2e.click/d/xxxxxxxx" />\n          <div class="primary-actions">\n            <button id="lf-start" class="primary action-main" disabled>すべてダウンロード</button>\n            <button id="lf-select-mode" class="secondary action-secondary" disabled>ファイルを選ぶ</button>\n          </div>\n          <div id="lf-selection" class="selection" hidden>\n            <div id="lf-selection-meta" class="selection-meta">0 / 0 selected</div>\n            <input id="lf-file-filter" placeholder="ファイル名 / パスで絞り込み" />\n            <div class="selection-actions"><button id="lf-select-all" class="secondary">全件選択</button><button id="lf-clear-all" class="secondary">全解除</button><button id="lf-select-visible" class="secondary">表示中を選択</button><button id="lf-clear-visible" class="secondary">表示中を解除</button></div>\n            <div id="lf-file-list" class="file-list"></div>\n            <div id="lf-selection-note" class="notice"></div>\n            <div class="row" style="margin-top:8px;margin-bottom:0"><button id="lf-start-selected" class="primary" disabled>選択をダウンロード</button></div>\n          </div>\n          <div id="lf-queue-actions" class="row" hidden><button id="lf-resume" class="primary" disabled>Queueを再開</button><button id="lf-pause" class="secondary" disabled>現在ファイル後に停止</button></div>\n'''

s = regex_once(s, body_prefix_pattern, new_body_prefix, 'compact body actions')

s = replace_once(
    s,
    "          <div id=\"lf-status\" class=\"status\">v0.6.0で実機検証済みのトランザクション中核を維持した正式版です。\\n1ファイルずつ COPY → DL → VERIFY → 所有destIdだけDELETE します。</div>\n          <div class=\"notice\">安全規則: copy/delete応答不明時は盲目的に再送しません。削除はLOCAL_COMMITTEDかつ所有権確定済みdestId 1件だけ。実行中は別端末からLinkexを変更しないでください。診断ログはtoken・署名付きURLを伏せて書き出します。</div>",
    "          <div id=\"lf-status\" class=\"status\">共有ページでは「すべてダウンロード」だけで解析からQueue開始まで進めます。\\n安全処理は1ファイルずつ COPY → DL → VERIFY → 所有destIdだけDELETE します。</div>\n"
    "          <details id=\"lf-more\" class=\"more\">\n"
    "            <summary>詳細</summary>\n"
    "            <div class=\"more-body\">\n"
    "              <div class=\"row\"><button id=\"lf-destination\" class=\"secondary\">保存先を変更</button><button id=\"lf-analyze\" class=\"secondary\">共有を再解析</button></div>\n"
    "              <div class=\"row\"><button id=\"lf-selftest\" class=\"secondary\">署名テスト</button><button id=\"lf-export\" class=\"secondary\">診断ログを保存</button></div>\n"
    "              <div class=\"row\"><button id=\"lf-refresh\" class=\"secondary\">状態を再表示</button><button id=\"lf-retry\" class=\"secondary\" disabled>容量スキップを再試行</button></div>\n"
    "              <div class=\"row\" style=\"margin-bottom:0\"><button id=\"lf-abandon\" class=\"secondary\" disabled>Queueを安全に破棄</button></div>\n"
    "            </div>\n"
    "          </details>\n"
    "          <div class=\"notice\">安全規則: copy/delete応答不明時は盲目的に再送しません。削除はLOCAL_COMMITTEDかつ所有権確定済みdestId 1件だけ。実行中は別端末からLinkexを変更しないでください。診断ログはtoken・署名付きURLを伏せて書き出します。</div>",
    'details controls',
)

s = replace_once(
    s,
    "    const startBtn = root.querySelector('#lf-start');\n    const selectedStartBtn = root.querySelector('#lf-start-selected');",
    "    const startBtn = root.querySelector('#lf-start');\n    const selectModeBtn = root.querySelector('#lf-select-mode');\n    const selectedStartBtn = root.querySelector('#lf-start-selected');",
    'select mode selector',
)

s = replace_once(
    s,
    "    const abandonBtn = root.querySelector('#lf-abandon');\n    const exportBtn = root.querySelector('#lf-export');\n    const refreshBtn = root.querySelector('#lf-refresh');",
    "    const abandonBtn = root.querySelector('#lf-abandon');\n    const destinationBtn = root.querySelector('#lf-destination');\n    const queueActions = root.querySelector('#lf-queue-actions');\n    const exportBtn = root.querySelector('#lf-export');\n    const refreshBtn = root.querySelector('#lf-refresh');",
    'extra compact UI selectors',
)

s = replace_once(
    s,
    "    let activeRunJob = null;\n    let selectedIndexes = new Set();\n    let pageShareTarget = null;",
    "    let activeRunJob = null;\n    let selectedIndexes = new Set();\n    let selectionExpanded = false;\n    let preparing = false;\n    let pageShareTarget = null;\n    let preferredBaseDirHandle = null;\n    let preferredDirPermission = 'unknown';\n    let preferredHandleReady = false;",
    'compact UI state',
)

helper_marker = "    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }\n\n"
helper_text = '''    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }\n\n    function preferredDirectoryLabel() {\n      if (!preferredHandleReady) return '読み込み中…';\n      if (!preferredBaseDirHandle) return '未設定（初回に選択）';\n      const suffix = preferredDirPermission === 'granted' ? '' : '（再許可が必要）';\n      return `${preferredBaseDirHandle.name || '選択済みフォルダ'}${suffix}`;\n    }\n\n    async function refreshPreferredDirectoryState({reloadHandle = false} = {}) {\n      try {\n        if (reloadHandle || !preferredHandleReady) preferredBaseDirHandle = await idbGetHandle(PREFERRED_DIR_HANDLE_KEY);\n        if (!preferredBaseDirHandle) preferredDirPermission = 'missing';\n        else if (preferredBaseDirHandle.queryPermission) preferredDirPermission = await preferredBaseDirHandle.queryPermission({mode:'readwrite'});\n        else preferredDirPermission = 'prompt';\n      } catch (e) {\n        console.warn('[Linkex preferred directory]', e);\n        preferredBaseDirHandle = null;\n        preferredDirPermission = 'missing';\n      } finally {\n        preferredHandleReady = true;\n        syncSharePageContext({initial:true});\n        refreshQueueUi();\n      }\n    }\n\n    async function rememberPreferredDirectory(handle) {\n      await idbPutHandle(PREFERRED_DIR_HANDLE_KEY, handle);\n      preferredBaseDirHandle = handle;\n      preferredDirPermission = 'granted';\n      preferredHandleReady = true;\n      syncSharePageContext({initial:true});\n      refreshQueueUi();\n      return handle;\n    }\n\n    async function acquirePreferredBaseDirFromGesture({forcePicker = false} = {}) {\n      // showDirectoryPicker / requestPermission はuser gestureが必要。\n      // この関数のpicker分岐より前にnetwork/IDB awaitを置かないこと。\n      if (forcePicker || !preferredBaseDirHandle || preferredDirPermission === 'denied' || preferredDirPermission === 'missing') {\n        const picked = await invokeDirectoryPicker({mode:'readwrite'});\n        await ensureHandlePermission(picked);\n        return await rememberPreferredDirectory(picked);\n      }\n      if (preferredDirPermission === 'granted') return preferredBaseDirHandle;\n      if (preferredBaseDirHandle.requestPermission) {\n        const permission = await preferredBaseDirHandle.requestPermission({mode:'readwrite'});\n        preferredDirPermission = permission;\n        if (permission === 'granted') {\n          syncSharePageContext({initial:true});\n          refreshQueueUi();\n          return preferredBaseDirHandle;\n        }\n      }\n      throw new LinkexError('保存先フォルダへの書き込み権限がありません。「詳細」→「保存先を変更」から選び直してください。', {kind:'filesystem'});\n    }\n\n'''
s = replace_once(s, helper_marker, helper_text, 'preferred directory helpers')

s = replace_once(
    s,
    "        shareContextEl.textContent = `このページの共有: ${shortShareToken(next.shareToken)} · Linkex認証連携: ${authReady ? '準備済み' : '未準備（初回はdisk.linkex.ioを開いてください）'}`;\n        analyzeBtn.textContent = 'この共有を解析';",
    "        shareContextEl.textContent = `このページの共有: ${shortShareToken(next.shareToken)} · 認証: ${authReady ? '準備済み' : '未準備'} · 保存先: ${preferredDirectoryLabel()}`;\n        analyzeBtn.textContent = 'この共有を再解析';",
    'share context destination',
)

s = replace_once(s, "        analyzeBtn.textContent = '共有リンクを解析';", "        analyzeBtn.textContent = '共有URLを解析';", 'manual analyze label')
s = replace_once(s, "      if (onShareHost && !running && manifest && manifest.shareToken !== nextToken) {", "      if (onShareHost && !running && !preparing && manifest && manifest.shareToken !== nextToken) {", 'stale manifest busy guard')
s = replace_once(s, "        manifest = null;\n        selectedIndexes.clear();\n        fileFilter.value = '';\n        renderSelection();", "        manifest = null;\n        selectedIndexes.clear();\n        selectionExpanded = false;\n        fileFilter.value = '';\n        renderSelection();", 'stale manifest selection reset')

s = replace_once(s, "      selectionPanel.hidden = !hasManifest;", "      selectionPanel.hidden = !hasManifest || !selectionExpanded;", 'selection progressive disclosure')
s = replace_once(s, "    fileFilter.addEventListener('input', renderSelection);", "    input.addEventListener('input', refreshQueueUi);\n    fileFilter.addEventListener('input', renderSelection);", 'manual URL refresh')

refresh_pattern = r'''    function refreshQueueUi\(\) \{.*?      return job;\n    \}\n\n(?=    collapseBtn\.addEventListener)'''
refresh_new = '''    function refreshQueueUi() {\n      const job = loadQueueJob();\n      const active = job && !isTerminal(job);\n      const busy = running || preparing;\n      const hasShareInput = !!detectSharePageTarget(globalThis.location?.href || '') || !!String(input.value || '').trim();\n      resumeBtn.disabled = busy || !active;\n      resumeBtn.hidden = running || !active;\n      pauseBtn.disabled = !running || !activeRunJob || !!activeRunJob.stopRequested;\n      pauseBtn.hidden = !running;\n      queueActions.hidden = resumeBtn.hidden && pauseBtn.hidden;\n      startBtn.disabled = busy || !!active || !hasShareInput || !preferredHandleReady;\n      selectModeBtn.disabled = busy || !!active || !hasShareInput;\n      selectedStartBtn.disabled = busy || !manifest?.files?.length || selectedIndexes.size === 0 || !!active || !preferredHandleReady;\n      const c = queueCounts(job);\n      retryBtn.disabled = busy || !job || !(c.skippedCapacity || c.unfittable) || !isTerminal(job);\n      abandonBtn.disabled = busy || !active;\n      analyzeBtn.disabled = busy || !hasShareInput;\n      destinationBtn.disabled = busy;\n      refreshProgress();\n      return job;\n    }\n\n'''
s = regex_once(s, refresh_pattern, refresh_new, 'refreshQueueUi compact state')

analyze_pattern = r'''    analyzeBtn\.addEventListener\('click', async \(\) => \{.*?    \}\);\n\n(?=    async function runJob)'''
analyze_new = '''    async function analyzeCurrentShare({announceSuccess = true} = {}) {\n      const pageTargetAtStart = detectSharePageTarget(globalThis.location?.href || '');\n      const sourceInput = pageTargetAtStart?.href || input.value;\n      const token = pageTargetAtStart?.shareToken || parseShareToken(sourceInput);\n      GM_setValue(LAST_URL_KEY, String(sourceInput || '').trim());\n      const api = new LinkexApi({token:null});\n      write('共有manifestを読み取り中…');\n      const nextManifest = await buildManifest(api, token, x => write(`共有manifestを読み取り中…\\nfiles: ${x.files}\\n${x.path || ''}`));\n      if (pageTargetAtStart) {\n        const currentTarget = detectSharePageTarget(globalThis.location?.href || '');\n        if (currentTarget?.shareToken !== token) throw new LinkexError('解析中に共有ページが変わりました。現在の共有をもう一度解析してください。', {kind:'share_context_changed'});\n      }\n      manifest = nextManifest;\n      selectedIndexes = new Set(manifest.files.map((_, i) => i));\n      fileFilter.value = '';\n      renderSelection();\n      const largest = [...manifest.files].sort((a,b)=>Number(b.size||0)-Number(a.size||0))[0];\n      if (announceSuccess) {\n        write([\n          '解析成功（読み取りのみ）',\n          `共有名: ${manifest.shareName || '(unknown)'}`,\n          `全ファイル: ${manifest.files.length}`,\n          `全フォルダ: ${manifest.folders.length}`,\n          `合計: ${formatBytes(manifest.totalBytes)}`,\n          largest ? `最大ファイル: ${formatBytes(largest.size)}  ${largest.remotePath}` : '',\n          '',\n          '全件なら「すべてダウンロード」、必要なものだけなら「ファイルを選ぶ」を使えます。'\n        ].filter(Boolean).join('\\n'), 'ok');\n      }\n      recordEvent('info', 'manifest', '共有解析成功', {shareName:manifest.shareName, fileCount:manifest.files.length, folderCount:manifest.folders.length, totalBytes:manifest.totalBytes});\n      return manifest;\n    }\n\n    function handleAnalyzeFailure(e) {\n      console.error('[Linkex analyze]', e);\n      write(`解析失敗: ${e?.message || e}`, 'err');\n      recordEvent('error', 'manifest', `共有解析失敗: ${e?.message || e}`);\n      manifest = null;\n      selectedIndexes.clear();\n      selectionExpanded = false;\n      renderSelection();\n    }\n\n    analyzeBtn.addEventListener('click', async () => {\n      if (running || preparing) return;\n      preparing = true;\n      refreshQueueUi();\n      try { await analyzeCurrentShare({announceSuccess:true}); }\n      catch (e) { handleAnalyzeFailure(e); }\n      finally { preparing = false; refreshQueueUi(); }\n    });\n\n'''
s = regex_once(s, analyze_pattern, analyze_new, 'shared analysis function')

start_pattern = r'''    async function startManifestQueue\(selection = null\) \{.*?    startBtn\.addEventListener\('click', \(\) => startManifestQueue\(null\)\);\n    selectedStartBtn\.addEventListener\('click', \(\) => startManifestQueue\(new Set\(selectedIndexes\)\)\);\n\n(?=    resumeBtn\.addEventListener)'''
start_new = '''    async function startManifestQueue(selection = null, {baseDir = null, skipConfirm = false} = {}) {\n      if (!manifest || running) return;\n      const selected = selection == null ? null : Array.from(selection).sort((a,b) => a - b);\n      const chosenFiles = selected == null ? manifest.files : selected.map(index => manifest.files[index]).filter(Boolean);\n      if (!chosenFiles.length) { write('処理するファイルが選択されていません。', 'err'); return; }\n      const currentHref = String(globalThis.location?.href || '');\n      const currentPageTarget = detectSharePageTarget(currentHref);\n      if (isSharePageHost(currentHref) && (!currentPageTarget || currentPageTarget.shareToken !== manifest.shareToken)) {\n        manifest = null;\n        selectedIndexes.clear();\n        selectionExpanded = false;\n        fileFilter.value = '';\n        renderSelection();\n        write('共有ページが解析時点から変わっています。現在の共有をもう一度解析してください。', 'err');\n        syncSharePageContext({initial:true});\n        return;\n      }\n      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }\n      const totalBytes = chosenFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);\n      const modeText = selected == null ? '全ファイル' : '選択ファイル';\n      if (!skipConfirm) {\n        const pageWindow = getNativePageWindow();\n        const ok = Reflect.apply(pageWindow.confirm, pageWindow, [`${modeText} ${chosenFiles.length}件（合計 ${formatBytes(totalBytes)}）を順番に処理します。\\n\\n各ファイルはLinkexへ一時コピー → ローカル検証 → 確定済み一時コピーだけ削除します。\\n開始しますか？`]);\n        if (!ok) return;\n      }\n      let chosenBaseDir = baseDir;\n      if (!chosenBaseDir) {\n        try { chosenBaseDir = await invokeDirectoryPicker({mode:'readwrite'}); }\n        catch (e) { if (e?.name !== 'AbortError') write(`保存先選択失敗: ${e?.message || e}`, 'err'); return; }\n      }\n      running = true;\n      try {\n        await acquireLease();\n        const activeJob = loadQueueJob();\n        if (activeJob && !isTerminal(activeJob)) throw new LinkexError('別の未完了Queueを検出しました。状態を再表示してから再開または整理してください。', {kind:'queue_conflict'});\n        await ensureHandlePermission(chosenBaseDir);\n        const job = createQueueFromManifest(manifest, selected);\n        const queueRoot = await chosenBaseDir.getDirectoryHandle(job.folderName, {create:true});\n        await putQueueRootHandle(job, queueRoot);\n        saveQueueJob(job);\n        recordEvent('info', 'queue-created', `Queue作成: ${job.jobId}`, {jobId:job.jobId, selectionMode:job.selectionMode, sourceOriginalCount:job.sourceOriginalCount, shareName:job.shareName, folderName:job.folderName, items:job.items.length, totalBytes:job.sourceTotalBytes});\n        write(`${modeText} Queue作成\\n\\n${queueSummary(job)}\\n\\n${job.items.length}ファイルを順次処理します。`, 'ok');\n        await runJob(job, queueRoot, false);\n      } catch (e) {\n        console.error('[Linkex Queue]', e);\n        const job = loadQueueJob();\n        write(`Queue停止: ${e?.message || e}\\n\\n${queueSummary(job)}\\n\\n危険な状態では安全側で停止します。「Queueを再開」はcopy/delete POSTを盲目的に再送しません。`, 'err');\n      } finally { running = false; releaseLease(); syncSharePageContext({initial:true}); refreshQueueUi(); }\n    }\n\n    startBtn.addEventListener('click', async () => {\n      if (running || preparing) return;\n      const active = loadQueueJob();\n      if (active && !isTerminal(active)) { write('未完了Queueがあります。先に「Queueを再開」または詳細から状態を確認してください。'); refreshQueueUi(); return; }\n      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }\n      preparing = true;\n      refreshQueueUi();\n      try {\n        // user gestureが失われる前に保存先permission/pickerを確定し、その後でnetwork解析する。\n        const baseDir = await acquirePreferredBaseDirFromGesture();\n        await analyzeCurrentShare({announceSuccess:false});\n        preparing = false;\n        refreshQueueUi();\n        await startManifestQueue(null, {baseDir, skipConfirm:true});\n      } catch (e) {\n        if (e?.name !== 'AbortError') {\n          if (e?.kind === 'filesystem') write(`保存先準備失敗: ${e?.message || e}`, 'err');\n          else handleAnalyzeFailure(e);\n        }\n      } finally {\n        preparing = false;\n        refreshQueueUi();\n      }\n    });\n\n    selectModeBtn.addEventListener('click', async () => {\n      if (running || preparing) return;\n      preparing = true;\n      refreshQueueUi();\n      try {\n        await analyzeCurrentShare({announceSuccess:false});\n        selectionExpanded = true;\n        renderSelection();\n        write(`ファイルを選択してください。\\n${manifest.files.length}件 / ${formatBytes(manifest.totalBytes)}\\n選択後に「選択をダウンロード」を押します。`, 'ok');\n      } catch (e) { handleAnalyzeFailure(e); }\n      finally { preparing = false; refreshQueueUi(); }\n    });\n\n    selectedStartBtn.addEventListener('click', async () => {\n      if (running || preparing || !manifest || !selectedIndexes.size) return;\n      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }\n      preparing = true;\n      refreshQueueUi();\n      try {\n        const baseDir = await acquirePreferredBaseDirFromGesture();\n        preparing = false;\n        refreshQueueUi();\n        await startManifestQueue(new Set(selectedIndexes), {baseDir, skipConfirm:true});\n      } catch (e) {\n        if (e?.name !== 'AbortError') write(`保存先準備失敗: ${e?.message || e}`, 'err');\n      } finally { preparing = false; refreshQueueUi(); }\n    });\n\n    destinationBtn.addEventListener('click', async () => {\n      if (running || preparing) return;\n      preparing = true;\n      refreshQueueUi();\n      try {\n        const handle = await acquirePreferredBaseDirFromGesture({forcePicker:true});\n        write(`保存先を「${handle.name || '選択済みフォルダ'}」に設定しました。次回から権限が有効なら1クリックで開始できます。`, 'ok');\n      } catch (e) {\n        if (e?.name !== 'AbortError') write(`保存先変更失敗: ${e?.message || e}`, 'err');\n      } finally { preparing = false; refreshQueueUi(); }\n    });\n\n'''
s = regex_once(s, start_pattern, start_new, 'quick and selected start flow')

s = replace_once(
    s,
    "    syncSharePageContext({initial:true});\n    let observedPageHref = String(globalThis.location?.href || '');",
    "    syncSharePageContext({initial:true});\n    void refreshPreferredDirectoryState({reloadHandle:true});\n    let observedPageHref = String(globalThis.location?.href || '');",
    'preferred directory preload',
)

s = replace_once(
    s,
    "    globalThis.addEventListener?.('focus', () => {\n      if (isDiskStoragePage()) syncCredentialBridgeFromDisk();\n      syncSharePageContext({initial:true});\n    });",
    "    globalThis.addEventListener?.('focus', () => {\n      if (isDiskStoragePage()) syncCredentialBridgeFromDisk();\n      void refreshPreferredDirectoryState({reloadHandle:false});\n      syncSharePageContext({initial:true});\n    });",
    'focus permission refresh',
)

s = s.replace('別共有は解析して「全ファイル開始」できます。', '別共有は「すべてダウンロード」から開始できます。')

path.write_text(s, encoding='utf-8')

# Update tests while preserving all existing safety coverage.
test_path = Path('tests/linkex-downloader.test.js')
t = test_path.read_text(encoding='utf-8')
t = t.replace("SOURCE.indexOf('async function startManifestQueue(selection = null)')", "SOURCE.indexOf('async function startManifestQueue(selection = null,')")

extra_tests = r'''

test('compact first screen centers quick all-download and file selection while advanced controls live under details', () => {
  assert.match(SOURCE, /id="lf-start" class="primary action-main" disabled>すべてダウンロード<\/button>/);
  assert.match(SOURCE, /id="lf-select-mode" class="secondary action-secondary" disabled>ファイルを選ぶ<\/button>/);
  const detailsAt = SOURCE.indexOf('<details id="lf-more" class="more">');
  const detailsEnd = SOURCE.indexOf('</details>', detailsAt);
  assert.ok(detailsAt > 0 && detailsEnd > detailsAt);
  const detailsBlock = SOURCE.slice(detailsAt, detailsEnd);
  for (const id of ['lf-destination', 'lf-analyze', 'lf-selftest', 'lf-export', 'lf-refresh', 'lf-retry', 'lf-abandon']) {
    assert.match(detailsBlock, new RegExp(`id="${id}"`));
  }
});

test('preferred download directory is separate from Queue-specific handles and is preloaded before quick actions enable', () => {
  assert.match(SOURCE, /const PREFERRED_DIR_HANDLE_KEY = 'preferred-download-root:v1';/);
  assert.match(SOURCE, /const QUEUE_HANDLE_PREFIX = 'queue-full:';/);
  assert.match(SOURCE, /idbPutHandle\(PREFERRED_DIR_HANDLE_KEY, handle\)/);
  assert.match(SOURCE, /void refreshPreferredDirectoryState\(\{reloadHandle:true\}\)/);
  const refreshAt = SOURCE.indexOf('function refreshQueueUi()');
  const collapseAt = SOURCE.indexOf("collapseBtn.addEventListener('click'", refreshAt);
  const block = SOURCE.slice(refreshAt, collapseAt);
  assert.match(block, /startBtn\.disabled = busy \|\| !!active \|\| !hasShareInput \|\| !preferredHandleReady;/);
});

test('quick all-download resolves directory permission before network manifest analysis and starts without confirm', () => {
  const quickAt = SOURCE.indexOf("startBtn.addEventListener('click', async () => {");
  const selectAt = SOURCE.indexOf("selectModeBtn.addEventListener('click'", quickAt);
  assert.ok(quickAt > 0 && selectAt > quickAt);
  const block = SOURCE.slice(quickAt, selectAt);
  const dirAt = block.indexOf('await acquirePreferredBaseDirFromGesture()');
  const analyzeAt = block.indexOf('await analyzeCurrentShare({announceSuccess:false})');
  const startAt = block.indexOf('await startManifestQueue(null, {baseDir, skipConfirm:true})');
  assert.ok(dirAt >= 0 && analyzeAt > dirAt && startAt > analyzeAt);
  assert.doesNotMatch(block, /confirm\(/);
});

test('preferred directory picker branch has no network or IndexedDB await before showDirectoryPicker', () => {
  const helperAt = SOURCE.indexOf('async function acquirePreferredBaseDirFromGesture');
  const nextAt = SOURCE.indexOf('function shortShareToken', helperAt);
  assert.ok(helperAt > 0 && nextAt > helperAt);
  const block = SOURCE.slice(helperAt, nextAt);
  const pickerAt = block.indexOf("await invokeDirectoryPicker({mode:'readwrite'})");
  assert.ok(pickerAt > 0);
  const beforePicker = block.slice(0, pickerAt);
  assert.doesNotMatch(beforePicker, /buildManifest|idbGetHandle|GM_xmlhttpRequest|LinkexApi/);
});

test('selection UI stays collapsed after analysis until explicit file-selection mode', () => {
  assert.match(SOURCE, /let selectionExpanded = false;/);
  assert.match(SOURCE, /selectionPanel\.hidden = !hasManifest \|\| !selectionExpanded;/);
  const selectAt = SOURCE.indexOf("selectModeBtn.addEventListener('click'");
  const selectedStartAt = SOURCE.indexOf("selectedStartBtn.addEventListener('click'", selectAt);
  const block = SOURCE.slice(selectAt, selectedStartAt);
  assert.match(block, /selectionExpanded = true;/);
});

test('Queue resume remains bound to its Queue-specific directory handle, never the preferred new-Queue destination', () => {
  const resumeAt = SOURCE.indexOf("resumeBtn.addEventListener('click'");
  const pauseAt = SOURCE.indexOf("pauseBtn.addEventListener('click'", resumeAt);
  const block = SOURCE.slice(resumeAt, pauseAt);
  assert.match(block, /const queueRoot = await getQueueRootHandle\(job\);/);
  assert.doesNotMatch(block, /PREFERRED_DIR_HANDLE_KEY|preferredBaseDirHandle/);
});
'''
if "compact first screen centers quick all-download" not in t:
    t += extra_tests

test_path.write_text(t, encoding='utf-8')

# Documentation updates.
change_path = Path('CHANGELOG.md')
c = change_path.read_text(encoding='utf-8')
c = replace_once(
    c,
    "- 共有ページのSPA/URL変更を検知し、実行中Queueの `shareToken` は固定したまま古いmanifestだけを安全に無効化するpage-context guard\n",
    "- 共有ページのSPA/URL変更を検知し、実行中Queueの `shareToken` は固定したまま古いmanifestだけを安全に無効化するpage-context guard\n"
    "- 共有ページの「すべてダウンロード」1操作で保存先準備 → 自動解析 → Full Queue開始まで進むQuick Download\n"
    "- 新規Queue用の保存先DirectoryHandleを記憶し、権限が残っている場合は次回以降の保存先選択を省略\n\n"
    "### Changed\n\n"
    "- 初期UIを「すべてダウンロード」「ファイルを選ぶ」中心に整理し、診断・再試行・安全破棄等を `詳細` へ集約\n",
    'changelog quick download',
)
change_path.write_text(c, encoding='utf-8')

readme_path = Path('README.md')
r = readme_path.read_text(encoding='utf-8')
r = replace_once(
    r,
    "- `https://l2e.click/d/...` 共有ページ上から「この共有を解析」（URLコピー不要）\n",
    "- `https://l2e.click/d/...` 共有ページ上からURLコピー不要で操作\n- **「すべてダウンロード」1操作**で保存先準備 → 自動解析 → Full Queue開始（初回のみ保存先選択）\n- 保存先DirectoryHandleを記憶し、権限が残っていれば2回目以降は保存先ダイアログも省略\n",
    'README feature bullets',
)
r = regex_once(
    r,
    r'''### 共有ページから使う（推奨）\n\n.*?\n### 自ストレージページから使う（従来互換）''',
    '''### 共有ページから使う（推奨）\n\n1. 更新後の初回だけ、Linkexへログインした状態で `https://disk.linkex.io/` を一度開きます。Downloaderがuserscript-privateなGM storageへaccess tokenを短時間連携します。\n2. 保存したい `https://l2e.click/d/...` 共有リンクをブラウザでそのまま開きます。\n3. 全件なら **すべてダウンロード** を押します。初回だけ保存先フォルダを選択します。\n4. Downloaderが共有を自動解析し、そのままFull Queueを開始します。追加の解析/開始確認クリックはありません。\n5. 2回目以降は保存先権限が残っていれば、**すべてダウンロード** 1回だけで開始できます。\n\n一部ファイルだけ欲しい場合は **ファイルを選ぶ** を押し、検索/チェック後に **選択をダウンロード** を押します。\n\n診断、署名テスト、保存先変更、容量skip再試行、安全破棄など低頻度操作は **詳細** にまとめています。\n\n### 自ストレージページから使う（従来互換）''',
    'README quick usage',
)
r = regex_once(
    r,
    r'''## UIボタン\n\n\| ボタン \| 用途 \|\n\|---\|---\|\n.*?\n## 停止について''',
    '''## UIボタン\n\n通常時に表へ出す主操作は少数に絞っています。\n\n| ボタン | 用途 |\n|---|---|\n| **すべてダウンロード** | 現在の共有を必要なら自動解析し、保存先準備後にFull Queueをそのまま開始 |\n| **ファイルを選ぶ** | 共有を解析してファイル選択UIを展開 |\n| **選択をダウンロード** | チェック済みファイルだけでQueue開始 |\n| **Queueを再開** | 保存済み未完了Queueを実状態照合から再開（未完了時のみ表示） |\n| **現在ファイル後に停止** | 現在ファイルの安全な処理境界後に停止予約（実行中のみ表示） |\n| **詳細** | 保存先変更、再解析、署名テスト、診断ログ、状態再表示、容量skip再試行、安全破棄を格納 |\n| **− / +** | パネルを最小化/展開 |\n\n## 停止について''',
    'README UI table',
)
readme_path.write_text(r, encoding='utf-8')

arch_path = Path('docs/ARCHITECTURE.md')
a = arch_path.read_text(encoding='utf-8')
if 'preferred-download-root:v1' not in a:
    a += "\n\n## Quick Download / preferred保存先\n\n新規Queue用のbase directoryは `preferred-download-root:v1` として既存IndexedDB `handles` storeへDirectoryHandleを保存できます。これは新規Queueの利便性専用で、未完了Queueのresume先には使用しません。resumeは常に従来どおり `queue-full:<jobId>` のQueue固有DirectoryHandleを使います。\n\n共有ページの `すべてダウンロード` は、File System Access APIのuser-gesture制約を守るため、保存先permission/pickerを先に確定してから共有manifestのnetwork解析へ進みます。詳細は [`QUICK_DOWNLOAD_UI.md`](QUICK_DOWNLOAD_UI.md) を参照してください。\n"
arch_path.write_text(a, encoding='utf-8')

trouble_path = Path('docs/TROUBLESHOOTING.md')
tr = trouble_path.read_text(encoding='utf-8')
if '「すべてダウンロード」で保存先選択が毎回出る' not in tr:
    tr += "\n\n## 「すべてダウンロード」で保存先選択が毎回出る\n\n初回はブラウザ仕様上、保存先フォルダを明示的に選ぶ必要があります。Downloaderは選択したDirectoryHandleをIndexedDBへ記憶します。\n\n2回目以降も毎回pickerが出る場合は、サイト/ブラウザのファイルシステム権限が保持されていない、サイトデータが消去された、別origin（`l2e.click` / `www.l2e.click` 等）で開いている、または保存先Handleが無効になった可能性があります。`詳細` → `保存先を変更` から選び直してください。\n\n未完了Queueの再開先はpreferred保存先へ自動変更されません。再開は開始時のQueue固有DirectoryHandleだけを使用します。\n"
trouble_path.write_text(tr, encoding='utf-8')

print('quick-download UI patch applied')
