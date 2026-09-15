from pathlib import Path

path = Path('linkex-downloader.user.js')
s = path.read_text(encoding='utf-8')


def replace_exact(old: str, new: str, label: str) -> None:
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    s = s.replace(old, new, 1)


replace_exact(
"""  async function probeCdnTotalSize(url) {
    // Content-Range is not CORS-exposed in the HAR, so a normal GET's exposed Content-Length is used.
    const ctl = new AbortController();
    try {
      const res = await fetch(url, {method:'GET', cache:'no-store', credentials:'omit', signal:ctl.signal});
      const len = Number(res.headers.get('Content-Length') || 0);
      try { await res.body?.cancel(); } catch {}
      if (!res.ok) throw new LinkexError(`CDN probe HTTP ${res.status}`, {kind:'cdn', status:res.status});
      if (!Number.isFinite(len) || len <= 0) throw new LinkexError('CDN Content-Lengthを取得できません。', {kind:'protocol'});
      return len;
    } finally { ctl.abort(); }
  }

  async function downloadOwnedFile({api, state, handle, onProgress = () => {}}) {
""",
"""  async function probeCdnTotalSize(url) {
    // Content-Range is not CORS-exposed in the HAR, so a normal GET's exposed Content-Length is used.
    const ctl = new AbortController();
    try {
      const res = await fetch(url, {method:'GET', cache:'no-store', credentials:'omit', signal:ctl.signal});
      const rawLength = res.headers.get('Content-Length');
      const len = rawLength === null ? null : Number(rawLength);
      try { await res.body?.cancel(); } catch {}
      if (!res.ok) throw new LinkexError(`CDN probe HTTP ${res.status}`, {kind:'cdn', status:res.status});
      if (len === null || !Number.isFinite(len) || len < 0) throw new LinkexError('CDN Content-Lengthを取得できません。', {kind:'protocol'});
      return len;
    } finally { ctl.abort(); }
  }

  function commitVerifiedDownload(state, {destId, downloadedBytes, expectedCdnBytes, localName}) {
    const downloaded = Number(downloadedBytes);
    const expected = Number(expectedCdnBytes);
    if (!Number.isFinite(downloaded) || !Number.isFinite(expected) || downloaded < 0 || expected < 0 || downloaded !== expected) {
      throw new LinkexError(`サイズ検証失敗: local=${downloadedBytes} / CDN=${expectedCdnBytes}`, {kind:'verify', actual:downloadedBytes, expectedTotal:expectedCdnBytes});
    }
    const current = loadProbeState() || state;
    return saveProbeState({...current, state:'LOCAL_COMMITTED', download:{...(current.download||{}), destId, downloadedBytes:downloaded, expectedCdnBytes:expected, sizeVerified:true, sourceMetaSize:Number(state.source?.size || 0), verifiedAt:Date.now(), localName}});
  }

  async function downloadOwnedFile({api, state, handle, onProgress = () => {}}) {
""",
'probe + commit helper')

replace_exact(
"""    let owned = await refreshOwnedFileUrl(api, destId);
    let url = owned.url;
    let retried403 = false;
""",
"""    let owned = await refreshOwnedFileUrl(api, destId);
    if (!sameOwnedIdentity(owned, state)) throw new LinkexError('確定済みdestIdのidentityが所有権確定時から変化しました。自動処理を停止します。', {kind:'ownership_lost', destId});
    let url = owned.url;
    let retried403 = false;
""",
'initial owned identity')

replace_exact(
"""        owned = await refreshOwnedFileUrl(api, destId);
        url = owned.url;
        retried403 = true;
""",
"""        owned = await refreshOwnedFileUrl(api, destId);
        if (!sameOwnedIdentity(owned, state)) throw new LinkexError('URL再取得時にdestIdのidentity変化を検出しました。自動処理を停止します。', {kind:'ownership_lost', destId});
        url = owned.url;
        retried403 = true;
""",
'403 identity')

replace_exact(
"""        if (localFile.size === total) {
          return {verified:true, resumed:true, totalBytes:total, localBytes:localFile.size, status:'ALREADY_COMPLETE'};
        }
""",
"""        if (localFile.size === total) {
          const done = commitVerifiedDownload(state, {destId, downloadedBytes:localFile.size, expectedCdnBytes:total, localName:localFile.name});
          return {verified:true, resumed:true, totalBytes:total, localBytes:localFile.size, status:'ALREADY_COMPLETE', state:done};
        }
""",
'416 completion commit')

replace_exact(
"""      if (!res.body) throw new LinkexError('CDN response bodyがストリームではありません。', {kind:'protocol'});

      const remaining = Number(res.headers.get('Content-Length') || 0);
      let resumed = offset > 0 && res.status === 206;
""",
"""      if (!res.body) throw new LinkexError('CDN response bodyがストリームではありません。', {kind:'protocol'});

      const rawRemaining = res.headers.get('Content-Length');
      const remaining = rawRemaining === null ? null : Number(rawRemaining);
      if (remaining === null || !Number.isFinite(remaining) || remaining < 0) {
        try { await res.body?.cancel(); } catch {}
        throw new LinkexError('CDN Content-Lengthを取得できないため、完全性を検証できません。', {kind:'protocol'});
      }
      let resumed = offset > 0 && res.status === 206;
""",
'content length parsing')

replace_exact(
"""      const expectedTotal = remaining > 0 ? base + remaining : null;
""",
"""      const expectedTotal = base + remaining;
""",
'expected total')

replace_exact(
"""      if (expectedTotal != null && actual !== expectedTotal) {
        const current = loadProbeState() || state;
        saveProbeState({...current, state:'VERIFY_FAILED', download:{...(current.download||{}), destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, updatedAt:Date.now()}});
        throw new LinkexError(`サイズ検証失敗: local=${actual} / CDN=${expectedTotal}`, {kind:'verify', actual, expectedTotal});
      }

      const current = loadProbeState() || state;
      const done = saveProbeState({...current, state:'LOCAL_COMMITTED', download:{...(current.download||{}), destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal ?? actual, sourceMetaSize:Number(state.source?.size || 0), verifiedAt:Date.now(), localName:finalFile.name}});
      return {verified:true, resumed, totalBytes:expectedTotal ?? actual, localBytes:actual, finalFile, state:done, metadataSize:Number(state.source?.size || 0)};
""",
"""      if (actual !== expectedTotal) {
        const current = loadProbeState() || state;
        saveProbeState({...current, state:'VERIFY_FAILED', download:{...(current.download||{}), destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, sizeVerified:false, updatedAt:Date.now()}});
        throw new LinkexError(`サイズ検証失敗: local=${actual} / CDN=${expectedTotal}`, {kind:'verify', actual, expectedTotal});
      }

      const done = commitVerifiedDownload(state, {destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, localName:finalFile.name});
      return {verified:true, resumed, totalBytes:expectedTotal, localBytes:actual, finalFile, state:done, metadataSize:Number(state.source?.size || 0)};
""",
'normal completion commit')

replace_exact(
"""    const downloaded = Number(state.download?.downloadedBytes || 0);
    const expected = Number(state.download?.expectedCdnBytes || 0);
    if (!(downloaded > 0 && expected > 0 && downloaded === expected)) {
      throw new LinkexError(`削除拒否: ローカル検証サイズが確定していません (${downloaded}/${expected})。`, {kind:'delete_guard'});
    }
""",
"""    const downloaded = Number(state.download?.downloadedBytes);
    const expected = Number(state.download?.expectedCdnBytes);
    const explicitSizeVerified = state.download?.sizeVerified === true;
    // v1.0.0で既にLOCAL_COMMITTEDになった正サイズ(>0) Queueは互換維持する。
    // 0 byteは新実装の明示的sizeVerifiedがある場合だけ許可する。
    const legacySizeVerified = state.download?.sizeVerified == null && downloaded > 0 && expected > 0 && downloaded === expected;
    if (!(explicitSizeVerified || legacySizeVerified) || !Number.isFinite(downloaded) || !Number.isFinite(expected) || downloaded < 0 || expected < 0 || downloaded !== expected) {
      throw new LinkexError(`削除拒否: ローカル検証サイズが確定していません (${downloaded}/${expected})。`, {kind:'delete_guard'});
    }
""",
'delete guard zero byte')

replace_exact(
"""  function addLeafSuffix(name, suffix) {
    const s = String(name || 'file.bin');
    const dot = s.lastIndexOf('.');
    if (dot > 0 && s.length - dot <= 20) return `${s.slice(0,dot)}${suffix}${s.slice(dot)}`;
    return `${s}${suffix}`;
  }
""",
"""  function addLeafSuffix(name, suffix, maxLength = 140) {
    const s = String(name || 'file.bin');
    const dot = s.lastIndexOf('.');
    const hasShortExt = dot > 0 && s.length - dot <= 20;
    const ext = hasShortExt ? s.slice(dot) : '';
    const stem = hasShortExt ? s.slice(0, dot) : s;
    const room = Math.max(1, maxLength - String(suffix).length - ext.length);
    return `${stem.slice(0, room)}${suffix}${ext}`;
  }
""",
'bounded collision suffix')

replace_exact(
"""    const owned = await refreshOwnedFileUrl(api, tx.confirmedDest.id);
    const local = await handle.getFile();
    tx = {...tx, state:'DOWNLOAD_READY', confirmedDest:{...tx.confirmedDest, ...owned}, download:{...(tx.download||{}), destId:tx.confirmedDest.id, localName:local.name, downloadedBytes:local.size, startedAt:tx.download?.startedAt || Date.now(), updatedAt:Date.now()}};
""",
"""    const owned = await refreshOwnedFileUrl(api, tx.confirmedDest.id);
    if (!sameOwnedIdentity(owned, tx)) throw new LinkexError('ダウンロード開始前にdestIdのidentity変化を検出しました。自動処理を停止します。', {kind:'ownership_lost', destId:tx.confirmedDest.id});
    const local = await handle.getFile();
    // confirmedDestはownership確定時のimmutable snapshotとして維持し、signed URL等の現在metadataは永続化しない。
    tx = {...tx, state:'DOWNLOAD_READY', download:{...(tx.download||{}), destId:tx.confirmedDest.id, localName:local.name, downloadedBytes:local.size, startedAt:tx.download?.startedAt || Date.now(), updatedAt:Date.now()}};
""",
'immutable confirmedDest')

replace_exact(
"""    async function runJob(job, queueRoot, resume=false) {
      await acquireLease();
      recordEvent('info', resume ? 'queue-resume' : 'queue-start', `${resume ? 'Queue再開' : 'Queue開始'}: ${job.jobId}`, {jobId:job.jobId, items:job.items?.length, folderName:job.folderName});
      try {
        const result = await processQueue(job, queueRoot, t => write(`${t}\n\n${queueSummary(loadQueueJob())}`));
""",
"""    async function runJob(job, queueRoot, resume=false) {
      // 呼び出し側がleaseを取得済みであること。Queue stateのmutationより先に排他を確立する。
      assertLease();
      recordEvent('info', resume ? 'queue-resume' : 'queue-start', `${resume ? 'Queue再開' : 'Queue開始'}: ${job.jobId}`, {jobId:job.jobId, items:job.items?.length, folderName:job.folderName});
      try {
        const result = await processQueue(job, queueRoot, t => write(`${t}\n\n${queueSummary(loadQueueJob())}`));
""",
'runJob lease ownership')

replace_exact(
"""      } catch (e) {
        recordEvent('error', 'queue-stop', `Queue停止: ${e?.message || e}`, {jobId:job?.jobId, kind:e?.kind || null});
        throw e;
      } finally {
        releaseLease();
      }
    }
""",
"""      } catch (e) {
        recordEvent('error', 'queue-stop', `Queue停止: ${e?.message || e}`, {jobId:job?.jobId, kind:e?.kind || null});
        throw e;
      }
    }
""",
'runJob release ownership')

replace_exact(
"""      running = true;
      try {
        await ensureHandlePermission(baseDir);
        const job = createQueueFromManifest(manifest);
        const queueRoot = await baseDir.getDirectoryHandle(job.folderName, {create:true});
        await putQueueRootHandle(job, queueRoot);
        saveQueueJob(job);
""",
"""      running = true;
      try {
        await acquireLease();
        const activeJob = loadQueueJob();
        if (activeJob && !isTerminal(activeJob)) throw new LinkexError('別の未完了Queueを検出しました。状態を再表示してから再開または整理してください。', {kind:'queue_conflict'});
        await ensureHandlePermission(baseDir);
        const job = createQueueFromManifest(manifest);
        const queueRoot = await baseDir.getDirectoryHandle(job.folderName, {create:true});
        await putQueueRootHandle(job, queueRoot);
        saveQueueJob(job);
""",
'start acquire before mutation')

replace_exact(
"""    resumeBtn.addEventListener('click', async () => {
      if (running) return;
      const job = loadQueueJob();
      if (!job || isTerminal(job)) { refreshQueueUi(); return; }
      running = true;
      try {
        const queueRoot = await getQueueRootHandle(job);
""",
"""    resumeBtn.addEventListener('click', async () => {
      if (running) return;
      const snapshot = loadQueueJob();
      if (!snapshot || isTerminal(snapshot)) { refreshQueueUi(); return; }
      running = true;
      try {
        await acquireLease();
        // lease取得後に最新stateを読み直し、別tabの古いsnapshotを書き戻さない。
        const job = loadQueueJob();
        if (!job || isTerminal(job)) { refreshQueueUi(); return; }
        const queueRoot = await getQueueRootHandle(job);
""",
'resume reload under lease')

path.write_text(s, encoding='utf-8', newline='\n')
print('patched', path)
