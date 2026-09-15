// ==UserScript==
// @name         Linkex Downloader
// @namespace    openai-linkex-helper
// @version      1.0.0
// @description  Linkex共有を1ファイルずつ安全に一時コピー→ローカル保存→検証→確定IDだけ削除。再開・容量スキップ・競合防止・診断ログ付き。
// @match        https://disk.linkex.io/*
// @connect      prod.linksvc.xyz
// CDNはpage-origin fetchで取得するため @connect 不要
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '1.0.0';
  const API_BASE = 'https://prod.linksvc.xyz';
  const SIGNED_HEADER_PREFIX = 'x-linkinflu-';
  const SIGNATURE_HEADER = 'x-linkinflu-sign';
  const TS_HEADER = 'x-linkinflu-ts';
  const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

  // Linkex公式Web (HAR取得時点) と同じ難読化解除式。
  // 直接の平文キーをコードへ固定せず、公式JSと同じ復元方法にしている。
  const KEY_BYTES = [55,99,44,4,22,55,58,61,4,55,3,52,61,84,123,24,2,41,51,118,89,11,1,31,98,26];
  const deriveSigningKey = () => String.fromCharCode(...KEY_BYTES.map((v, i) => v ^ ((90 + (i % 7)) & 255)));

  class LinkexError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'LinkexError';
      Object.assign(this, details);
    }
  }

  // --- MD5 (UTF-8 input -> lowercase hex) ---
  // Web Crypto は MD5 非対応なので、署名互換のため小さな純JS実装を内蔵する。
  function md5(input) {
    const bytes = new TextEncoder().encode(String(input));
    const len = bytes.length;
    const bitLen = BigInt(len) * 8n;
    const paddedLen = (((len + 8) >>> 6) + 1) * 64;
    const buf = new Uint8Array(paddedLen);
    buf.set(bytes);
    buf[len] = 0x80;
    for (let i = 0; i < 8; i++) buf[paddedLen - 8 + i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const s = [
      7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
      5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
      4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
      6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21
    ];
    const K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
    const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

    for (let offset = 0; offset < paddedLen; offset += 64) {
      const M = new Uint32Array(16);
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        M[i] = (buf[p] | (buf[p+1] << 8) | (buf[p+2] << 16) | (buf[p+3] << 24)) >>> 0;
      }

      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const tmp = D;
        D = C;
        C = B;
        const sum = (A + F + K[i] + M[g]) >>> 0;
        B = (B + rotl(sum, s[i])) >>> 0;
        A = tmp;
      }
      a0 = (a0 + A) >>> 0;
      b0 = (b0 + B) >>> 0;
      c0 = (c0 + C) >>> 0;
      d0 = (d0 + D) >>> 0;
    }

    const hexLE = n => [0,8,16,24].map(shift => ((n >>> shift) & 0xff).toString(16).padStart(2, '0')).join('');
    return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
  }

  function normalizeHeaders(headers = {}) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== null && v !== undefined) out[k.toLowerCase()] = String(v);
    }
    return out;
  }

  function signRequest({ method = 'GET', path, headers = {}, body = '', ts }) {
    const normalized = normalizeHeaders(headers);
    const timestamp = String(ts ?? Math.floor(Date.now() / 1000));
    normalized[TS_HEADER] = timestamp;
    delete normalized[SIGNATURE_HEADER];

    // 公式JSは「key=value」にしてから文字列ソートする。keyだけのソートではない。
    const signedHeaderText = Object.entries(normalized)
      .filter(([k]) => k.startsWith(SIGNED_HEADER_PREFIX) && k !== SIGNATURE_HEADER)
      .map(([k, v]) => `${k}=${v}`)
      .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      .join('&');

    const headerHash = md5(signedHeaderText);
    const upperMethod = method.toUpperCase();
    const bodyHash = WRITE_METHODS.has(upperMethod) ? md5(body ?? '') : '';
    const signature = md5(`path=${path}&header=${headerHash}&body=${bodyHash}&key=${deriveSigningKey()}`);
    return { timestamp, signature, headerHash, bodyHash };
  }

  function runSignatureSelfTest() {
    const vectors = [
      {
        name: 'usage/en', method: 'GET', path: '/api/drive/v1/usage', ts: 1789385160,
        headers: {'X-LinkInflu-App':'linkex','X-LinkInflu-App-Lang':'en'},
        expected: '269fe89369b7d1987614a4934c23dd7c'
      },
      {
        name: 'share-get/ja', method: 'GET', path: '/api/drive/v1/share/get?share_token=HrhiNwwN', ts: 1789385150,
        headers: {'X-LinkInflu-App':'linkex','X-LinkInflu-App-Lang':'ja'},
        expected: 'b11c02debca8a279d5ea3569d23d34b3'
      }
    ];
    return vectors.map(v => {
      const actual = signRequest(v).signature;
      return {...v, actual, ok: actual === v.expected};
    });
  }

  function getAppLanguage() {
    const lang = String(navigator.language || 'en').toLowerCase();
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('ko')) return 'ko';
    if (lang.startsWith('ar')) return 'ar';
    if (lang.startsWith('id')) return 'id';
    if (lang.startsWith('fr')) return 'fr';
    if (lang.startsWith('de')) return 'de';
    if (lang.startsWith('it')) return 'it';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('pl')) return 'pl';
    if (lang.startsWith('th')) return 'th';
    if (lang.startsWith('tr')) return 'tr';
    if (lang.startsWith('pt-br')) return 'pt-BR';
    return 'en';
  }

  function buildQuery(params = {}) {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach(v => usp.append(`${key}[]`, String(v)));
      else usp.append(key, String(value));
    }
    return usp.toString();
  }

  function isJwtLike(value) {
    return typeof value === 'string' && value.split('.').length === 3 && value.length > 40;
  }

  function findCredentialCandidates(value, path = '', depth = 0, out = []) {
    if (depth > 8 || value == null || typeof value !== 'object') return out;
    if (!Array.isArray(value)) {
      const token = value.token ?? value.accessToken ?? value.diskToken;
      const refreshToken = value.refreshToken ?? value.diskRefreshToken;
      if (isJwtLike(token)) {
        let score = 10;
        if (refreshToken) score += 5;
        if (/credential/i.test(path)) score += 10;
        if (/user_cache/i.test(path)) score += 4;
        out.push({token, refreshToken, path, score});
      }
    }
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object') findCredentialCandidates(v, `${path}.${k}`, depth + 1, out);
    }
    return out;
  }

  function discoverCredentials() {
    const candidates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        findCredentialCandidates(parsed, `localStorage:${key}`, 0, candidates);
      } catch { /* not JSON */ }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  }

  function getNativePageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch { /* fall through */ }
    return window;
  }

  async function invokeSaveFilePicker(options) {
    const pageWindow = getNativePageWindow();
    const picker = pageWindow?.showSaveFilePicker;
    if (typeof picker !== 'function') {
      throw new LinkexError('このブラウザではFile System Access APIが利用できません。Edge/Chromeの通常ウィンドウで実行してください。');
    }
    // Tampermonkey sandbox 経由の Window メソッドは `this` が userscript 側 Window になると
    // Chromium が Illegal invocation を返す。必ずページ本体 Window を receiver に固定する。
    return await Reflect.apply(picker, pageWindow, [options]);
  }

  function gmRequest({ method = 'GET', url, headers = {}, data, timeout = 90000 }) {
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
    constructor({token = null, lang = getAppLanguage()} = {}) {
      this.token = token;
      this.lang = lang;
    }

    async request(method, pathname, {params = {}, body = undefined, auth = true} = {}) {
      const query = buildQuery(params);
      const path = pathname + (query ? `?${query}` : '');
      const bodyText = body === undefined ? '' : JSON.stringify(body);
      const baseHeaders = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'X-LinkInflu-App': 'linkex',
        'X-LinkInflu-App-Lang': this.lang
      };
      const signed = signRequest({method, path, headers: baseHeaders, body: bodyText});
      const headers = {
        ...baseHeaders,
        'X-LinkInflu-Ts': signed.timestamp,
        'X-LinkInflu-Sign': signed.signature
      };
      if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;

      const res = await gmRequest({method, url: API_BASE + path, headers, data: body === undefined ? undefined : bodyText});
      let payload = res.response;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { /* leave string */ }
      }
      if (res.status < 200 || res.status >= 300) {
        throw new LinkexError(`HTTP ${res.status}`, {kind:'http', status:res.status, path, payload});
      }
      if (!payload || typeof payload !== 'object') {
        throw new LinkexError('Invalid JSON response', {kind:'protocol', path, payload});
      }
      if (payload.code !== 0) {
        throw new LinkexError(payload.message || `API error ${payload.code}`, {kind:'api', code:payload.code, path, payload});
      }
      return payload.data;
    }

    getShare(shareToken) {
      return this.request('GET', '/api/drive/v1/share/get', {params:{share_token: shareToken}, auth:false});
    }

    getShareContent(shareToken, {parentId, page = 1, pageSize = 100} = {}) {
      return this.request('GET', '/api/drive/v1/share/get/content', {
        params:{share_token:shareToken, ...(parentId ? {parent_id:parentId} : {}), page, page_size:pageSize, need_parents:true},
        auth:false
      });
    }

    getUsage() {
      if (!this.token) throw new LinkexError('Linkexログイン情報を検出できませんでした。disk.linkex.ioでログイン後に再実行してください。', {kind:'auth'});
      return this.request('GET', '/api/drive/v1/usage', {auth:true});
    }

    listFiles({page = 1, pageSize = 100, parentId = null} = {}) {
      if (!this.token) throw new LinkexError('Linkexログイン情報を検出できません。', {kind:'auth'});
      return this.request('GET', '/api/drive/v1/file/list', {
        params:{
          keyword:'', page, page_size:pageSize, order:'name', desc:false, need_parents:true,
          ...(parentId ? {parent_id:parentId} : {})
        },
        auth:true
      });
    }

    copySharedFile({shareToken, sourceId}) {
      if (!this.token) throw new LinkexError('Linkexログイン情報を検出できません。', {kind:'auth'});
      return this.request('POST', '/api/drive/v1/file/copy', {
        body:{
          share_token:shareToken,
          collection:{select_all:false, file_ids:[sourceId]},
          async:true
        },
        auth:true
      });
    }

    getTask(taskId) {
      if (!this.token) throw new LinkexError('Linkexログイン情報を検出できません。', {kind:'auth'});
      return this.request('GET', '/api/drive/v1/task/get', {params:{task_id:taskId}, auth:true});
    }

    deleteSingleFile(fileId) {
      if (!this.token) throw new LinkexError('Linkexログイン情報を検出できません。', {kind:'auth'});
      const id = String(fileId || '');
      if (!id) throw new LinkexError('削除対象IDがありません。', {kind:'delete_guard'});
      // 安全不変条件: delete APIへ送れるのは、select_all:false + file_ids:[1件] のみ。
      return this.request('POST', '/api/drive/v1/file/delete', {
        body:{collection:{select_all:false, file_ids:[id]}},
        auth:true
      });
    }
  }

  function parseShareToken(input) {
    const raw = String(input || '').trim();
    if (!raw) throw new LinkexError('共有URLを入力してください。');
    if (/^[A-Za-z0-9_-]{5,}$/.test(raw) && !raw.includes('/')) return raw;
    let url;
    try { url = new URL(raw); } catch { throw new LinkexError('共有URLの形式が正しくありません。'); }
    const match = url.pathname.match(/\/d\/([A-Za-z0-9_-]+)/);
    if (!match) throw new LinkexError('l2e.click/d/... 形式の共有URLではありません。');
    return match[1];
  }

  async function buildManifest(api, shareToken, onProgress = () => {}) {
    const shareInfo = await api.getShare(shareToken);
    const files = [];
    const folders = [];
    const visited = new Set();

    async function listAll(parentId) {
      let page = 1;
      const all = [];
      while (true) {
        const data = await api.getShareContent(shareToken, {parentId, page, pageSize:100});
        all.push(...(data.list || []));
        const p = data.pagination || {};
        if (!p.has_next && !(p.hasNext)) break;
        page += 1;
        if (page > 10000) throw new LinkexError('Pagination safety limit exceeded', {kind:'protocol'});
      }
      return all;
    }

    async function walk(parentId, remotePath) {
      const items = await listAll(parentId);
      for (const item of items) {
        const path = remotePath ? `${remotePath}/${item.name}` : item.name;
        if (item.type === 'folder') {
          if (visited.has(item.id)) throw new LinkexError(`フォルダ循環を検出: ${path}`, {kind:'protocol'});
          visited.add(item.id);
          folders.push({id:item.id, name:item.name, remotePath:path});
          onProgress({type:'folder', path, files:files.length});
          await walk(item.id, path);
        } else {
          files.push({
            sourceId:item.id,
            name:item.name,
            type:item.type,
            size:Number(item.size || 0),
            remotePath:path,
            parentId:parentId || null
          });
          onProgress({type:'file', path, files:files.length});
        }
      }
    }

    await walk(undefined, '');
    const totalBytes = files.reduce((sum, f) => sum + (Number.isFinite(f.size) ? f.size : 0), 0);
    return {
      schemaVersion:1,
      generatedAt:new Date().toISOString(),
      shareToken,
      shareName:shareInfo?.share?.file?.name ?? null,
      shareInfo,
      folders,
      files,
      totalBytes
    };
  }

  const formatBytes = bytes => {
    const n = Number(bytes || 0);
    const units = ['B','KB','MB','GB','TB'];
    if (n <= 0) return '0 B';
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
  };

  function redactToken(s) {
    if (!s) return null;
    return `${s.slice(0, 8)}…${s.slice(-6)}`;
  }

  const PROBE_KEY = 'linkexCopyProbeStateV1';
  const LAST_URL_KEY = 'lastShareUrl';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function listAllRoot(api) {
    const all = [];
    let page = 1;
    const pageSize = 100;
    while (true) {
      const data = await api.listFiles({page, pageSize});
      all.push(...(data?.list || []));
      const p = data?.pagination || {};
      if (!p.has_next && !p.hasNext) break;
      page += 1;
      if (page > 10000) throw new LinkexError('Root listing pagination safety limit exceeded', {kind:'protocol'});
    }
    return all;
  }

  function normalizeCopyName(name) {
    const text = String(name || '');
    const dot = text.lastIndexOf('.');
    const stem = dot > 0 ? text.slice(0, dot) : text;
    const ext = dot > 0 ? text.slice(dot).toLowerCase() : '';
    return {stem:stem.replace(/\(\d+\)$/u, ''), ext};
  }

  function isPlausibleCopy(candidate, source, startedAtMs) {
    if (!candidate || !source) return false;
    if (Number(candidate.size || 0) !== Number(source.size || 0)) return false;
    const a = normalizeCopyName(candidate.name);
    const b = normalizeCopyName(source.name);
    if (a.ext !== b.ext || a.stem !== b.stem) return false;
    const createdMs = Number(candidate.created_at || candidate.createdAt || 0) * 1000;
    if (createdMs && createdMs < startedAtMs - 120000) return false;
    return true;
  }

  function saveProbeState(state) {
    GM_setValue(PROBE_KEY, state);
    return state;
  }

  function loadProbeState() {
    const value = GM_getValue(PROBE_KEY, null);
    return value && typeof value === 'object' ? value : null;
  }

  async function waitTaskIfPresent(api, copyResult, onStatus) {
    const taskId = copyResult?.task_id ?? copyResult?.taskId ?? null;
    if (!taskId) return {taskId:null, status:'NO_TASK_ID'};
    let a = 1, b = 1;
    let lastStatus = '';
    const terminalFail = new Set(['failed','size_exceeded','insufficient_storage']);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await sleep(Math.min(a, 13) * 1000);
      const data = await api.getTask(taskId);
      const task = data?.task ?? (data?.status ? data : null);
      if (!task) throw new LinkexError('Copy task not found', {kind:'protocol', taskId});
      const status = String(task.status || '').toLowerCase();
      onStatus?.(status || 'unknown');
      if (status === 'success') return {taskId, status};
      if (terminalFail.has(status)) throw new LinkexError(`Copy task failed: ${status}`, {kind:'copy_task', status, task});
      if (status !== lastStatus) { a = 1; b = 1; }
      else { const next = a + b; a = b; b = next; }
      lastStatus = status;
    }
    throw new LinkexError('Copy task timeout', {kind:'timeout', taskId});
  }

  async function reconcileCopy(api, state, {timeoutMs = 90000, onProgress = () => {}} = {}) {
    if (!state?.beforeIds || !state?.source) throw new LinkexError('照合に必要なCOPY_INTENT情報がありません。');
    const before = new Set(state.beforeIds.map(String));
    const deadline = Date.now() + timeoutMs;
    const delays = [1000, 1000, 2000, 3000, 5000, 8000, 13000];
    let attempt = 0;
    let lastDiff = [];

    while (Date.now() < deadline) {
      const root = await listAllRoot(api);
      const diff = root.filter(item => !before.has(String(item.id)));
      lastDiff = diff;
      const plausible = diff.filter(item => isPlausibleCopy(item, state.source, state.startedAt));
      onProgress({attempt:attempt + 1, diff, plausible});

      // 安全側: コピー開始後に増えたIDが1件だけで、それが元ファイルと整合するときだけ所有権を確定。
      if (diff.length === 1 && plausible.length === 1) {
        return {status:'CONFIRMED', item:plausible[0], diff};
      }
      // 2件以上増えた時点で、どれが自分のコピーかID差分だけでは証明できない。
      if (diff.length > 1) {
        return {status:'AMBIGUOUS', diff, plausible};
      }

      const delay = delays[Math.min(attempt, delays.length - 1)];
      attempt += 1;
      await sleep(delay);
    }
    return {status:'NO_EVIDENCE', diff:lastDiff, plausible:lastDiff.filter(item => isPlausibleCopy(item, state.source, state.startedAt))};
  }


  // --- F-H: confirmed destId only download path (NO DELETE) ---
  const DOWNLOAD_DB = 'linkexDownloaderProbeV1';
  const DOWNLOAD_STORE = 'handles';
  const CHECKPOINT_BYTES = 2 * 1024 * 1024;

  function openDownloadDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DOWNLOAD_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DOWNLOAD_STORE)) db.createObjectStore(DOWNLOAD_STORE, {keyPath:'operationId'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function idbPutHandle(operationId, handle) {
    const db = await openDownloadDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DOWNLOAD_STORE, 'readwrite');
        tx.objectStore(DOWNLOAD_STORE).put({operationId, handle, updatedAt:Date.now()});
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
      });
    } finally { db.close(); }
  }

  async function idbGetHandle(operationId) {
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
    if (!handle) throw new LinkexError('保存先ファイルハンドルがありません。', {kind:'filesystem'});
    if (handle.queryPermission) {
      const q = await handle.queryPermission({mode:'readwrite'});
      if (q === 'granted') return true;
    }
    if (handle.requestPermission) {
      const p = await handle.requestPermission({mode:'readwrite'});
      if (p === 'granted') return true;
    }
    throw new LinkexError('保存先ファイルへの書き込み権限がありません。', {kind:'filesystem'});
  }

  async function findOwnedRootFile(api, destId) {
    const root = await listAllRoot(api);
    return root.find(x => String(x.id) === String(destId)) || null;
  }

  async function refreshOwnedFileUrl(api, destId) {
    const item = await findOwnedRootFile(api, destId);
    if (!item) throw new LinkexError('確定済みdestIdがLinkexルートに見つかりません。自動処理を停止します。', {kind:'ownership_lost', destId});
    if (!item.url) throw new LinkexError('確定済みファイルにダウンロードURLがありません。', {kind:'protocol', destId, item});
    return item;
  }

  async function fetchCdn(url, {offset = 0, signal} = {}) {
    const headers = offset > 0 ? {'Range': `bytes=${offset}-`} : {};
    return fetch(url, {method:'GET', headers, cache:'no-store', credentials:'omit', signal});
  }

  async function probeCdnTotalSize(url) {
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
    const destId = state?.confirmedDest?.id;
    if (!destId || state.state === 'AMBIGUOUS_COPY') throw new LinkexError('所有権確定済みdestIdがありません。', {kind:'ownership'});
    await ensureHandlePermission(handle);

    let localFile = await handle.getFile();
    let offset = localFile.size;
    let owned = await refreshOwnedFileUrl(api, destId);
    if (!sameOwnedIdentity(owned, state)) throw new LinkexError('確定済みdestIdのidentityが所有権確定時から変化しました。自動処理を停止します。', {kind:'ownership_lost', destId});
    let url = owned.url;
    let retried403 = false;

    while (true) {
      let res = await fetchCdn(url, {offset});

      if (res.status === 403 && !retried403) {
        try { await res.body?.cancel(); } catch {}
        owned = await refreshOwnedFileUrl(api, destId);
        if (!sameOwnedIdentity(owned, state)) throw new LinkexError('URL再取得時にdestIdのidentity変化を検出しました。自動処理を停止します。', {kind:'ownership_lost', destId});
        url = owned.url;
        retried403 = true;
        continue;
      }

      if (res.status === 416) {
        try { await res.body?.cancel(); } catch {}
        const total = await probeCdnTotalSize(url);
        localFile = await handle.getFile();
        if (localFile.size === total) {
          const done = commitVerifiedDownload(state, {destId, downloadedBytes:localFile.size, expectedCdnBytes:total, localName:localFile.name});
          return {verified:true, resumed:true, totalBytes:total, localBytes:localFile.size, status:'ALREADY_COMPLETE', state:done};
        }
        if (localFile.size > total) {
          const w = await handle.createWritable({keepExistingData:false});
          await w.truncate(0); await w.close();
          offset = 0;
          retried403 = false;
          continue;
        }
        throw new LinkexError(`Range 416ですがローカルサイズが完成サイズと一致しません (${localFile.size}/${total})`, {kind:'range_416', localSize:localFile.size, total});
      }

      if (!(res.status === 200 || res.status === 206)) {
        try { await res.body?.cancel(); } catch {}
        throw new LinkexError(`CDN HTTP ${res.status}`, {kind:'cdn', status:res.status});
      }
      if (!res.body) throw new LinkexError('CDN response bodyがストリームではありません。', {kind:'protocol'});

      const rawRemaining = res.headers.get('Content-Length');
      const remaining = rawRemaining === null ? null : Number(rawRemaining);
      if (remaining === null || !Number.isFinite(remaining) || remaining < 0) {
        try { await res.body?.cancel(); } catch {}
        throw new LinkexError('CDN Content-Lengthを取得できないため、完全性を検証できません。', {kind:'protocol'});
      }
      let resumed = offset > 0 && res.status === 206;
      let base = resumed ? offset : 0;

      // Rangeを要求したのに200ならサーバーが無視したとみなし、同じ200 bodyを0から保存。
      if (offset > 0 && res.status === 200) {
        base = 0;
        resumed = false;
        offset = 0;
      }

      const expectedTotal = base + remaining;
      const writable = await handle.createWritable({keepExistingData: resumed});
      if (resumed) await writable.seek(base);
      else await writable.truncate(0);

      const reader = res.body.getReader();
      let written = base;
      let nextCheckpoint = written + CHECKPOINT_BYTES;
      let lastUi = 0;
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          await writable.write(value);
          written += value.byteLength;
          const now = Date.now();
          if (written >= nextCheckpoint) {
            const current = loadProbeState() || state;
            saveProbeState({...current, state:'DOWNLOADING', download:{...(current.download||{}), destId, downloadedBytes:written, expectedCdnBytes:expectedTotal, updatedAt:now}});
            nextCheckpoint = written + CHECKPOINT_BYTES;
          }
          if (now - lastUi > 250) {
            onProgress({written, expectedTotal, resumed, sourceMetaSize:Number(state.source?.size || 0)});
            lastUi = now;
          }
        }
        await writable.close();
      } catch (e) {
        try { await reader.cancel(); } catch {}
        try { await writable.close(); } catch {}
        const partial = await handle.getFile();
        const current = loadProbeState() || state;
        saveProbeState({...current, state:'DOWNLOAD_PAUSED', download:{...(current.download||{}), destId, downloadedBytes:partial.size, expectedCdnBytes:expectedTotal, lastError:String(e?.message || e), updatedAt:Date.now()}});
        throw e;
      }

      const finalFile = await handle.getFile();
      const actual = finalFile.size;
      if (actual !== expectedTotal) {
        const current = loadProbeState() || state;
        saveProbeState({...current, state:'VERIFY_FAILED', download:{...(current.download||{}), destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, sizeVerified:false, updatedAt:Date.now()}});
        throw new LinkexError(`サイズ検証失敗: local=${actual} / CDN=${expectedTotal}`, {kind:'verify', actual, expectedTotal});
      }

      const done = commitVerifiedDownload(state, {destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, localName:finalFile.name});
      return {verified:true, resumed, totalBytes:expectedTotal, localBytes:actual, finalFile, state:done, metadataSize:Number(state.source?.size || 0)};
    }
  }

  // --- I: destructive action guard + delete reconciliation ---
  function assertDeleteGuards(state) {
    if (!state || state.state !== 'LOCAL_COMMITTED') {
      throw new LinkexError('削除条件を満たしていません: state が LOCAL_COMMITTED ではありません。', {kind:'delete_guard'});
    }
    const destId = String(state.confirmedDest?.id || '');
    if (!destId) throw new LinkexError('削除条件を満たしていません: confirmedDest.id がありません。', {kind:'delete_guard'});
    if (state.state === 'AMBIGUOUS_COPY') throw new LinkexError('AMBIGUOUS_COPY は削除できません。', {kind:'delete_guard'});
    if (!Array.isArray(state.beforeIds)) throw new LinkexError('削除条件を満たしていません: コピー前ID集合がありません。', {kind:'delete_guard'});
    if (state.beforeIds.map(String).includes(destId)) {
      throw new LinkexError('削除拒否: destId がコピー前から存在していました。所有権を証明できません。', {kind:'delete_guard'});
    }
    if (String(state.download?.destId || '') !== destId) {
      throw new LinkexError('削除拒否: ダウンロード検証IDとコピー所有IDが一致しません。', {kind:'delete_guard'});
    }
    const downloaded = Number(state.download?.downloadedBytes);
    const expected = Number(state.download?.expectedCdnBytes);
    const explicitSizeVerified = state.download?.sizeVerified === true;
    // v1.0.0で既にLOCAL_COMMITTEDになった正サイズ(>0) Queueは互換維持する。
    // 0 byteは新実装の明示的sizeVerifiedがある場合だけ許可する。
    const legacySizeVerified = state.download?.sizeVerified == null && downloaded > 0 && expected > 0 && downloaded === expected;
    if (!(explicitSizeVerified || legacySizeVerified) || !Number.isFinite(downloaded) || !Number.isFinite(expected) || downloaded < 0 || expected < 0 || downloaded !== expected) {
      throw new LinkexError(`削除拒否: ローカル検証サイズが確定していません (${downloaded}/${expected})。`, {kind:'delete_guard'});
    }
    if (!Number(state.download?.verifiedAt || 0)) {
      throw new LinkexError('削除拒否: verifiedAt がありません。', {kind:'delete_guard'});
    }
    return {destId, downloaded, expected};
  }

  function sameOwnedIdentity(current, state) {
    if (!current || !state?.confirmedDest) return false;
    if (String(current.id) !== String(state.confirmedDest.id)) return false;
    if (String(current.name || '') !== String(state.confirmedDest.name || '')) return false;
    // Linkex metadata size は CDN実サイズと一致しないことがあるため、ここではコピー確定時の
    // Linkex metadata size 同士だけを比較する。
    if (Number(current.size || 0) !== Number(state.confirmedDest.size || 0)) return false;
    return true;
  }

  async function reconcileDelete(api, state, {timeoutMs = 30000, onProgress = () => {}} = {}) {
    const destId = String(state?.confirmedDest?.id || state?.delete?.destId || '');
    if (!destId) throw new LinkexError('削除照合対象IDがありません。', {kind:'delete_guard'});
    const deadline = Date.now() + timeoutMs;
    const delays = [500, 1000, 1500, 2500, 4000, 6000, 8000];
    let attempt = 0;
    let last = null;
    while (Date.now() < deadline) {
      last = await findOwnedRootFile(api, destId);
      onProgress({attempt:attempt + 1, exists:!!last, item:last});
      if (!last) return {status:'ABSENT'};
      const delay = delays[Math.min(attempt, delays.length - 1)];
      attempt += 1;
      await sleep(delay);
    }
    return {status:'PRESENT', item:last};
  }


  // --- Production full queue: all files, safe sequential transactions ---
  const QUEUE_KEY = 'linkexQueueFullV1';
  const QUEUE_HANDLE_PREFIX = 'queue-full:';
  const LEASE_KEY = 'linkexQueueFullLeaseV1';
  const TAB_ID = `tab-${(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)}`;
  let leaseTimer = null;
  let leaseLost = false;

  function loadQueueJob() {
    const value = GM_getValue(QUEUE_KEY, null);
    return value && typeof value === 'object' ? value : null;
  }

  function saveQueueJob(job) {
    job.updatedAt = Date.now();
    GM_setValue(QUEUE_KEY, job);
    return job;
  }

  function makeId(prefix = 'job') {
    const rand = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    return `${prefix}-${rand}`;
  }

  function sanitizeSegment(input) {
    let s = String(input ?? '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    s = s.replace(/[ .]+$/g, '').trim();
    if (!s) s = '_';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = `_${s}`;
    if (s.length > 140) {
      const dot = s.lastIndexOf('.');
      if (dot > 0 && s.length - dot <= 20) {
        const ext = s.slice(dot);
        s = s.slice(0, Math.max(1, 140 - ext.length)) + ext;
      } else s = s.slice(0, 140);
    }
    return s;
  }

  function sourceLocalSegments(source, shareName) {
    const raw = String(source?.remotePath || source?.name || 'file.bin').split('/').filter(Boolean);
    if (raw.length > 1 && shareName && raw[0] === shareName) raw.shift();
    return raw.map(sanitizeSegment);
  }

  function fnv1a32(text) {
    let h = 0x811c9dc5;
    for (const ch of new TextEncoder().encode(String(text))) {
      h ^= ch;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function addLeafSuffix(name, suffix, maxLength = 140) {
    const s = String(name || 'file.bin');
    const dot = s.lastIndexOf('.');
    const hasShortExt = dot > 0 && s.length - dot <= 20;
    const ext = hasShortExt ? s.slice(dot) : '';
    const stem = hasShortExt ? s.slice(0, dot) : s;
    const room = Math.max(1, maxLength - String(suffix).length - ext.length);
    return `${stem.slice(0, room)}${suffix}${ext}`;
  }

  function allocateLocalPaths(files, shareName) {
    const used = new Set();
    return files.map(source => {
      let segs = sourceLocalSegments(source, shareName);
      if (!segs.length) segs = [sanitizeSegment(source?.name || 'file.bin')];
      const baseLeaf = segs.at(-1);
      let key = segs.join('/').toLocaleLowerCase('en-US');
      if (used.has(key)) {
        const hash = fnv1a32(`${source?.sourceId || ''}|${source?.remotePath || ''}`);
        let n = 0;
        while (true) {
          const suffix = n === 0 ? `__${hash}` : `__${hash}_${n+1}`;
          const leaf = sanitizeSegment(addLeafSuffix(baseLeaf, suffix));
          const candidate = [...segs.slice(0,-1), leaf];
          key = candidate.join('/').toLocaleLowerCase('en-US');
          if (!used.has(key)) { segs = candidate; break; }
          n += 1;
          if (n > 10000) throw new LinkexError('ローカルファイル名の一意化に失敗しました。', {kind:'filesystem'});
        }
      }
      used.add(key);
      return segs;
    });
  }

  function stampForFolder() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function compactSource(source) {
    return {
      sourceId:String(source?.sourceId || ''),
      name:String(source?.name || ''),
      type:source?.type || null,
      size:Number(source?.size || 0),
      remotePath:String(source?.remotePath || source?.name || ''),
      parentId:source?.parentId || null
    };
  }

  function createQueueFromManifest(manifest) {
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

  async function invokeDirectoryPicker(options = {}) {
    const pageWindow = getNativePageWindow();
    const picker = pageWindow?.showDirectoryPicker;
    if (typeof picker !== 'function') throw new LinkexError('このブラウザではshowDirectoryPickerが利用できません。Edge/Chromeの通常ウィンドウで実行してください。', {kind:'filesystem'});
    return await Reflect.apply(picker, pageWindow, [options]);
  }

  async function getQueueRootHandle(job) {
    return await idbGetHandle(`${QUEUE_HANDLE_PREFIX}${job.jobId}`);
  }

  async function putQueueRootHandle(job, handle) {
    return await idbPutHandle(`${QUEUE_HANDLE_PREFIX}${job.jobId}`, handle);
  }

  async function getLocalFileHandle(queueRoot, item) {
    const segs = Array.isArray(item.localSegments) && item.localSegments.length ? item.localSegments : [sanitizeSegment(item.source?.name || 'file.bin')];
    let dir = queueRoot;
    for (const seg of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, {create:true});
    return await dir.getFileHandle(segs.at(-1), {create:true});
  }

  function queueCounts(job) {
    const c = {done:0, pending:0, skippedCapacity:0, unfittable:0, blocked:0, active:0};
    if (!job?.items) return c;
    for (const item of job.items) {
      const s = item.tx?.state === 'DONE' ? 'DONE' : item.state;
      if (s === 'DONE') c.done++;
      else if (s === 'SKIPPED_CAPACITY' || s === 'BLOCKED_CAPACITY') c.skippedCapacity++;
      else if (s === 'UNFITTABLE') c.unfittable++;
      else if (['BLOCKED','ERROR'].includes(s)) c.blocked++;
      else if (['COPYING','COPIED','DOWNLOADING','LOCAL_COMMITTED','DELETING'].includes(s)) c.active++;
      else c.pending++;
    }
    return c;
  }

  function queueSummary(job, {detail=false} = {}) {
    if (!job) return 'Queueなし';
    const c = queueCounts(job);
    const processed = c.done + c.skippedCapacity + c.unfittable;
    const parts = [
      `job: ${job.jobId}`,
      `state: ${job.state}`,
      `folder: ${job.folderName}`,
      `processed: ${processed}/${job.items.length}  DONE:${c.done}  capacity-skip:${c.skippedCapacity}  unfittable:${c.unfittable}  blocked:${c.blocked}`
    ];
    const current = job.items?.[job.currentIndex];
    if (current) parts.push(`current: [${job.currentIndex+1}/${job.items.length}] ${current.source?.remotePath || current.source?.name}  ${current.tx?.state || current.state}`);
    if (job.stopRequested) parts.push('停止予約: 現在ファイルの安全な完了後に停止');
    const issues = (job.items || []).filter(x => ['SKIPPED_CAPACITY','BLOCKED_CAPACITY','UNFITTABLE','BLOCKED','ERROR'].includes(x.state)).slice(-8);
    if (issues.length) {
      parts.push('', 'issues (latest):');
      for (const item of issues) parts.push(`- [${item.index+1}] ${item.source?.remotePath || item.source?.name}  ${item.state}${item.lastError?.message ? `: ${item.lastError.message}` : ''}`);
    }
    if (detail && job.items.length <= 30) {
      parts.push('', 'items:');
      for (const item of job.items) parts.push(`[${item.index+1}] ${item.source?.remotePath || item.source?.name}  ${item.tx?.state || item.state}`);
    }
    if (job.lastError?.message) parts.push('', `lastError: ${job.lastError.message}`);
    return parts.join('\n');
  }

  function persistItemTx(job, index, tx, itemState = null) {
    const item = job.items[index];
    item.tx = tx;
    if (itemState) item.state = itemState;
    saveQueueJob(job);
    saveProbeState(tx);
    return tx;
  }

  function syncTxFromProbe(job, index) {
    const tx = loadProbeState();
    if (tx && tx.operationId === job.items[index]?.tx?.operationId) {
      job.items[index].tx = tx;
      saveQueueJob(job);
    }
    return job.items[index].tx;
  }

  async function acquireLease() {
    const now = Date.now();
    const current = GM_getValue(LEASE_KEY, null);
    if (current?.owner && current.owner !== TAB_ID && Number(current.expiresAt || 0) > now) {
      throw new LinkexError('別タブでLinkex Downloaderが動作中です。そのタブを閉じるか処理完了を待ってください。', {kind:'lease'});
    }
    GM_setValue(LEASE_KEY, {owner:TAB_ID, expiresAt:now + 30000, at:now});
    await sleep(150 + Math.floor(Math.random()*150));
    const verify = GM_getValue(LEASE_KEY, null);
    if (verify?.owner !== TAB_ID) throw new LinkexError('別タブとの実行競合を検出しました。安全のため開始しません。', {kind:'lease'});
    leaseLost = false;
    if (leaseTimer) clearInterval(leaseTimer);
    leaseTimer = setInterval(() => {
      const cur = GM_getValue(LEASE_KEY, null);
      if (cur?.owner && cur.owner !== TAB_ID && Number(cur.expiresAt || 0) > Date.now()) { leaseLost = true; return; }
      GM_setValue(LEASE_KEY, {owner:TAB_ID, expiresAt:Date.now() + 30000, at:Date.now()});
    }, 8000);
  }

  function assertLease() {
    if (leaseLost) throw new LinkexError('別タブとの実行競合を検出しました。安全のため停止します。', {kind:'lease'});
    const cur = GM_getValue(LEASE_KEY, null);
    if (cur?.owner && cur.owner !== TAB_ID && Number(cur.expiresAt || 0) > Date.now()) throw new LinkexError('実行ロックを失いました。安全のため停止します。', {kind:'lease'});
  }

  function releaseLease() {
    if (leaseTimer) { clearInterval(leaseTimer); leaseTimer = null; }
    const cur = GM_getValue(LEASE_KEY, null);
    if (cur?.owner === TAB_ID) GM_setValue(LEASE_KEY, null);
    leaseLost = false;
  }

  async function ensureCopyOwned(api, job, index, onStatus) {
    assertLease();
    const item = job.items[index];
    let tx = item.tx;

    if (!tx) {
      const usage = await api.getUsage();
      const total = Number(usage.total_space || 0);
      const used = Number(usage.used_space || 0);
      const free = total - used;
      const needed = Number(item.source?.size || 0);
      if (total > 0 && needed > total) {
        item.state = 'UNFITTABLE';
        item.lastError = {message:`単一ファイルがLinkex総容量を超えます: ${formatBytes(needed)} > ${formatBytes(total)}`, kind:'unfittable', at:Date.now()};
        saveQueueJob(job);
        throw new LinkexError(item.lastError.message, {kind:'unfittable'});
      }
      if (needed > free) {
        item.state = 'SKIPPED_CAPACITY';
        item.lastError = {message:`Linkex空き容量不足: 必要 ${formatBytes(needed)} / 空き ${formatBytes(free)}`, kind:'capacity', at:Date.now()};
        saveQueueJob(job);
        throw new LinkexError(item.lastError.message, {kind:'capacity'});
      }

      assertLease();
      const beforeRoot = await listAllRoot(api);
      tx = {
        schemaVersion:1,
        operationId:makeId('queue-op'),
        state:'COPY_INTENT',
        shareToken:job.shareToken,
        source:item.source,
        beforeIds:beforeRoot.map(x => String(x.id)),
        startedAt:Date.now(),
        queueJobId:job.jobId,
        queueIndex:index
      };
      persistItemTx(job, index, tx, 'COPYING');
      onStatus?.(`COPY_INTENT [${index+1}/${job.items.length}]\n${item.source.remotePath}\ncopy POSTを1回だけ送信します…`);

      let copyResult;
      try {
        assertLease();
        copyResult = await api.copySharedFile({shareToken:job.shareToken, sourceId:item.source.sourceId});
        tx = {...tx, state:'COPY_REQUEST_SENT', copyResponse:copyResult ?? {}, requestCompletedAt:Date.now()};
        persistItemTx(job, index, tx, 'COPYING');
        await waitTaskIfPresent(api, copyResult, s => onStatus?.(`COPY task: ${s}\n${item.source.remotePath}`));
      } catch (e) {
        if (e?.kind === 'copy_task' && e?.status === 'insufficient_storage') {
          tx = {...tx, state:'COPY_REJECTED_CAPACITY', requestError:{message:e.message, kind:e.kind, status:e.status}, requestFailedAt:Date.now()};
          persistItemTx(job, index, tx, 'SKIPPED_CAPACITY');
          item.lastError = {message:e.message, kind:'capacity', at:Date.now()};
          saveQueueJob(job);
          throw new LinkexError(`Linkexが容量不足としてコピーを拒否しました: ${item.source.remotePath}`, {kind:'capacity'});
        }
        if (e?.kind === 'copy_task' && e?.status === 'size_exceeded') {
          tx = {...tx, state:'COPY_REJECTED_SIZE', requestError:{message:e.message, kind:e.kind, status:e.status}, requestFailedAt:Date.now()};
          persistItemTx(job, index, tx, 'UNFITTABLE');
          item.lastError = {message:e.message, kind:'unfittable', at:Date.now()};
          saveQueueJob(job);
          throw new LinkexError(`Linkexがサイズ上限としてコピーを拒否しました: ${item.source.remotePath}`, {kind:'unfittable'});
        }
        // copy POSTは結果不明でも自動再送しない。必ず照合へ。
        tx = {...tx, state:'NEEDS_RECONCILE', requestError:{message:e?.message || String(e), kind:e?.kind || null}, requestFailedAt:Date.now()};
        persistItemTx(job, index, tx, 'COPYING');
      }
    }

    tx = item.tx;
    if (['COPY_INTENT','COPY_REQUEST_SENT','NEEDS_RECONCILE','UNCERTAIN_NO_EVIDENCE'].includes(tx.state)) {
      onStatus?.(`コピー結果を照合中 [${index+1}/${job.items.length}]…\n${item.source.remotePath}\ncopy POST再送: NO`);
      const rec = await reconcileCopy(api, tx, {timeoutMs:90000, onProgress:x => onStatus?.(`コピー照合中 [${index+1}/${job.items.length}]…\n${item.source.remotePath}\n差分: ${x.diff?.length ?? 0}\n候補: ${x.plausible?.length ?? 0}`)});
      if (rec.status === 'CONFIRMED' || rec.status === 'UNIQUE') {
        tx = {...tx, state:'OWNERSHIP_CONFIRMED', confirmedDest:rec.item, reconciledAt:Date.now()};
        persistItemTx(job, index, tx, 'COPIED');
      } else if (rec.status === 'AMBIGUOUS') {
        tx = {...tx, state:'AMBIGUOUS_COPY', candidates:rec.diff, reconciledAt:Date.now()};
        persistItemTx(job, index, tx, 'BLOCKED');
        throw new LinkexError('コピー先IDを一意に確定できません。自動処理を停止します。', {kind:'ownership'});
      } else {
        tx = {...tx, state:'UNCERTAIN_NO_EVIDENCE', candidates:rec.diff, reconciledAt:Date.now()};
        persistItemTx(job, index, tx, 'BLOCKED');
        throw new LinkexError('copy送信結果を確定できません。安全のため自動再送せず停止します。', {kind:'copy_uncertain'});
      }
    }

    if (tx.state !== 'OWNERSHIP_CONFIRMED' && !['DOWNLOAD_READY','DOWNLOADING','DOWNLOAD_PAUSED','VERIFY_FAILED','LOCAL_COMMITTED','DELETE_INTENT','DELETE_REQUEST_SENT','DELETE_UNCERTAIN','DELETE_UNCERTAIN_PRESENT','DONE'].includes(tx.state)) {
      throw new LinkexError(`未対応のコピー状態: ${tx.state}`, {kind:'state'});
    }
    return item.tx;
  }

  async function ensureDownloaded(api, job, index, queueRoot, onStatus) {
    assertLease();
    const item = job.items[index];
    let tx = item.tx;
    if (['LOCAL_COMMITTED','DELETE_INTENT','DELETE_REQUEST_SENT','DELETE_UNCERTAIN','DELETE_UNCERTAIN_PRESENT','DONE'].includes(tx.state)) return tx;
    if (!tx.confirmedDest?.id) throw new LinkexError('ダウンロード前に所有destIdが確定していません。', {kind:'ownership'});

    const handle = await getLocalFileHandle(queueRoot, item);
    await ensureHandlePermission(handle);
    const owned = await refreshOwnedFileUrl(api, tx.confirmedDest.id);
    if (!sameOwnedIdentity(owned, tx)) throw new LinkexError('ダウンロード開始前にdestIdのidentity変化を検出しました。自動処理を停止します。', {kind:'ownership_lost', destId:tx.confirmedDest.id});
    const local = await handle.getFile();
    // confirmedDestはownership確定時のimmutable snapshotとして維持し、signed URL等の現在metadataは永続化しない。
    tx = {...tx, state:'DOWNLOAD_READY', download:{...(tx.download||{}), destId:tx.confirmedDest.id, localName:local.name, downloadedBytes:local.size, startedAt:tx.download?.startedAt || Date.now(), updatedAt:Date.now()}};
    persistItemTx(job, index, tx, 'DOWNLOADING');

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      assertLease();
      item.attempts.download = (item.attempts.download || 0) + 1;
      saveQueueJob(job);
      try {
        onStatus?.(`DOWNLOADING [${index+1}/${job.items.length}]\n${item.source.remotePath}\n再開可能 / attempt ${attempt}`);
        await downloadOwnedFile({api, state:tx, handle, onProgress:x => {
          const pct = x.expectedTotal ? Math.min(100, x.written / x.expectedTotal * 100) : null;
          onStatus?.(`DOWNLOADING [${index+1}/${job.items.length}]\n${item.source.remotePath}\n${formatBytes(x.written)}${x.expectedTotal ? ` / ${formatBytes(x.expectedTotal)}` : ''}${pct == null ? '' : ` (${pct.toFixed(1)}%)`}\n${x.resumed ? 'Range resume' : 'full/restart'}`);
        }});
        tx = syncTxFromProbe(job, index);
        if (tx.state !== 'LOCAL_COMMITTED') throw new LinkexError(`DL後stateがLOCAL_COMMITTEDではありません: ${tx.state}`, {kind:'state'});
        item.state = 'LOCAL_COMMITTED';
        saveQueueJob(job);
        return tx;
      } catch (e) {
        lastErr = e;
        tx = syncTxFromProbe(job, index) || tx;
        if (attempt < 3 && ['network','cdn','range_416'].includes(e?.kind || 'network')) {
          onStatus?.(`ダウンロード一時失敗。Range再開で再試行します (${attempt}/3)\n${e?.message || e}`);
          await sleep(1000 * attempt);
          continue;
        }
        break;
      }
    }
    throw lastErr || new LinkexError('ダウンロードに失敗しました。');
  }

  async function ensureDeleted(api, job, index, onStatus) {
    assertLease();
    const item = job.items[index];
    let tx = item.tx;
    if (tx.state === 'DONE') return tx;

    // 応答不明の削除は絶対に再送しない。存在/不在だけ照合する。
    if (['DELETE_INTENT','DELETE_REQUEST_SENT','DELETE_UNCERTAIN','DELETE_UNCERTAIN_PRESENT'].includes(tx.state)) {
      onStatus?.(`DELETE結果照合 [${index+1}/${job.items.length}]\n${item.source.remotePath}\ndelete POST再送: NO`);
      const rec = await reconcileDelete(api, tx, {timeoutMs:30000, onProgress:x => onStatus?.(`DELETE照合 [${index+1}/${job.items.length}]\n存在: ${x.exists ? 'YES' : 'NO'}\n再送: NO`)});
      if (rec.status === 'ABSENT') {
        tx = {...tx, state:'DONE', delete:{...(tx.delete||{}), destId:tx.delete?.destId || tx.confirmedDest?.id, confirmedAbsentAt:Date.now()}};
        persistItemTx(job, index, tx, 'DONE');
        return tx;
      }
      tx = {...tx, state:'DELETE_UNCERTAIN_PRESENT', delete:{...(tx.delete||{}), lastSeenAt:Date.now()}};
      persistItemTx(job, index, tx, 'BLOCKED');
      throw new LinkexError('削除結果が不明でdestIdがまだ存在します。安全のためdeleteを再送せず停止します。', {kind:'delete_uncertain'});
    }

    const guard = assertDeleteGuards(tx);
    const current = await findOwnedRootFile(api, guard.destId);
    if (!current) {
      tx = {...tx, state:'DONE', delete:{...(tx.delete||{}), destId:guard.destId, confirmedAbsentAt:Date.now(), alreadyAbsent:true}};
      persistItemTx(job, index, tx, 'DONE');
      return tx;
    }
    if (!sameOwnedIdentity(current, tx)) throw new LinkexError('削除拒否: 現在のdestId identityが所有権確定時と一致しません。', {kind:'delete_guard'});

    tx = {...tx, state:'DELETE_INTENT', delete:{destId:guard.destId, intendedAt:Date.now(), requestSent:false}};
    persistItemTx(job, index, tx, 'DELETING');
    onStatus?.(`DELETING [${index+1}/${job.items.length}]\n${item.source.remotePath}\ndestId: ${guard.destId}\n1件だけ削除します…`);
    try {
      assertLease();
      const result = await api.deleteSingleFile(guard.destId);
      tx = {...tx, state:'DELETE_REQUEST_SENT', delete:{...(tx.delete||{}), requestSent:true, response:result ?? {}, requestCompletedAt:Date.now()}};
      persistItemTx(job, index, tx, 'DELETING');
    } catch (e) {
      tx = {...tx, state:'DELETE_UNCERTAIN', delete:{...(tx.delete||{}), requestSent:true, requestError:{message:e?.message || String(e), kind:e?.kind || null}, requestFailedAt:Date.now()}};
      persistItemTx(job, index, tx, 'DELETING');
    }

    return await ensureDeleted(api, job, index, onStatus);
  }

  async function processQueue(job, queueRoot, onStatus) {
    if (!job || !queueRoot) throw new LinkexError('Queueまたは保存先がありません。');
    await ensureHandlePermission(queueRoot);
    const creds = discoverCredentials();
    if (!creds) throw new LinkexError('Linkexログイン情報を検出できません。');
    const api = new LinkexApi({token:creds.token});
    job.state = 'RUNNING';
    job.lastError = null;
    saveQueueJob(job);

    for (let i = 0; i < job.items.length; i++) {
      assertLease();
      job.currentIndex = i;
      saveQueueJob(job);
      const item = job.items[i];
      if (item.state === 'DONE' || item.tx?.state === 'DONE') { item.state = 'DONE'; continue; }
      if (['SKIPPED_CAPACITY','UNFITTABLE'].includes(item.state)) continue;
      try {
        await ensureCopyOwned(api, job, i, onStatus);
        await ensureDownloaded(api, job, i, queueRoot, onStatus);
        await ensureDeleted(api, job, i, onStatus);
        item.state = 'DONE';
        item.lastError = null;
        saveQueueJob(job);
        onStatus?.(`完了 [${i+1}/${job.items.length}]\n${item.source.remotePath}\nLinkex一時コピー削除確認済み`);
      } catch (e) {
        const kind = e?.kind || null;
        item.lastError = {message:e?.message || String(e), kind, at:Date.now()};
        if (kind === 'capacity') {
          item.state = 'SKIPPED_CAPACITY';
          saveQueueJob(job);
          onStatus?.(`容量不足でスキップ [${i+1}/${job.items.length}]\n${item.source.remotePath}\n次のファイルへ進みます。`);
        } else if (kind === 'unfittable') {
          item.state = 'UNFITTABLE';
          saveQueueJob(job);
          onStatus?.(`単一ファイル上限でスキップ [${i+1}/${job.items.length}]\n${item.source.remotePath}\n次のファイルへ進みます。`);
        } else {
          item.state = item.state === 'DONE' ? 'DONE' : 'BLOCKED';
          job.state = 'PAUSED';
          job.lastError = {message:e?.message || String(e), kind, index:i, at:Date.now()};
          saveQueueJob(job);
          throw e;
        }
      }

      if (job.stopRequested) {
        job.stopRequested = false;
        job.state = 'PAUSED_USER';
        saveQueueJob(job);
        return job;
      }
    }

    const c = queueCounts(job);
    job.state = (c.skippedCapacity || c.unfittable || c.blocked) ? 'DONE_WITH_SKIPS' : 'DONE';
    job.completedAt = Date.now();
    saveQueueJob(job);
    return job;
  }

  function resetRetryableSkips(job) {
    if (!job) return 0;
    let n = 0;
    for (const item of job.items || []) {
      if (['SKIPPED_CAPACITY','UNFITTABLE'].includes(item.state)) {
        // これらは所有destId未確定の安全な事前/サーバー拒否状態だけ再試行対象。
        if (item.tx?.confirmedDest?.id) continue;
        item.state = 'PENDING';
        item.tx = null;
        item.lastError = null;
        n += 1;
      }
    }
    if (n) {
      job.state = 'PAUSED_USER';
      job.completedAt = null;
      job.lastError = null;
      job.stopRequested = false;
      saveQueueJob(job);
    }
    return n;
  }

  // --- v1.0.0 shell: diagnostics / support bundle / UI preferences ---
  // Transaction core above is intentionally kept unchanged from the verified v0.6.0 engine.
  const EVENT_LOG_KEY = 'linkexDownloaderEventLogV1';
  const UI_PREFS_KEY = 'linkexDownloaderUiPrefsV1';
  const MAX_EVENT_LOG = 800;

  function loadUiPrefs() {
    const v = GM_getValue(UI_PREFS_KEY, null);
    return v && typeof v === 'object' ? v : {collapsed:false};
  }

  function saveUiPrefs(prefs) {
    GM_setValue(UI_PREFS_KEY, prefs);
    return prefs;
  }

  function loadEventLog() {
    const v = GM_getValue(EVENT_LOG_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  function recordEvent(level, type, message, data = null) {
    const log = loadEventLog();
    const entry = {
      at: Date.now(),
      level: String(level || 'info'),
      type: String(type || 'event'),
      message: String(message || '').slice(0, 4000)
    };
    if (data && typeof data === 'object') entry.data = redactForExport(data, 0);
    log.push(entry);
    if (log.length > MAX_EVENT_LOG) log.splice(0, log.length - MAX_EVENT_LOG);
    GM_setValue(EVENT_LOG_KEY, log);
    return entry;
  }

  function redactForExport(value, depth = 0) {
    if (depth > 12) return '[max-depth]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (isJwtLike(value)) return '[REDACTED_JWT]';
      if (/^https?:\/\//i.test(value) && /(?:token=|sign=|signature=|expires=|auth=)/i.test(value)) return '[REDACTED_SIGNED_URL]';
      return value.length > 12000 ? `${value.slice(0,12000)}…[truncated]` : value;
    }
    if (Array.isArray(value)) return value.map(v => redactForExport(v, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (/(token|authorization|cookie|signature|signed.*url|^url$|headers?)/i.test(k)) {
          out[k] = '[REDACTED]';
        } else {
          out[k] = redactForExport(v, depth + 1);
        }
      }
      return out;
    }
    return String(value);
  }

  function dateStamp(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function downloadSupportBundle() {
    const queue = loadQueueJob();
    const bundle = {
      product: 'Linkex Downloader',
      version: VERSION,
      generatedAt: new Date().toISOString(),
      signatureSelfTest: runSignatureSelfTest().map(x => ({name:x.name, ok:x.ok, actual:x.actual, expected:x.expected})),
      queue: redactForExport(queue),
      events: redactForExport(loadEventLog())
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkex-support-${dateStamp()}.json`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return bundle;
  }

  function createPanel() {
    const root = document.createElement('div');
    root.id = 'linkex-full-queue';
    root.innerHTML = `
      <style>
        #linkex-full-queue { position:fixed; right:18px; bottom:18px; width:540px; z-index:2147483647; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; color:#eef2ff; }
        #linkex-full-queue .box { background:#111827; border:1px solid #374151; border-radius:14px; box-shadow:0 18px 45px rgba(0,0,0,.4); overflow:hidden; }
        #linkex-full-queue .hd { padding:11px 12px 11px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; background:#0b1220; border-bottom:1px solid #374151; }
        #linkex-full-queue .hd-left { display:flex; align-items:center; gap:8px; min-width:0; }
        #linkex-full-queue .title { font-weight:750; font-size:14px; white-space:nowrap; }
        #linkex-full-queue .badge { font-size:10px; padding:3px 7px; border-radius:999px; background:#14532d; color:#bbf7d0; white-space:nowrap; }
        #linkex-full-queue .mini { flex:0 0 auto; width:auto; padding:5px 9px; font-size:12px; background:#374151; color:#fff; }
        #linkex-full-queue .body { padding:12px; }
        #linkex-full-queue.collapsed .body { display:none; }
        #linkex-full-queue input { width:100%; box-sizing:border-box; background:#0b1220; border:1px solid #4b5563; color:#fff; border-radius:8px; padding:9px 10px; margin-bottom:8px; }
        #linkex-full-queue .row { display:flex; gap:8px; margin-bottom:8px; }
        #linkex-full-queue button { flex:1; border:0; border-radius:8px; padding:9px 10px; cursor:pointer; font-weight:700; }
        #linkex-full-queue button:disabled { opacity:.4; cursor:not-allowed; }
        #linkex-full-queue .primary { background:#2563eb; color:#fff; }
        #linkex-full-queue .warn { background:#d97706; color:#fff; }
        #linkex-full-queue .secondary { background:#374151; color:#fff; }
        #linkex-full-queue .progress-wrap { margin:2px 0 9px; }
        #linkex-full-queue .progress-meta { display:flex; justify-content:space-between; gap:8px; font-size:11px; color:#cbd5e1; margin-bottom:4px; }
        #linkex-full-queue .progress { height:7px; border-radius:999px; background:#1f2937; overflow:hidden; border:1px solid #374151; }
        #linkex-full-queue .progress > i { display:block; height:100%; width:0%; background:#2563eb; transition:width .2s ease; }
        #linkex-full-queue .status { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; background:#0b1220; border:1px solid #374151; border-radius:8px; padding:10px; max-height:350px; overflow:auto; }
        #linkex-full-queue .ok { border-color:#166534; color:#bbf7d0; }
        #linkex-full-queue .err { border-color:#991b1b; color:#fecaca; }
        #linkex-full-queue .notice { font-size:11px; color:#9ca3af; margin-top:8px; line-height:1.45; }
      </style>
      <div class="box">
        <div class="hd">
          <div class="hd-left"><div class="title">Linkex Downloader v${VERSION}</div><div class="badge">SAFE QUEUE</div></div>
          <button id="lf-collapse" class="mini" title="最小化/展開">−</button>
        </div>
        <div class="body">
          <input id="lf-url" placeholder="https://l2e.click/d/xxxxxxxx" />
          <div class="row"><button id="lf-analyze" class="primary">共有リンクを解析</button><button id="lf-selftest" class="secondary">署名テスト</button></div>
          <div class="row"><button id="lf-start" class="warn" disabled>全ファイル開始</button><button id="lf-resume" class="primary" disabled>Queueを再開</button></div>
          <div class="row"><button id="lf-pause" class="secondary" disabled>現在ファイル後に停止</button><button id="lf-retry" class="secondary" disabled>容量スキップを再試行</button></div>
          <div class="row"><button id="lf-export" class="secondary">診断ログを保存</button><button id="lf-refresh" class="secondary">状態を再表示</button></div>
          <div class="progress-wrap">
            <div class="progress-meta"><span id="lf-progress-text">Queueなし</span><span id="lf-progress-pct">0%</span></div>
            <div class="progress"><i id="lf-progress-bar"></i></div>
          </div>
          <div id="lf-status" class="status">v0.6.0で実機検証済みのトランザクション中核を維持した正式版です。\n1ファイルずつ COPY → DL → VERIFY → 所有destIdだけDELETE します。</div>
          <div class="notice">安全規則: copy/delete応答不明時は盲目的に再送しません。削除はLOCAL_COMMITTEDかつ所有権確定済みdestId 1件だけ。実行中は別端末からLinkexを変更しないでください。診断ログはtoken・署名付きURLを伏せて書き出します。</div>
        </div>
      </div>`;
    document.body.appendChild(root);

    const input = root.querySelector('#lf-url');
    const status = root.querySelector('#lf-status');
    const analyzeBtn = root.querySelector('#lf-analyze');
    const startBtn = root.querySelector('#lf-start');
    const resumeBtn = root.querySelector('#lf-resume');
    const pauseBtn = root.querySelector('#lf-pause');
    const retryBtn = root.querySelector('#lf-retry');
    const exportBtn = root.querySelector('#lf-export');
    const refreshBtn = root.querySelector('#lf-refresh');
    const collapseBtn = root.querySelector('#lf-collapse');
    const progressText = root.querySelector('#lf-progress-text');
    const progressPct = root.querySelector('#lf-progress-pct');
    const progressBar = root.querySelector('#lf-progress-bar');

    let lastUiEventText = '';
    let lastUiEventAt = 0;
    const write = (text, cls='') => {
      status.className = `status ${cls}`;
      status.textContent = text;
      const now = Date.now();
      // Download progress can update frequently; avoid flooding persistent diagnostics.
      const isProgress = /^DOWNLOADING\b/.test(text);
      if (text !== lastUiEventText && (!isProgress || now - lastUiEventAt >= 5000)) {
        recordEvent(cls === 'err' ? 'error' : 'info', 'ui', text);
        lastUiEventText = text;
        lastUiEventAt = now;
      }
      refreshProgress();
    };

    let manifest = null;
    let running = false;
    input.value = GM_getValue(LAST_URL_KEY, '') || '';

    const prefs = loadUiPrefs();
    if (prefs.collapsed) root.classList.add('collapsed');
    collapseBtn.textContent = prefs.collapsed ? '+' : '−';

    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }

    function refreshProgress() {
      const job = loadQueueJob();
      if (!job?.items?.length) {
        progressText.textContent = manifest?.files?.length ? `解析済み: ${manifest.files.length} files / ${formatBytes(manifest.totalBytes)}` : 'Queueなし';
        progressPct.textContent = '0%';
        progressBar.style.width = '0%';
        return;
      }
      const c = queueCounts(job);
      const terminal = c.done + c.skippedCapacity + c.unfittable;
      const pct = Math.max(0, Math.min(100, terminal / job.items.length * 100));
      progressText.textContent = `DONE ${c.done}/${job.items.length} · skip ${c.skippedCapacity + c.unfittable} · blocked ${c.blocked}`;
      progressPct.textContent = `${pct.toFixed(job.items.length > 200 ? 1 : 0)}%`;
      progressBar.style.width = `${pct}%`;
    }

    function refreshQueueUi() {
      const job = loadQueueJob();
      const active = job && !isTerminal(job);
      resumeBtn.disabled = running || !active;
      startBtn.disabled = running || !manifest?.files?.length || !!active;
      pauseBtn.disabled = !running || !job || !!job.stopRequested;
      const c = queueCounts(job);
      retryBtn.disabled = running || !job || !(c.skippedCapacity || c.unfittable) || !isTerminal(job);
      analyzeBtn.disabled = running;
      refreshProgress();
      return job;
    }

    collapseBtn.addEventListener('click', () => {
      const collapsed = !root.classList.contains('collapsed');
      root.classList.toggle('collapsed', collapsed);
      collapseBtn.textContent = collapsed ? '+' : '−';
      saveUiPrefs({...loadUiPrefs(), collapsed});
    });

    root.querySelector('#lf-selftest').addEventListener('click', () => {
      const tests = runSignatureSelfTest();
      const ok = tests.every(t=>t.ok);
      write(tests.map(t => `${t.ok ? 'PASS' : 'FAIL'} ${t.name}\n${t.actual}`).join('\n\n'), ok ? 'ok' : 'err');
      recordEvent(ok ? 'info' : 'error', 'signature-selftest', ok ? 'PASS' : 'FAIL', {tests:tests.map(t=>({name:t.name,ok:t.ok}))});
    });

    analyzeBtn.addEventListener('click', async () => {
      analyzeBtn.disabled = true;
      try {
        const token = parseShareToken(input.value);
        GM_setValue(LAST_URL_KEY, input.value.trim());
        const api = new LinkexApi({token:null});
        write('共有manifestを読み取り中…');
        manifest = await buildManifest(api, token, x => write(`共有manifestを読み取り中…\nfiles: ${x.files}\n${x.path || ''}`));
        const largest = [...manifest.files].sort((a,b)=>Number(b.size||0)-Number(a.size||0))[0];
        write([
          '解析成功（読み取りのみ）',
          `共有名: ${manifest.shareName || '(unknown)'}`,
          `全ファイル: ${manifest.files.length}`,
          `全フォルダ: ${manifest.folders.length}`,
          `合計: ${formatBytes(manifest.totalBytes)}`,
          largest ? `最大ファイル: ${formatBytes(largest.size)}  ${largest.remotePath}` : '',
          '',
          '開始するとジョブ専用ローカルフォルダを作成し、全ファイルを1件ずつ処理します。'
        ].filter(Boolean).join('\n'), 'ok');
        recordEvent('info', 'manifest', '共有解析成功', {shareName:manifest.shareName, fileCount:manifest.files.length, folderCount:manifest.folders.length, totalBytes:manifest.totalBytes});
      } catch (e) {
        console.error('[Linkex analyze]', e);
        write(`解析失敗: ${e?.message || e}`, 'err');
        recordEvent('error', 'manifest', `共有解析失敗: ${e?.message || e}`);
        manifest = null;
      } finally { analyzeBtn.disabled = false; refreshQueueUi(); }
    });

    async function runJob(job, queueRoot, resume=false) {
      // 呼び出し側がleaseを取得済みであること。Queue stateのmutationより先に排他を確立する。
      assertLease();
      recordEvent('info', resume ? 'queue-resume' : 'queue-start', `${resume ? 'Queue再開' : 'Queue開始'}: ${job.jobId}`, {jobId:job.jobId, items:job.items?.length, folderName:job.folderName});
      try {
        const result = await processQueue(job, queueRoot, t => write(`${t}\n\n${queueSummary(loadQueueJob())}`));
        if (result.state === 'PAUSED_USER') {
          write(`安全停止しました（現在ファイルの処理境界）。\n\n${queueSummary(result)}\n\n「Queueを再開」で続行できます。`, '');
          recordEvent('info', 'queue-paused-user', `安全停止: ${result.jobId}`);
        } else if (result.state === 'DONE_WITH_SKIPS') {
          write(`全Queue走査完了（スキップあり）\n\n${queueSummary(result, {detail:true})}\n\n容量を空ける/プラン変更後は「容量スキップを再試行」が使えます。`, 'ok');
          recordEvent('info', 'queue-done-with-skips', `Queue完了（スキップあり）: ${result.jobId}`, {counts:queueCounts(result)});
        } else {
          write(`全Queue成功${resume ? '（再開）' : ''}\n\n${queueSummary(result, {detail:true})}\n\nローカル検証済み・Linkex一時コピー削除確認済みです。`, 'ok');
          recordEvent('info', 'queue-done', `Queue成功: ${result.jobId}`, {counts:queueCounts(result)});
        }
        return result;
      } catch (e) {
        recordEvent('error', 'queue-stop', `Queue停止: ${e?.message || e}`, {jobId:job?.jobId, kind:e?.kind || null});
        throw e;
      }
    }

    startBtn.addEventListener('click', async () => {
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

    resumeBtn.addEventListener('click', async () => {
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
        if (!queueRoot) throw new LinkexError('保存先DirectoryHandleが見つかりません。開始時と同じTampermonkeyスクリプトを使用してください。', {kind:'filesystem'});
        await ensureHandlePermission(queueRoot);
        job.stopRequested = false;
        saveQueueJob(job);
        write(`Queue再開\n\n${queueSummary(job)}\n\n現状態を照合して続行します。`);
        await runJob(job, queueRoot, true);
      } catch (e) {
        console.error('[Linkex Resume]', e);
        write(`Queue再開停止: ${e?.message || e}\n\n${queueSummary(loadQueueJob())}`, 'err');
      } finally { running = false; releaseLease(); refreshQueueUi(); }
    });

    pauseBtn.addEventListener('click', () => {
      const job = loadQueueJob();
      if (!job || !running) return;
      job.stopRequested = true;
      saveQueueJob(job);
      recordEvent('info', 'pause-requested', `停止予約: ${job.jobId}`);
      write(`停止予約を受け付けました。\n現在のファイルの COPY → DL → VERIFY → DELETE を安全に完了した境界で停止します。\n\n${queueSummary(job)}`);
      refreshQueueUi();
    });

    retryBtn.addEventListener('click', () => {
      if (running) return;
      const job = loadQueueJob();
      if (!job) return;
      const n = resetRetryableSkips(job);
      if (!n) { write(`再試行可能な容量スキップはありません。\n\n${queueSummary(job)}`); return; }
      recordEvent('info', 'retry-skips', `${n}件を再試行待ちへ戻しました`, {jobId:job.jobId, count:n});
      write(`${n}件の容量/サイズスキップを再試行待ちに戻しました。\n\n${queueSummary(job)}\n\n「Queueを再開」を押してください。`, 'ok');
      refreshQueueUi();
    });

    exportBtn.addEventListener('click', () => {
      try {
        const bundle = downloadSupportBundle();
        write(`診断ログを保存しました。\nevents: ${bundle.events?.length || 0}\nQueue情報と署名セルフテストを含みます。\nToken・署名付きURLは書き出し時に伏せています。`, 'ok');
      } catch (e) {
        write(`診断ログ保存失敗: ${e?.message || e}`, 'err');
      }
    });

    refreshBtn.addEventListener('click', () => {
      const job = refreshQueueUi();
      if (!job) write('保存済みQueueはありません。');
      else if (job.state === 'DONE') write(`前回Queueは完了済みです。\n\n${queueSummary(job, {detail:true})}`, 'ok');
      else if (job.state === 'DONE_WITH_SKIPS') write(`前回Queueはスキップありで走査完了しています。\n\n${queueSummary(job, {detail:true})}`, 'ok');
      else write(`未完了Queueがあります。\n\n${queueSummary(job)}\n\n「Queueを再開」で状態照合から続けられます。`);
    });

    const existing = refreshQueueUi();
    if (existing) {
      if (existing.state === 'DONE') write(`前回Full Queueは完了済みです。\n\n${queueSummary(existing, {detail:true})}\n\n別共有は解析して「全ファイル開始」できます。`, 'ok');
      else if (existing.state === 'DONE_WITH_SKIPS') write(`前回Full Queueはスキップありで走査完了しています。\n\n${queueSummary(existing, {detail:true})}\n\n容量条件を変えた場合は「容量スキップを再試行」が使えます。`, 'ok');
      else write(`未完了Full Queueを検出しました。\n\n${queueSummary(existing)}\n\n「Queueを再開」で状態照合から続けられます。`, '');
    }
    recordEvent('info', 'startup', `Linkex Downloader v${VERSION} 起動`);
    return root;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel, {once:true});
  else createPanel();
})();
