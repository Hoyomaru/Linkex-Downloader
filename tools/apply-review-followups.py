from pathlib import Path

src_path = Path('linkex-downloader.user.js')
s = src_path.read_text(encoding='utf-8')


def replace_exact(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)

# 10: remove dead single-file picker helper.
s = replace_exact(s,
"""  async function invokeSaveFilePicker(options) {
    const pageWindow = getNativePageWindow();
    const picker = pageWindow?.showSaveFilePicker;
    if (typeof picker !== 'function') {
      throw new LinkexError('このブラウザではFile System Access APIが利用できません。Edge/Chromeの通常ウィンドウで実行してください。');
    }
    // Tampermonkey sandbox 経由の Window メソッドは `this` が userscript 側 Window になると
    // Chromium が Illegal invocation を返す。必ずページ本体 Window を receiver に固定する。
    return await Reflect.apply(picker, pageWindow, [options]);
  }

""", "", 'remove invokeSaveFilePicker')

# 8: read-only GET retry helpers.
s = replace_exact(s,
"""  function gmRequest({ method = 'GET', url, headers = {}, data, timeout = 90000 }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, headers, data, timeout,
        responseType: 'json',
        onload: res => resolve(res),
        ontimeout: () => reject(new LinkexError('Request timeout', {kind:'network', url})),
        onerror: err => reject(new LinkexError('Network error', {kind:'network', url, cause:err})),
        onabort: () => reject(new LinkexError('Request aborted', {kind:'network', url}))
      });
    });
  }

  class LinkexApi {
""",
"""  function gmRequest({ method = 'GET', url, headers = {}, data, timeout = 90000 }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, headers, data, timeout,
        responseType: 'json',
        onload: res => resolve(res),
        ontimeout: () => reject(new LinkexError('Request timeout', {kind:'network', url})),
        onerror: err => reject(new LinkexError('Network error', {kind:'network', url, cause:err})),
        onabort: () => reject(new LinkexError('Request aborted', {kind:'network', url}))
      });
    });
  }

  function parseRetryAfterMs(responseHeaders) {
    const line = String(responseHeaders || '').split(/\\r?\\n/).find(x => /^retry-after\\s*:/i.test(x));
    if (!line) return null;
    const value = line.slice(line.indexOf(':') + 1).trim();
    if (/^\\d+(?:\\.\\d+)?$/.test(value)) return Math.max(0, Math.round(Number(value) * 1000));
    const when = Date.parse(value);
    return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
  }

  function isRetryableReadStatus(status) {
    const n = Number(status || 0);
    return n === 429 || (n >= 500 && n <= 599);
  }

  class LinkexApi {
""", 'insert GET retry helpers')

s = replace_exact(s,
"""      const signed = signRequest({method, path, headers: baseHeaders, body: bodyText});
      const headers = {
        ...baseHeaders,
        'X-LinkInflu-Ts': signed.timestamp,
        'X-LinkInflu-Sign': signed.signature
      };
      if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;

      const res = await gmRequest({method, url: API_BASE + path, headers, data: body === undefined ? undefined : bodyText});
      let payload = res.response;
""",
"""      const upperMethod = String(method || 'GET').toUpperCase();
      const maxAttempts = upperMethod === 'GET' ? 4 : 1;
      let res = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Retryごとにtimestamp/signatureを作り直す。POST/PUT/PATCHは絶対に自動retryしない。
        const signed = signRequest({method:upperMethod, path, headers:baseHeaders, body:bodyText});
        const headers = {
          ...baseHeaders,
          'X-LinkInflu-Ts': signed.timestamp,
          'X-LinkInflu-Sign': signed.signature
        };
        if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
        res = await gmRequest({method:upperMethod, url:API_BASE + path, headers, data:body === undefined ? undefined : bodyText});
        if (res.status >= 200 && res.status < 300) break;
        if (attempt >= maxAttempts || !isRetryableReadStatus(res.status)) break;
        const retryAfter = parseRetryAfterMs(res.responseHeaders);
        const backoff = retryAfter ?? Math.min(1000 * (2 ** (attempt - 1)), 8000);
        await sleep(backoff);
      }

      let payload = res?.response;
""", 'GET-only request retry')

# 10: remove unused token redactor.
s = replace_exact(s,
"""  function redactToken(s) {
    if (!s) return null;
    return `${s.slice(0, 8)}…${s.slice(-6)}`;
  }

""", "", 'remove redactToken')

# 9: IndexedDB handle deletion.
s = replace_exact(s,
"""  async function idbGetHandle(operationId) {
    const db = await openDownloadDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DOWNLOAD_STORE, 'readonly');
        const req = tx.objectStore(DOWNLOAD_STORE).get(operationId);
        req.onsuccess = () => resolve(req.result?.handle || null);
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      });
    } finally { db.close(); }
  }

  async function ensureHandlePermission(handle) {
""",
"""  async function idbGetHandle(operationId) {
    const db = await openDownloadDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DOWNLOAD_STORE, 'readonly');
        const req = tx.objectStore(DOWNLOAD_STORE).get(operationId);
        req.onsuccess = () => resolve(req.result?.handle || null);
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      });
    } finally { db.close(); }
  }

  async function idbDeleteHandle(operationId) {
    if (!operationId) return;
    const db = await openDownloadDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DOWNLOAD_STORE, 'readwrite');
        tx.objectStore(DOWNLOAD_STORE).delete(operationId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
      });
    } finally { db.close(); }
  }

  async function ensureHandlePermission(handle) {
""", 'add idbDeleteHandle')

# 9: compact completed transaction snapshots.
s = replace_exact(s,
"""  function syncTxFromProbe(job, index) {
    const tx = loadProbeState();
    if (tx && tx.operationId === job.items[index]?.tx?.operationId) {
      job.items[index].tx = tx;
      saveQueueJob(job);
    }
    return job.items[index].tx;
  }

  async function acquireLease() {
""",
"""  function syncTxFromProbe(job, index) {
    const tx = loadProbeState();
    if (tx && tx.operationId === job.items[index]?.tx?.operationId) {
      job.items[index].tx = tx;
      saveQueueJob(job);
    }
    return job.items[index].tx;
  }

  function compactDoneTx(tx) {
    if (!tx || tx.state !== 'DONE') return tx;
    const confirmed = tx.confirmedDest ? {
      id:tx.confirmedDest.id,
      name:tx.confirmedDest.name,
      size:Number(tx.confirmedDest.size || 0),
      created_at:tx.confirmedDest.created_at ?? null,
      createdAt:tx.confirmedDest.createdAt ?? null
    } : null;
    const download = tx.download ? {
      destId:tx.download.destId,
      downloadedBytes:Number(tx.download.downloadedBytes ?? 0),
      expectedCdnBytes:Number(tx.download.expectedCdnBytes ?? 0),
      sizeVerified:tx.download.sizeVerified ?? null,
      sourceMetaSize:Number(tx.download.sourceMetaSize ?? tx.source?.size ?? 0),
      verifiedAt:tx.download.verifiedAt ?? null,
      localName:tx.download.localName ?? null
    } : null;
    const deletion = tx.delete ? {
      destId:tx.delete.destId ?? confirmed?.id ?? null,
      confirmedAbsentAt:tx.delete.confirmedAbsentAt ?? null,
      alreadyAbsent:!!tx.delete.alreadyAbsent,
      requestCompletedAt:tx.delete.requestCompletedAt ?? null
    } : null;
    return {
      schemaVersion:tx.schemaVersion ?? 1,
      operationId:tx.operationId,
      state:'DONE',
      source:tx.source,
      confirmedDest:confirmed,
      download,
      delete:deletion,
      startedAt:tx.startedAt ?? null,
      reconciledAt:tx.reconciledAt ?? null,
      queueJobId:tx.queueJobId ?? null,
      queueIndex:tx.queueIndex ?? null
    };
  }

  function compactCompletedItem(job, item) {
    if (!item?.tx || item.tx.state !== 'DONE') return false;
    item.tx = compactDoneTx(item.tx);
    item.state = 'DONE';
    item.lastError = null;
    const probe = loadProbeState();
    if (probe?.operationId === item.tx.operationId) saveProbeState(item.tx);
    return true;
  }

  async function acquireLease() {
""", 'add DONE compaction')

s = replace_exact(s,
"""      const item = job.items[i];
      if (item.state === 'DONE' || item.tx?.state === 'DONE') { item.state = 'DONE'; continue; }
      if (['SKIPPED_CAPACITY','UNFITTABLE'].includes(item.state)) continue;
""",
"""      const item = job.items[i];
      if (item.state === 'DONE' || item.tx?.state === 'DONE') {
        compactCompletedItem(job, item);
        saveQueueJob(job);
        continue;
      }
      if (['SKIPPED_CAPACITY','UNFITTABLE'].includes(item.state)) continue;
""", 'compact already-DONE item')

s = replace_exact(s,
"""        await ensureDeleted(api, job, i, onStatus);
        item.state = 'DONE';
        item.lastError = null;
        saveQueueJob(job);
""",
"""        await ensureDeleted(api, job, i, onStatus);
        compactCompletedItem(job, item);
        saveQueueJob(job);
""", 'compact newly DONE item')

s = replace_exact(s,
"""    job.state = (c.skippedCapacity || c.unfittable || c.blocked) ? 'DONE_WITH_SKIPS' : 'DONE';
    job.completedAt = Date.now();
    saveQueueJob(job);
    return job;
  }

  function resetRetryableSkips(job) {
""",
"""    job.state = (c.skippedCapacity || c.unfittable || c.blocked) ? 'DONE_WITH_SKIPS' : 'DONE';
    job.completedAt = Date.now();
    saveQueueJob(job);
    if (job.state === 'DONE') {
      try {
        await idbDeleteHandle(`${QUEUE_HANDLE_PREFIX}${job.jobId}`);
      } catch (e) {
        recordEvent('warn', 'handle-cleanup', `完了Queueの保存先Handle整理に失敗: ${e?.message || e}`, {jobId:job.jobId});
      }
    }
    return job;
  }

  async function abandonQueueJob(job) {
    if (!job?.jobId) return {cleared:false, handleCleanupError:null};
    let handleCleanupError = null;
    try { await idbDeleteHandle(`${QUEUE_HANDLE_PREFIX}${job.jobId}`); }
    catch (e) { handleCleanupError = e?.message || String(e); }
    const probe = loadProbeState();
    GM_setValue(QUEUE_KEY, null);
    if (!probe || probe.queueJobId === job.jobId) GM_setValue(PROBE_KEY, null);
    return {cleared:true, handleCleanupError};
  }

  function resetRetryableSkips(job) {
""", 'cleanup completed queue + abandon helper')

# 7: queue abandon UI.
s = replace_exact(s,
"""          <div class=\"row\"><button id=\"lf-pause\" class=\"secondary\" disabled>現在ファイル後に停止</button><button id=\"lf-retry\" class=\"secondary\" disabled>容量スキップを再試行</button></div>
          <div class=\"row\"><button id=\"lf-export\" class=\"secondary\">診断ログを保存</button><button id=\"lf-refresh\" class=\"secondary\">状態を再表示</button></div>
""",
"""          <div class=\"row\"><button id=\"lf-pause\" class=\"secondary\" disabled>現在ファイル後に停止</button><button id=\"lf-retry\" class=\"secondary\" disabled>容量スキップを再試行</button></div>
          <div class=\"row\"><button id=\"lf-abandon\" class=\"secondary\" disabled>Queueを安全に破棄</button><button id=\"lf-export\" class=\"secondary\">診断ログを保存</button></div>
          <div class=\"row\"><button id=\"lf-refresh\" class=\"secondary\">状態を再表示</button></div>
""", 'add abandon button markup')

s = replace_exact(s,
"""    const pauseBtn = root.querySelector('#lf-pause');
    const retryBtn = root.querySelector('#lf-retry');
    const exportBtn = root.querySelector('#lf-export');
""",
"""    const pauseBtn = root.querySelector('#lf-pause');
    const retryBtn = root.querySelector('#lf-retry');
    const abandonBtn = root.querySelector('#lf-abandon');
    const exportBtn = root.querySelector('#lf-export');
""", 'bind abandon button')

s = replace_exact(s,
"""      retryBtn.disabled = running || !job || !(c.skippedCapacity || c.unfittable) || !isTerminal(job);
      analyzeBtn.disabled = running;
""",
"""      retryBtn.disabled = running || !job || !(c.skippedCapacity || c.unfittable) || !isTerminal(job);
      abandonBtn.disabled = running || !active;
      analyzeBtn.disabled = running;
""", 'abandon button state')

s = replace_exact(s,
"""    exportBtn.addEventListener('click', () => {
""",
"""    abandonBtn.addEventListener('click', async () => {
      if (running) return;
      const snapshot = loadQueueJob();
      if (!snapshot || isTerminal(snapshot)) { refreshQueueUi(); return; }
      const pageWindow = getNativePageWindow();
      const warning = [
        'この未完了Queueのローカル状態だけを破棄します。',
        '',
        'Linkex上のファイルは一切削除しません。',
        'COPY/DELETE結果が不明なQueueでは一時コピーがLinkex上に残っている可能性があります。',
        '必要なら先に「診断ログを保存」し、Linkex側を手動確認してください。',
        '',
        `job: ${snapshot.jobId}`,
        `state: ${snapshot.state}`,
        '',
        'Queueを破棄しますか？'
      ].join('\\n');
      if (!Reflect.apply(pageWindow.confirm, pageWindow, [warning])) return;
      running = true;
      try {
        await acquireLease();
        const job = loadQueueJob();
        if (!job || isTerminal(job)) { write('破棄対象の未完了Queueはありません。'); return; }
        if (job.jobId !== snapshot.jobId) throw new LinkexError('確認後にQueueが変更されました。状態を再表示してからやり直してください。', {kind:'queue_conflict'});
        recordEvent('warn', 'queue-abandon', `Queue stateを手動破棄: ${job.jobId}`, {jobId:job.jobId, state:job.state, lastError:job.lastError || null});
        const result = await abandonQueueJob(job);
        write(`Queue stateを破棄しました。\\nLinkex上のファイルは削除していません。未確定の一時コピーがないかLinkex側を確認してください。${result.handleCleanupError ? `\\n\\n保存先Handle整理警告: ${result.handleCleanupError}` : ''}`, 'ok');
      } catch (e) {
        write(`Queue破棄失敗: ${e?.message || e}`, 'err');
      } finally {
        running = false;
        releaseLease();
        refreshQueueUi();
      }
    });

    exportBtn.addEventListener('click', () => {
""", 'add abandon handler')

src_path.write_text(s, encoding='utf-8', newline='\n')

# Documentation sync for CI + new queue-abandon action.
replacements = {
    'README.md': [
        ('- 現行CI/CD: **なし**', '- 現行CI: **GitHub Actions (`.github/workflows/ci.yml`)** — userscript構文チェックと回帰テスト'),
        ('| **診断ログを保存** | Queue・イベント・署名テストをJSONで保存 |', '| **Queueを安全に破棄** | 未完了Queueのローカル状態だけを破棄。Linkex上は削除しない |\n| **診断ログを保存** | Queue・イベント・署名テストをJSONで保存 |'),
    ],
    'DEVELOPMENT.md': [
        ('- 現行 GitHub Actions / CI/CD: **なし**', '- 現行 GitHub Actions: **CIあり**（userscript構文チェック + Node標準回帰テスト）'),
    ],
    'docs/RELEASE.md': [
        ('- 現行 GitHub Actions / CI/CD: **なし**', '- 現行 GitHub Actions: **CIあり**（`.github/workflows/ci.yml`）'),
        ('## CI/CD\n\n現在、継続的なGitHub Actions / CI/CDはありません。', '## CI/CD\n\n`.github/workflows/ci.yml` で継続的CIを実行します。\n\n- `node --check linkex-downloader.user.js`\n- `node --test tests/*.test.js`\n\nRelease前にはCI PASSに加えて、実機の署名テスト・共有解析・Queue smoke/recovery testも引き続き実施してください。'),
    ],
}
for name, reps in replacements.items():
    p = Path(name)
    text = p.read_text(encoding='utf-8')
    for old, new in reps:
        text = replace_exact(text, old, new, f'{name}: {old[:30]}')
    p.write_text(text, encoding='utf-8', newline='\n')

changelog = Path('CHANGELOG.md')
text = changelog.read_text(encoding='utf-8')
anchor = '## [Unreleased]\n\n'
addition = '''## [Unreleased]\n\n### Fixed\n\n- Queue stateを書き換える前にtab leaseを取得し、別tabの古いsnapshotによるstate巻き戻しを防止\n- Range 416でローカル完成済みの場合も `LOCAL_COMMITTED` を永続化して復旧可能に修正\n- `Content-Length` 不明と0 byteを区別し、明示的size verificationで0 byte fileを安全に完了可能に修正\n- ownership確定時 `confirmedDest` をimmutable snapshotとして維持し、download前/403更新時のidentity変化を拒否\n- 長いfilenameのcollision suffixがtruncateで消える問題を修正\n\n### Added\n\n- 未完了QueueをLinkex側へDELETEせずローカルstateだけ破棄する「Queueを安全に破棄」\n- read-only GETのHTTP 429/5xx retry（COPY/DELETE等のwrite requestは従来どおり自動retry禁止）\n- DONE transactionのcompact化と完了QueueのIndexedDB DirectoryHandle cleanup\n- Node標準回帰テストとGitHub Actions CI\n\n'''
text = replace_exact(text, anchor, addition, 'CHANGELOG Unreleased sections')
changelog.write_text(text, encoding='utf-8', newline='\n')

trouble = Path('docs/TROUBLESHOOTING.md')
text = trouble.read_text(encoding='utf-8').rstrip() + '''\n\n## 未完了Queueを破棄したい\n\n`AMBIGUOUS_COPY` / `UNCERTAIN_NO_EVIDENCE` などで安全停止し、実状態を確認したうえでそのQueueを継続しないと判断した場合は **Queueを安全に破棄** を使用できます。\n\n- Queue/transactionのローカル保存状態だけを消します。\n- Linkex APIのDELETEは呼びません。\n- ローカルへ保存済みのファイルも削除しません。\n- COPY結果が不明なケースではLinkex上に一時コピーが残っている可能性があります。\n\n破棄前に必要なら **診断ログを保存** し、破棄後はLinkex側の直近ファイルを手動確認してください。\n'''
trouble.write_text(text, encoding='utf-8', newline='\n')

print('follow-up patches staged')
