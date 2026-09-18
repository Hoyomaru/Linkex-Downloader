// ==UserScript==
// @name         Linkex Downloader
// @namespace    openai-linkex-helper
// @version      1.2.1
// @description  Linkex共有ページからワンクリックで安全にQueue保存。選択DL・再開・検証・所有ID限定削除・診断付き。
// @license      MIT
// @match        https://disk.linkex.io/*
// @match        https://l2e.click/d/*
// @match        https://www.l2e.click/d/*
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

  const VERSION = '1.2.1';
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


  const CREDENTIAL_BRIDGE_KEY = 'linkexCredentialBridgeV1';
  const CREDENTIAL_BRIDGE_FALLBACK_TTL_MS = 12 * 60 * 60 * 1000;

  function currentPageUrl(input = null) {
    try { return new URL(input == null ? String(globalThis.location?.href || '') : String(input)); }
    catch { return null; }
  }

  function isDiskStoragePage(input = null) {
    const url = currentPageUrl(input);
    return !!url && url.protocol === 'https:' && url.hostname.toLowerCase() === 'disk.linkex.io';
  }

  function jwtExpiryMs(token) {
    if (!isJwtLike(token) || typeof atob !== 'function') return null;
    try {
      let payload = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      payload += '='.repeat((4 - payload.length % 4) % 4);
      const parsed = JSON.parse(atob(payload));
      const exp = Number(parsed?.exp);
      return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
    } catch { return null; }
  }

  function writeCredentialBridge(credential) {
    if (!credential?.token || !isDiskStoragePage()) return null;
    const cachedAt = Date.now();
    const jwtExpiry = jwtExpiryMs(credential.token);
    if (jwtExpiry !== null && jwtExpiry <= cachedAt) {
      GM_setValue(CREDENTIAL_BRIDGE_KEY, null);
      return null;
    }
    const expiresAt = Math.min(jwtExpiry ?? Number.POSITIVE_INFINITY, cachedAt + CREDENTIAL_BRIDGE_FALLBACK_TTL_MS);
    const value = {schemaVersion:1, token:credential.token, cachedAt, expiresAt, sourceOrigin:'https://disk.linkex.io'};
    GM_setValue(CREDENTIAL_BRIDGE_KEY, value);
    return value;
  }

  function readCredentialBridge(now = Date.now()) {
    const value = GM_getValue(CREDENTIAL_BRIDGE_KEY, null);
    if (!value || typeof value !== 'object' || !isJwtLike(value.token)) return null;
    const expiresAt = Number(value.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      GM_setValue(CREDENTIAL_BRIDGE_KEY, null);
      return null;
    }
    return {token:value.token, refreshToken:null, source:'gm-bridge', cachedAt:Number(value.cachedAt || 0), expiresAt};
  }

  function syncCredentialBridgeFromDisk({clearIfMissing = false} = {}) {
    if (!isDiskStoragePage()) return null;
    const credential = discoverCredentials();
    if (credential?.token) {
      writeCredentialBridge(credential);
      return {...credential, source:'disk-localStorage'};
    }
    if (clearIfMissing) GM_setValue(CREDENTIAL_BRIDGE_KEY, null);
    return null;
  }

  function resolveCredentials() {
    if (isDiskStoragePage()) {
      const local = syncCredentialBridgeFromDisk();
      if (local?.token) return local;
    }
    return readCredentialBridge();
  }

  function credentialBootstrapMessage() {
    if (isDiskStoragePage()) return 'Linkexログイン情報を検出できませんでした。disk.linkex.ioでログイン後にページを再読み込みしてください。';
    return 'Linkexログイン情報を利用できません。disk.linkex.ioへログインした状態で一度ページを開き、この共有ページへ戻ってください。';
  }

  function getNativePageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch { /* fall through */ }
    return window;
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

  function parseRetryAfterMs(responseHeaders) {
    const line = String(responseHeaders || '').split(/\r?\n/).find(x => /^retry-after\s*:/i.test(x));
    if (!line) return null;
    const value = line.slice(line.indexOf(':') + 1).trim();
    if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.round(Number(value) * 1000));
    const when = Date.parse(value);
    return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
  }

  function isRetryableReadStatus(status) {
    const n = Number(status || 0);
    return n === 429 || (n >= 500 && n <= 599);
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
      const upperMethod = String(method || 'GET').toUpperCase();
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

  function isSharePageHost(input = null) {
    const url = currentPageUrl(input);
    if (!url || url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'l2e.click' || host === 'www.l2e.click';
  }

  function detectSharePageTarget(input = null) {
    const url = currentPageUrl(input);
    if (!url || !isSharePageHost(url.href)) return null;
    const match = url.pathname.match(/^\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match) return null;
    return {shareToken:match[1], href:url.href, hostname:url.hostname.toLowerCase()};
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

  const PROBE_KEY = 'linkexCopyProbeStateV1'; // legacy single-operation key; read-only migration fallback
  const PROBE_KEY_PREFIX = 'linkexCopyProbeStateV2:';
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

  function probeKeyFor(operationOrState) {
    const operationId = typeof operationOrState === 'string'
      ? operationOrState
      : String(operationOrState?.operationId || '');
    return operationId ? `${PROBE_KEY_PREFIX}${operationId}` : null;
  }

  function saveProbeState(state) {
    // Queue transactions always have operationId and therefore use isolated keys.
    // Keep the old single-operation key only for legacy/probe callers that predate operationId.
    const key = probeKeyFor(state) || PROBE_KEY;
    GM_setValue(key, state);
    return state;
  }

  function loadProbeState(operationOrState = null) {
    const key = probeKeyFor(operationOrState);
    if (key) {
      const scoped = GM_getValue(key, null);
      if (scoped && typeof scoped === 'object') return scoped;
      // v1.2.x / early v1.3 queues may still have only the legacy global probe.
      const legacy = GM_getValue(PROBE_KEY, null);
      const operationId = typeof operationOrState === 'string' ? operationOrState : operationOrState?.operationId;
      if (legacy && typeof legacy === 'object' && String(legacy.operationId || '') === String(operationId || '')) {
        GM_setValue(key, legacy);
        return legacy;
      }
      return null;
    }
    const legacy = GM_getValue(PROBE_KEY, null);
    return legacy && typeof legacy === 'object' ? legacy : null;
  }

  function clearProbeState(operationOrState) {
    const key = probeKeyFor(operationOrState);
    if (key) GM_setValue(key, null);
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
  const PREFERRED_DIR_HANDLE_KEY = 'preferred-download-root:v1';
  const CHECKPOINT_BYTES = 16 * 1024 * 1024;
  const CHECKPOINT_INTERVAL_MS = 1000;
  const UI_UPDATE_INTERVAL_MS = 750;
  const WRITE_BUFFER_BYTES = 4 * 1024 * 1024;
  const PERFORMANCE_SCHEMA_VERSION = 1;

  function perfPhaseStart(tx, phase, at = Date.now()) {
    const performance = {...(tx?.performance || {}), schemaVersion:PERFORMANCE_SCHEMA_VERSION};
    const current = {...(performance[phase] || {})};
    if (!Number(current.startedAt || 0)) current.startedAt = at;
    performance[phase] = current;
    return {...tx, performance};
  }

  function perfPhaseEnd(tx, phase, at = Date.now(), extra = {}) {
    const startedAt = Number(tx?.performance?.[phase]?.startedAt || 0) || at;
    const performance = {...(tx?.performance || {}), schemaVersion:PERFORMANCE_SCHEMA_VERSION};
    performance[phase] = {
      ...(performance[phase] || {}),
      startedAt,
      endedAt:at,
      durationMs:Math.max(0, at - startedAt),
      ...extra
    };
    return {...tx, performance};
  }

  function perfPhaseSet(tx, phase, values = {}) {
    const performance = {...(tx?.performance || {}), schemaVersion:PERFORMANCE_SCHEMA_VERSION};
    performance[phase] = {...(performance[phase] || {}), ...values};
    return {...tx, performance};
  }

  function bytesPerSecondToMBps(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) && n >= 0 ? n / (1024 * 1024) : 0;
  }

  function formatTransferRate(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B/s';
    return `${formatBytes(n)}/s`;
  }

  function mergeWriteBufferChunks(chunks, totalBytes) {
    const total = Number(totalBytes || 0);
    if (!Number.isFinite(total) || total < 0) throw new LinkexError('書き込みバッファサイズが不正です。', {kind:'filesystem'});
    if (total === 0) return new Uint8Array(0);
    if (chunks.length === 1 && Number(chunks[0]?.byteLength || 0) === total) return chunks[0];
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      const size = Number(chunk?.byteLength || 0);
      if (!size) continue;
      if (offset + size > total) throw new LinkexError('書き込みバッファの合計サイズが不一致です。', {kind:'filesystem'});
      merged.set(chunk, offset);
      offset += size;
    }
    if (offset !== total) throw new LinkexError('書き込みバッファの合計サイズが不一致です。', {kind:'filesystem'});
    return merged;
  }

  function buildPerformanceSummary(job) {
    const phaseNames = ['copy','ownershipReconcile','download','verify','delete','total'];
    const phaseMs = Object.fromEntries(phaseNames.map(name => [name, 0]));
    let measuredTransactions = 0;
    let completedTransactions = 0;
    let transferredBytes = 0;
    let measuredTransferMs = 0;
    let peakBytesPerSecond = 0;
    let firstTransferStartedAt = null;
    let lastTransferEndedAt = null;

    for (const item of job?.items || []) {
      const tx = item?.tx;
      if (!tx) continue;
      if (tx.state === 'DONE' || item.state === 'DONE') completedTransactions += 1;
      if (tx.performance && typeof tx.performance === 'object') {
        measuredTransactions += 1;
        for (const name of phaseNames) {
          const duration = Number(tx.performance?.[name]?.durationMs || 0);
          if (Number.isFinite(duration) && duration >= 0) phaseMs[name] += duration;
        }
      }
      const transfer = tx.download?.telemetry || {};
      const bytes = Number(transfer.transferredBytes || 0);
      const duration = Number(transfer.durationMs || 0);
      const peak = Number(transfer.peakBytesPerSecond || 0);
      const startedAt = Number(transfer.transferStartedAt || 0);
      const endedAt = Number(transfer.transferEndedAt || 0);
      if (Number.isFinite(bytes) && bytes >= 0) transferredBytes += bytes;
      if (Number.isFinite(duration) && duration > 0) measuredTransferMs += duration;
      if (Number.isFinite(peak) && peak > peakBytesPerSecond) peakBytesPerSecond = peak;
      if (startedAt > 0 && endedAt >= startedAt) {
        firstTransferStartedAt = firstTransferStartedAt == null ? startedAt : Math.min(firstTransferStartedAt, startedAt);
        lastTransferEndedAt = lastTransferEndedAt == null ? endedAt : Math.max(lastTransferEndedAt, endedAt);
      }
    }

    // Legacy/single-worker comparable metric: bytes divided by the sum of each
    // transfer's own elapsed time. With parallel workers this approximates the
    // weighted per-connection rate, not aggregate pool throughput.
    const aggregateBytesPerSecond = measuredTransferMs > 0 ? transferredBytes * 1000 / measuredTransferMs : 0;

    // Pipeline-aware wall metrics. transferWindowMs includes overlap (and any
    // gaps) from the first network byte window to the last completed transfer,
    // so poolDownloadMBps is the aggregate throughput that matters for DL=2.
    const transferWindowMs = firstTransferStartedAt != null && lastTransferEndedAt != null
      ? Math.max(0, lastTransferEndedAt - firstTransferStartedAt)
      : 0;
    const poolBytesPerSecond = transferWindowMs > 0 ? transferredBytes * 1000 / transferWindowMs : 0;

    const pipelineStartedAt = Number(job?.pipeline?.startedAt || 0);
    const pipelineCompletedAt = Number(job?.pipeline?.completedAt || 0);
    const pipelineWallMs = pipelineStartedAt > 0 && pipelineCompletedAt >= pipelineStartedAt
      ? pipelineCompletedAt - pipelineStartedAt
      : 0;
    const pipelineEffectiveBytesPerSecond = pipelineWallMs > 0 ? transferredBytes * 1000 / pipelineWallMs : 0;

    const queueCreatedAt = Number(job?.createdAt || 0);
    const queueCompletedAt = Number(job?.completedAt || 0);
    const queueWallMs = queueCreatedAt > 0 && queueCompletedAt >= queueCreatedAt
      ? queueCompletedAt - queueCreatedAt
      : 0;
    const queueEffectiveBytesPerSecond = queueWallMs > 0 ? transferredBytes * 1000 / queueWallMs : 0;

    return {
      schemaVersion:PERFORMANCE_SCHEMA_VERSION,
      completedTransactions,
      measuredTransactions,
      transferredBytes,
      phaseMs,
      measuredTransferMs,
      aggregateBytesPerSecond,
      aggregateDownloadMBps:bytesPerSecondToMBps(aggregateBytesPerSecond),
      peakBytesPerSecond,
      firstTransferStartedAt,
      lastTransferEndedAt,
      transferWindowMs,
      poolBytesPerSecond,
      poolDownloadMBps:bytesPerSecondToMBps(poolBytesPerSecond),
      pipelineWallMs,
      pipelineEffectiveBytesPerSecond,
      pipelineEffectiveMBps:bytesPerSecondToMBps(pipelineEffectiveBytesPerSecond),
      queueWallMs,
      queueEffectiveBytesPerSecond,
      queueEffectiveMBps:bytesPerSecondToMBps(queueEffectiveBytesPerSecond)
    };
  }

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

  function commitVerifiedDownload(state, {destId, downloadedBytes, expectedCdnBytes = null, localName, verificationMethod = 'content-length'}) {
  const downloaded = Number(downloadedBytes);
  if (!Number.isFinite(downloaded) || downloaded < 0) {
    throw new LinkexError(`ダウンロード済みサイズが不正です: ${downloadedBytes}`, {kind:'verify', actual:downloadedBytes});
  }

  let expected = null;
  let sizeVerified = false;
  let streamComplete = false;
  if (verificationMethod === 'content-length') {
    expected = Number(expectedCdnBytes);
    if (!Number.isFinite(expected) || expected < 0 || downloaded !== expected) {
      throw new LinkexError(`サイズ検証失敗: local=${downloadedBytes} / CDN=${expectedCdnBytes}`, {kind:'verify', actual:downloadedBytes, expectedTotal:expectedCdnBytes});
    }
    sizeVerified = true;
  } else if (verificationMethod === 'stream-eof') {
    streamComplete = true;
  } else {
    throw new LinkexError(`未対応のダウンロード検証方式です: ${verificationMethod}`, {kind:'verify'});
  }

  const current = loadProbeState(state) || state;
  return saveProbeState({...current, state:'LOCAL_COMMITTED', download:{...(current.download||{}), destId, downloadedBytes:downloaded, expectedCdnBytes:expected, sizeVerified, verificationMethod, streamComplete, sourceMetaSize:Number(state.source?.size || 0), verifiedAt:Date.now(), localName}});
}

async function downloadOwnedFile({api, state, handle, onProgress = () => {}, onPhase = () => {}}) {
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
      let total;
      try {
        total = await probeCdnTotalSize(url);
      } catch (e) {
        // Range resumeの完成サイズをContent-Lengthで確認できない場合は、
        // 曖昧なlocal fileを完成扱いせず0 byteから安全に取り直す。
        if (offset > 0 && e?.kind === 'protocol') {
          const w = await handle.createWritable({keepExistingData:false});
          await w.truncate(0); await w.close();
          offset = 0;
          retried403 = false;
          continue;
        }
        throw e;
      }
      localFile = await handle.getFile();
      if (localFile.size === total) {
        const verifyStartedAt = Date.now();
        onPhase({phase:'download-end', at:verifyStartedAt});
        onPhase({phase:'verify-start', at:verifyStartedAt});
        const done = commitVerifiedDownload(state, {destId, downloadedBytes:localFile.size, expectedCdnBytes:total, localName:localFile.name});
        const verifyEndedAt = Date.now();
        onPhase({phase:'verify-end', at:verifyEndedAt});
        return {verified:true, resumed:true, totalBytes:total, localBytes:localFile.size, status:'ALREADY_COMPLETE', state:done, verificationMethod:'content-length', telemetry:{transferredBytes:0, durationMs:0, averageBytesPerSecond:0, averageMBps:0, peakBytesPerSecond:0, resumed:true, alreadyComplete:true}};
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
    const hasKnownLength = remaining !== null && Number.isFinite(remaining) && remaining >= 0;
    let resumed = offset > 0 && res.status === 206;
    let base = resumed ? offset : 0;

    // Rangeを要求したのに200ならサーバーが無視したとみなし、同じ200 bodyを0から保存。
    if (offset > 0 && res.status === 200) {
      base = 0;
      resumed = false;
      offset = 0;
    }

    // Content-LengthがCORS等で見えない正常応答では、HTTP streamが正常EOFまで
    // 到達したことを完全性証拠として扱う。metadata sizeはCDN実サイズと異なるため使わない。
    const expectedTotal = hasKnownLength ? base + remaining : null;
    const verificationMethod = hasKnownLength ? 'content-length' : 'stream-eof';
    const transferStartedAt = Date.now();
    const transferStartBytes = base;
    let lastRateAt = transferStartedAt;
    let lastRateBytes = base;
    let instantBytesPerSecond = 0;
    let peakBytesPerSecond = 0;
    const writable = await handle.createWritable({keepExistingData: resumed});
      if (resumed) await writable.seek(base);
      else await writable.truncate(0);

      const reader = res.body.getReader();
      let written = base;
      let received = base;
      let bufferedChunks = [];
      let bufferedBytes = 0;
      let nextCheckpoint = written + CHECKPOINT_BYTES;
      let lastCheckpointAt = transferStartedAt;
      let lastLeaseCheckAt = transferStartedAt;
      let lastUi = 0;

      async function flushBufferedWrite() {
        if (!bufferedBytes) return;
        const batchBytes = bufferedBytes;
        const batch = mergeWriteBufferChunks(bufferedChunks, batchBytes);
        await writable.write(batch);
        written += batchBytes;
        bufferedChunks = [];
        bufferedBytes = 0;
      }

      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          bufferedChunks.push(value);
          bufferedBytes += value.byteLength;
          received += value.byteLength;

          let now = Date.now();
          if (now - lastLeaseCheckAt >= 1000) {
            assertLease();
            lastLeaseCheckAt = now;
          }
          if (bufferedBytes >= WRITE_BUFFER_BYTES || now - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
            await flushBufferedWrite();
            now = Date.now();
          }

          const elapsedMs = Math.max(1, now - transferStartedAt);
          const transferredBytes = Math.max(0, received - transferStartBytes);
          const averageBytesPerSecond = transferredBytes * 1000 / elapsedMs;
          if (now - lastRateAt >= 250) {
            const deltaMs = Math.max(1, now - lastRateAt);
            instantBytesPerSecond = Math.max(0, received - lastRateBytes) * 1000 / deltaMs;
            peakBytesPerSecond = Math.max(peakBytesPerSecond, instantBytesPerSecond);
            lastRateAt = now;
            lastRateBytes = received;
          }
          if (written >= nextCheckpoint || now - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
            if (bufferedBytes) {
              await flushBufferedWrite();
              now = Date.now();
            }
            const current = loadProbeState(state) || state;
            saveProbeState({...current, state:'DOWNLOADING', download:{...(current.download||{}), destId, downloadedBytes:written, expectedCdnBytes:expectedTotal, telemetry:{transferStartedAt, transferStartBytes, transferredBytes, elapsedMs, averageBytesPerSecond, averageMBps:bytesPerSecondToMBps(averageBytesPerSecond), instantBytesPerSecond, peakBytesPerSecond, resumed}, updatedAt:now}});
            nextCheckpoint = written + CHECKPOINT_BYTES;
            lastCheckpointAt = now;
          }
          if (now - lastUi >= UI_UPDATE_INTERVAL_MS) {
            onProgress({written:received, expectedTotal, resumed, sourceMetaSize:Number(state.source?.size || 0), averageBytesPerSecond, instantBytesPerSecond, peakBytesPerSecond});
            lastUi = now;
          }
        }
        await flushBufferedWrite();
        await writable.close();
      } catch (e) {
        try { await reader.cancel(); } catch {}
        try { await writable.close(); } catch {}
        const partial = await handle.getFile();
        const current = loadProbeState(state) || state;
        const pausedAt = Date.now();
        const transferredBytes = Math.max(0, partial.size - transferStartBytes);
        const elapsedMs = Math.max(1, pausedAt - transferStartedAt);
        const averageBytesPerSecond = transferredBytes * 1000 / elapsedMs;
        saveProbeState({...current, state:'DOWNLOAD_PAUSED', download:{...(current.download||{}), destId, downloadedBytes:partial.size, expectedCdnBytes:expectedTotal, telemetry:{transferStartedAt, transferStartBytes, transferredBytes, durationMs:elapsedMs, elapsedMs, averageBytesPerSecond, averageMBps:bytesPerSecondToMBps(averageBytesPerSecond), instantBytesPerSecond, peakBytesPerSecond, resumed, interrupted:true}, lastError:String(e?.message || e), updatedAt:pausedAt}});
        throw e;
      }

      const transferEndedAt = Date.now();
      const transferDurationMs = Math.max(0, transferEndedAt - transferStartedAt);
      const transferredBytes = Math.max(0, written - transferStartBytes);
      const averageBytesPerSecond = transferDurationMs > 0 ? transferredBytes * 1000 / transferDurationMs : 0;
      peakBytesPerSecond = Math.max(peakBytesPerSecond, instantBytesPerSecond, averageBytesPerSecond);
      onPhase({phase:'download-end', at:transferEndedAt});
      const verifyStartedAt = Date.now();
      onPhase({phase:'verify-start', at:verifyStartedAt});
      const finalFile = await handle.getFile();
    const actual = finalFile.size;
    // writableへ渡したbyte数と最終ファイルサイズは、Content-Length有無に関係なく一致必須。
    if (actual !== written) {
      const current = loadProbeState(state) || state;
      saveProbeState({...current, state:'VERIFY_FAILED', download:{...(current.download||{}), destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, sizeVerified:false, verificationMethod, streamComplete:false, updatedAt:Date.now()}});
      throw new LinkexError(`ローカル書き込み検証失敗: file=${actual} / written=${written}`, {kind:'verify', actual, written});
    }
    if (hasKnownLength && actual !== expectedTotal) {
      const current = loadProbeState(state) || state;
      saveProbeState({...current, state:'VERIFY_FAILED', download:{...(current.download||{}), destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, sizeVerified:false, verificationMethod, streamComplete:false, updatedAt:Date.now()}});
      throw new LinkexError(`サイズ検証失敗: local=${actual} / CDN=${expectedTotal}`, {kind:'verify', actual, expectedTotal});
    }

    const telemetry = {transferStartedAt, transferEndedAt, transferStartBytes, transferredBytes, durationMs:transferDurationMs, averageBytesPerSecond, averageMBps:bytesPerSecondToMBps(averageBytesPerSecond), instantBytesPerSecond, peakBytesPerSecond, resumed};
    const currentBeforeCommit = loadProbeState(state) || state;
    saveProbeState({...currentBeforeCommit, download:{...(currentBeforeCommit.download||{}), telemetry}});
    const done = commitVerifiedDownload(state, {destId, downloadedBytes:actual, expectedCdnBytes:expectedTotal, localName:finalFile.name, verificationMethod});
    onPhase({phase:'verify-end', at:Date.now()});
    return {verified:true, resumed, totalBytes:expectedTotal ?? actual, localBytes:actual, finalFile, state:done, verificationMethod, metadataSize:Number(state.source?.size || 0), telemetry};
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
  const expectedRaw = state.download?.expectedCdnBytes;
  const expected = expectedRaw == null ? null : Number(expectedRaw);
  const explicitSizeVerified = state.download?.sizeVerified === true;
  // v1.0.0で既にLOCAL_COMMITTEDになった正サイズ(>0) Queueは互換維持する。
  // 0 byteは新実装の明示的sizeVerifiedがある場合だけ許可する。
  const legacySizeVerified = state.download?.sizeVerified == null && downloaded > 0 && expected > 0 && downloaded === expected;
  const sizeEvidenceValid = (explicitSizeVerified || legacySizeVerified) && Number.isFinite(downloaded) && Number.isFinite(expected) && downloaded >= 0 && expected >= 0 && downloaded === expected;
  const streamEofVerified = state.download?.verificationMethod === 'stream-eof' && state.download?.streamComplete === true && Number.isFinite(downloaded) && downloaded >= 0;
  if (!(sizeEvidenceValid || streamEofVerified)) {
    throw new LinkexError(`削除拒否: ローカルダウンロードの完全性が確定していません (${downloaded}/${expected ?? 'EOF'})。`, {kind:'delete_guard'});
  }
  if (!Number(state.download?.verifiedAt || 0)) {
    throw new LinkexError('削除拒否: verifiedAt がありません。', {kind:'delete_guard'});
  }
  return streamEofVerified ? {destId, downloaded, expected:null, verificationMethod:'stream-eof'} : {destId, downloaded, expected};
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
  const PIPELINE_DOWNLOAD_WORKERS = 2;
  const PIPELINE_DELETE_WORKERS = 1;
  const PIPELINE_MAX_IN_FLIGHT = 3;
  let queueCommitTail = Promise.resolve();

  function commitQueueJob(job, mutate = null) {
    const run = queueCommitTail.then(() => {
      if (mutate) mutate();
      saveQueueJob(job);
      return job;
    });
    queueCommitTail = run.catch(() => {});
    return run;
  }

  function createAsyncSemaphore(limit) {
    const max = Math.max(1, Number(limit || 1));
    let available = max;
    const waiters = [];
    const makeRelease = () => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = waiters.shift();
        if (next) next(makeRelease());
        else available = Math.min(max, available + 1);
      };
    };
    return {
      acquire() {
        if (available > 0) {
          available -= 1;
          return Promise.resolve(makeRelease());
        }
        return new Promise(resolve => waiters.push(resolve));
      }
    };
  }

  async function createCapacityReservation(api) {
    const initial = await api.getUsage();
    const initialTotal = Number(initial.total_space || 0);
    const initialUsed = Number(initial.used_space || 0);
    let availableBytes = initialTotal > 0 ? Math.max(0, initialTotal - initialUsed) : Number.POSITIVE_INFINITY;

    return {
      async reserve(bytes) {
        const needed = Math.max(0, Number(bytes || 0));
        const usage = await api.getUsage();
        const total = Number(usage.total_space || initialTotal || 0);
        const used = Number(usage.used_space || 0);
        if (total > 0 && needed > total) {
          throw new LinkexError(`単一ファイルがLinkex総容量を超えます: ${formatBytes(needed)} > ${formatBytes(total)}`, {kind:'unfittable'});
        }
        const reportedFree = total > 0 ? Math.max(0, total - used) : availableBytes;
        const effectiveFree = Math.min(availableBytes, reportedFree);
        if (needed > effectiveFree) {
          throw new LinkexError(`Linkex空き容量不足: 必要 ${formatBytes(needed)} / 予約可能 ${formatBytes(effectiveFree)}`, {kind:'capacity'});
        }
        availableBytes -= needed;
        return {bytes:needed, released:false};
      },
      release(reservationOrBytes) {
        const token = reservationOrBytes && typeof reservationOrBytes === 'object' ? reservationOrBytes : null;
        if (token?.released) return;
        const bytes = Math.max(0, Number(token ? token.bytes : reservationOrBytes || 0));
        if (token) token.released = true;
        availableBytes = initialTotal > 0
          ? Math.min(initialTotal, availableBytes + bytes)
          : availableBytes + bytes;
      },
      snapshot() {
        return {totalBytes:initialTotal, availableBytes};
      }
    };
  }

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

  function createQueueFromManifest(manifest, selectedIndexes = null) {
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
    const current = job.items[index]?.tx;
    const tx = loadProbeState(current);
    if (tx && tx.operationId === current?.operationId) {
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
    expectedCdnBytes:tx.download.expectedCdnBytes == null ? null : Number(tx.download.expectedCdnBytes),
    sizeVerified:tx.download.sizeVerified ?? null,
    verificationMethod:tx.download.verificationMethod ?? (tx.download.sizeVerified === true ? 'content-length' : null),
    streamComplete:tx.download.streamComplete === true,
    sourceMetaSize:Number(tx.download.sourceMetaSize ?? tx.source?.size ?? 0),
    verifiedAt:tx.download.verifiedAt ?? null,
    localName:tx.download.localName ?? null,
    telemetry:tx.download.telemetry ? {...tx.download.telemetry} : null
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
      queueIndex:tx.queueIndex ?? null,
      performance:tx.performance ? {...tx.performance} : null
    };
  }

  function compactCompletedItem(job, item) {
    if (!item?.tx || item.tx.state !== 'DONE') return false;
    item.tx = compactDoneTx(item.tx);
    item.state = 'DONE';
    item.lastError = null;
    const probe = loadProbeState(item.tx);
    if (probe?.operationId === item.tx.operationId) saveProbeState(item.tx);
    return true;
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

  async function ensureCopyOwned(api, job, index, onStatus, {capacityReserved = false} = {}) {
    assertLease();
    const item = job.items[index];
    let tx = item.tx;

    if (!tx) {
      if (!capacityReserved) {
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
      }

      assertLease();
      const beforeRoot = await listAllRoot(api);
      const transactionStartedAt = Date.now();
      tx = {
        schemaVersion:1,
        operationId:makeId('queue-op'),
        state:'COPY_INTENT',
        shareToken:job.shareToken,
        source:item.source,
        beforeIds:beforeRoot.map(x => String(x.id)),
        startedAt:transactionStartedAt,
        performance:{schemaVersion:PERFORMANCE_SCHEMA_VERSION, total:{startedAt:transactionStartedAt}},
        queueJobId:job.jobId,
        queueIndex:index
      };
      persistItemTx(job, index, tx, 'COPYING');
      onStatus?.(`COPY_INTENT [${index+1}/${job.items.length}]\n${item.source.remotePath}\ncopy POSTを1回だけ送信します…`);

      let copyResult;
      tx = perfPhaseStart(tx, 'copy');
      persistItemTx(job, index, tx, 'COPYING');
      try {
        assertLease();
        copyResult = await api.copySharedFile({shareToken:job.shareToken, sourceId:item.source.sourceId});
        tx = {...tx, state:'COPY_REQUEST_SENT', copyResponse:copyResult ?? {}, requestCompletedAt:Date.now()};
        persistItemTx(job, index, tx, 'COPYING');
        await waitTaskIfPresent(api, copyResult, s => onStatus?.(`COPY task: ${s}\n${item.source.remotePath}`));
        tx = perfPhaseEnd(tx, 'copy', Date.now(), {outcome:'request-complete'});
        persistItemTx(job, index, tx, 'COPYING');
      } catch (e) {
        tx = perfPhaseEnd(tx, 'copy', Date.now(), {outcome:e?.kind === 'copy_task' ? 'task-failed' : 'request-uncertain'});
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
      tx = perfPhaseStart(tx, 'ownershipReconcile');
      persistItemTx(job, index, tx, 'COPYING');
      const rec = await reconcileCopy(api, tx, {timeoutMs:90000, onProgress:x => onStatus?.(`コピー照合中 [${index+1}/${job.items.length}]…\n${item.source.remotePath}\n差分: ${x.diff?.length ?? 0}\n候補: ${x.plausible?.length ?? 0}`)});
      tx = perfPhaseEnd(tx, 'ownershipReconcile', Date.now(), {outcome:rec.status});
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
    tx = perfPhaseStart(tx, 'download');
    persistItemTx(job, index, tx, 'DOWNLOADING');

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      assertLease();
      item.attempts.download = (item.attempts.download || 0) + 1;
      saveQueueJob(job);
      try {
        onStatus?.(`DOWNLOADING [${index+1}/${job.items.length}]\n${item.source.remotePath}\n再開可能 / attempt ${attempt}`);
        let downloadEndedAt = null;
        let verifyStartedAt = null;
        let verifyEndedAt = null;
        const result = await downloadOwnedFile({api, state:tx, handle, onProgress:x => {
          const pct = x.expectedTotal ? Math.min(100, x.written / x.expectedTotal * 100) : null;
          const rateText = x.averageBytesPerSecond > 0 ? `\n平均 ${formatTransferRate(x.averageBytesPerSecond)} / 瞬間 ${formatTransferRate(x.instantBytesPerSecond)}` : '';
          onStatus?.(`DOWNLOADING [${index+1}/${job.items.length}]\n${item.source.remotePath}\n${formatBytes(x.written)}${x.expectedTotal ? ` / ${formatBytes(x.expectedTotal)}` : ''}${pct == null ? '' : ` (${pct.toFixed(1)}%)`}${rateText}\n${x.resumed ? 'Range resume' : 'full/restart'}`);
        }, onPhase:x => {
          if (x?.phase === 'download-end') downloadEndedAt = Number(x.at || Date.now());
          if (x?.phase === 'verify-start') verifyStartedAt = Number(x.at || Date.now());
          if (x?.phase === 'verify-end') verifyEndedAt = Number(x.at || Date.now());
        }});
        tx = syncTxFromProbe(job, index);
        if (tx.state !== 'LOCAL_COMMITTED') throw new LinkexError(`DL後stateがLOCAL_COMMITTEDではありません: ${tx.state}`, {kind:'state'});
        const t = result?.telemetry || tx.download?.telemetry || {};
        tx = perfPhaseEnd(tx, 'download', downloadEndedAt || Date.now(), {
          transferredBytes:Number(t.transferredBytes || 0),
          transferDurationMs:Number(t.durationMs || 0),
          averageBytesPerSecond:Number(t.averageBytesPerSecond || 0),
          averageMBps:Number(t.averageMBps || 0),
          peakBytesPerSecond:Number(t.peakBytesPerSecond || 0),
          resumed:!!result?.resumed,
          attempts:Number(item.attempts.download || 0)
        });
        if (verifyStartedAt) {
          const end = verifyEndedAt || Date.now();
          tx = perfPhaseSet(tx, 'verify', {startedAt:verifyStartedAt, endedAt:end, durationMs:Math.max(0, end - verifyStartedAt), verificationMethod:result?.verificationMethod || tx.download?.verificationMethod || null});
        }
        tx = {...tx, download:{...(tx.download||{}), telemetry:t}};
        persistItemTx(job, index, tx, 'LOCAL_COMMITTED');
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
    tx = perfPhaseStart(tx, 'delete');
    persistItemTx(job, index, tx, item.state);

    // 応答不明の削除は絶対に再送しない。存在/不在だけ照合する。
    if (['DELETE_INTENT','DELETE_REQUEST_SENT','DELETE_UNCERTAIN','DELETE_UNCERTAIN_PRESENT'].includes(tx.state)) {
      onStatus?.(`DELETE結果照合 [${index+1}/${job.items.length}]\n${item.source.remotePath}\ndelete POST再送: NO`);
      const rec = await reconcileDelete(api, tx, {timeoutMs:30000, onProgress:x => onStatus?.(`DELETE照合 [${index+1}/${job.items.length}]\n存在: ${x.exists ? 'YES' : 'NO'}\n再送: NO`)});
      if (rec.status === 'ABSENT') {
        tx = {...tx, state:'DONE', delete:{...(tx.delete||{}), destId:tx.delete?.destId || tx.confirmedDest?.id, confirmedAbsentAt:Date.now()}};
        tx = perfPhaseEnd(tx, 'delete', Date.now(), {outcome:'confirmed-absent'});
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
      tx = perfPhaseEnd(tx, 'delete', Date.now(), {outcome:'already-absent'});
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
    const creds = resolveCredentials();
    if (!creds) throw new LinkexError(credentialBootstrapMessage(), {kind:'auth'});
    const api = new LinkexApi({token:creds.token});
    const downloadSlots = createAsyncSemaphore(PIPELINE_DOWNLOAD_WORKERS);
    const deleteSlots = createAsyncSemaphore(PIPELINE_DELETE_WORKERS);
    const inFlightSlots = createAsyncSemaphore(PIPELINE_MAX_IN_FLIGHT);
    const capacity = await createCapacityReservation(api);
    const tasks = new Set();
    let fatalError = null;
    let fatalIndex = null;
    let pauseRequested = false;

    job.state = 'RUNNING';
    job.lastError = null;
    job.pipeline = {
      schemaVersion:1,
      copyWorkers:1,
      downloadWorkers:PIPELINE_DOWNLOAD_WORKERS,
      deleteWorkers:PIPELINE_DELETE_WORKERS,
      maxInFlight:PIPELINE_MAX_IN_FLIGHT,
      startedAt:Date.now()
    };
    saveQueueJob(job);

    const markFatal = async (index, error) => {
      const kind = error?.kind || null;
      if (!fatalError) {
        fatalError = error;
        fatalIndex = index;
      }
      await commitQueueJob(job, () => {
        const item = job.items[index];
        item.lastError = {message:error?.message || String(error), kind, at:Date.now()};
        item.state = item.state === 'DONE' ? 'DONE' : 'BLOCKED';
        job.state = 'PAUSED';
        job.lastError = {message:error?.message || String(error), kind, index, at:Date.now()};
      });
    };

    const markSkippable = async (index, error) => {
      const kind = error?.kind || null;
      await commitQueueJob(job, () => {
        const item = job.items[index];
        item.lastError = {message:error?.message || String(error), kind, at:Date.now()};
        item.state = kind === 'unfittable' ? 'UNFITTABLE' : 'SKIPPED_CAPACITY';
      });
      const item = job.items[index];
      onStatus?.(`${kind === 'unfittable' ? '単一ファイル上限' : '容量不足'}でスキップ [${index+1}/${job.items.length}]\n${item.source.remotePath}\n次のファイルへ進みます。`);
    };

    const launchOwnedTransaction = (index, releaseInFlight, reservation) => {
      const item = job.items[index];
      const task = (async () => {
        try {
          const releaseDownload = await downloadSlots.acquire();
          try {
            assertLease();
            await ensureDownloaded(api, job, index, queueRoot, onStatus);
          } finally {
            releaseDownload();
          }

          const releaseDelete = await deleteSlots.acquire();
          try {
            assertLease();
            await ensureDeleted(api, job, index, onStatus);
          } finally {
            releaseDelete();
          }

          await commitQueueJob(job, () => {
            item.tx = perfPhaseEnd(item.tx, 'total', Date.now(), {outcome:'done'});
            item.state = 'DONE';
            compactCompletedItem(job, item);
          });
          capacity.release(reservation || Number(item.source?.size || 0));
          onStatus?.(`完了 [${index+1}/${job.items.length}]\n${item.source.remotePath}\nLinkex一時コピー削除確認済み`);
        } catch (e) {
          await markFatal(index, e);
        } finally {
          releaseInFlight();
        }
      })();
      tasks.add(task);
      task.finally(() => tasks.delete(task));
      return task;
    };

    for (let i = 0; i < job.items.length; i++) {
      assertLease();
      if (fatalError) break;
      if (job.stopRequested) {
        pauseRequested = true;
        break;
      }

      await commitQueueJob(job, () => { job.currentIndex = i; });
      const item = job.items[i];
      if (item.state === 'DONE' || item.tx?.state === 'DONE') {
        compactCompletedItem(job, item);
        saveQueueJob(job);
        continue;
      }
      if (['SKIPPED_CAPACITY','UNFITTABLE'].includes(item.state)) continue;

      let releaseInFlight = await inFlightSlots.acquire();
      if (fatalError || job.stopRequested) {
        releaseInFlight();
        if (job.stopRequested) pauseRequested = true;
        break;
      }

      let reservation = null;
      try {
        if (!item.tx) {
          while (true) {
            try {
              reservation = await capacity.reserve(item.source?.size || 0);
              break;
            } catch (e) {
              if (e?.kind === 'capacity' && tasks.size > 0) {
                releaseInFlight();
                await Promise.race(Array.from(tasks));
                if (fatalError || job.stopRequested) {
                  if (job.stopRequested) pauseRequested = true;
                  releaseInFlight = null;
                  break;
                }
                releaseInFlight = await inFlightSlots.acquire();
                continue;
              }
              throw e;
            }
          }
          if (!releaseInFlight) break;
        }

        // reserve() performs a fresh usage request. A pause or fatal worker
        // failure may arrive while that request is in flight. Since COPY has
        // not started yet, release the reservation and do not begin new work.
        if (fatalError || job.stopRequested) {
          if (reservation) capacity.release(reservation);
          releaseInFlight();
          if (job.stopRequested) pauseRequested = true;
          break;
        }

        await ensureCopyOwned(api, job, i, onStatus, {capacityReserved:!!reservation});
      } catch (e) {
        const kind = e?.kind || null;
        if (kind === 'capacity' || kind === 'unfittable') {
          if (reservation) capacity.release(reservation);
          releaseInFlight();
          await markSkippable(i, e);
          continue;
        }
        releaseInFlight();
        await markFatal(i, e);
        break;
      }

      // A different worker may have failed while this serial COPY was reconciling.
      // On fatal failure, keep this proven destId persisted for a safe resume.
      if (fatalError) {
        releaseInFlight();
        break;
      }

      // If the user requested pause while COPY was already running, finish this
      // now-owned transaction through VERIFY/DELETE, then stop starting new COPYs.
      launchOwnedTransaction(i, releaseInFlight, reservation);
      if (job.stopRequested) {
        pauseRequested = true;
        break;
      }
    }

    await Promise.all(Array.from(tasks));

    if (fatalError) {
      if (fatalIndex != null) job.currentIndex = fatalIndex;
      saveQueueJob(job);
      throw fatalError;
    }

    if (job.stopRequested || pauseRequested) {
      job.stopRequested = false;
      job.state = 'PAUSED_USER';
      saveQueueJob(job);
      return job;
    }

    const c = queueCounts(job);
    job.state = (c.skippedCapacity || c.unfittable || c.blocked) ? 'DONE_WITH_SKIPS' : 'DONE';
    job.completedAt = Date.now();
    if (job.pipeline) job.pipeline.completedAt = job.completedAt;
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
    for (const item of job.items || []) {
      if (item?.tx?.operationId) clearProbeState(item.tx);
    }
    const legacyProbe = loadProbeState();
    GM_setValue(QUEUE_KEY, null);
    if (!legacyProbe || legacyProbe.queueJobId === job.jobId) GM_setValue(PROBE_KEY, null);
    return {cleared:true, handleCleanupError};
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
      performance: redactForExport(buildPerformanceSummary(queue)),
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
        #linkex-full-queue { position:fixed; right:12px; bottom:12px; width:min(540px, calc(100vw - 24px)); max-width:calc(100vw - 24px); z-index:2147483647; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; color:#eef2ff; }
        #linkex-full-queue .box { background:#111827; border:1px solid #374151; border-radius:14px; box-shadow:0 18px 45px rgba(0,0,0,.4); overflow:hidden; max-height:calc(100vh - 24px); max-height:calc(100dvh - 24px); display:flex; flex-direction:column; }
        #linkex-full-queue .hd { padding:11px 12px 11px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; background:#0b1220; border-bottom:1px solid #374151; flex:0 0 auto; }
        #linkex-full-queue .hd-left { display:flex; align-items:center; gap:8px; min-width:0; }
        #linkex-full-queue .title { font-weight:750; font-size:14px; white-space:nowrap; }
        #linkex-full-queue .badge { font-size:10px; padding:3px 7px; border-radius:999px; background:#14532d; color:#bbf7d0; white-space:nowrap; }
        #linkex-full-queue .mini { flex:0 0 auto; width:auto; padding:5px 9px; font-size:12px; background:#374151; color:#fff; }
        #linkex-full-queue .body { padding:12px; overflow-y:auto; overscroll-behavior:contain; min-height:0; scrollbar-gutter:stable; }
        #linkex-full-queue.collapsed .body { display:none; }
        #linkex-full-queue input { width:100%; box-sizing:border-box; background:#0b1220; border:1px solid #4b5563; color:#fff; border-radius:8px; padding:9px 10px; margin-bottom:8px; }
        #linkex-full-queue .row { display:flex; gap:8px; margin-bottom:8px; }
        #linkex-full-queue button { flex:1; border:0; border-radius:8px; padding:9px 10px; cursor:pointer; font-weight:700; }
        #linkex-full-queue button:disabled { opacity:.4; cursor:not-allowed; }
        #linkex-full-queue .primary { background:#2563eb; color:#fff; }
        #linkex-full-queue .warn { background:#d97706; color:#fff; }
        #linkex-full-queue .secondary { background:#374151; color:#fff; }
        #linkex-full-queue .primary-actions { display:grid; grid-template-columns:1fr; gap:7px; margin-bottom:9px; }
        #linkex-full-queue .action-main { padding:12px 12px; font-size:14px; }
        #linkex-full-queue .action-secondary { padding:8px 10px; font-size:12px; }
        #linkex-full-queue details.more { margin-top:9px; border-top:1px solid #374151; padding-top:7px; }
        #linkex-full-queue details.more > summary { cursor:pointer; color:#cbd5e1; font-size:12px; font-weight:700; user-select:none; padding:4px 1px 7px; }
        #linkex-full-queue details.more .more-body { padding-top:2px; }
        #linkex-full-queue [hidden] { display:none !important; }
        #linkex-full-queue .progress-wrap { margin:2px 0 9px; }
        #linkex-full-queue .progress-meta { display:flex; justify-content:space-between; gap:8px; font-size:11px; color:#cbd5e1; margin-bottom:4px; }
        #linkex-full-queue .progress { height:7px; border-radius:999px; background:#1f2937; overflow:hidden; border:1px solid #374151; }
        #linkex-full-queue .progress > i { display:block; height:100%; width:0%; background:#2563eb; transition:width .2s ease; }
        #linkex-full-queue .state-line { font-size:11px; color:#cbd5e1; margin:-2px 0 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        #linkex-full-queue .state-line.ok { color:#bbf7d0; }
        #linkex-full-queue .state-line.err { color:#fecaca; }
        #linkex-full-queue details.log { margin-top:8px; }
        #linkex-full-queue details.log > summary { cursor:pointer; color:#9ca3af; font-size:11px; font-weight:700; user-select:none; padding:4px 1px; }
        #linkex-full-queue .status { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; background:#0b1220; border:1px solid #374151; border-radius:8px; padding:10px; margin-top:6px; max-height:350px; overflow:auto; }
        #linkex-full-queue .ok { border-color:#166534; color:#bbf7d0; }
        #linkex-full-queue .err { border-color:#991b1b; color:#fecaca; }
        #linkex-full-queue .notice { font-size:11px; color:#9ca3af; margin-top:8px; line-height:1.45; }
        #linkex-full-queue .share-context { margin:0 0 8px; padding:8px 10px; border:1px solid #1d4ed8; border-radius:8px; background:#0b1b38; color:#bfdbfe; font-size:11px; line-height:1.45; overflow-wrap:anywhere; }
        #linkex-full-queue .share-context[hidden] { display:none; }
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
      </style>
      <div class="box">
        <div class="hd">
          <div class="hd-left"><div class="title">Linkex Downloader v${VERSION}</div><div class="badge">SAFE QUEUE</div></div>
          <button id="lf-collapse" class="mini" title="最小化/展開">−</button>
        </div>
        <div class="body">
          <div id="lf-share-context" class="share-context" hidden></div>
          <input id="lf-url" placeholder="https://l2e.click/d/xxxxxxxx" />
          <div class="primary-actions">
            <button id="lf-start" class="primary action-main" disabled>すべてダウンロード</button>
            <button id="lf-select-mode" class="secondary action-secondary" disabled>ファイルを選ぶ</button>
          </div>
          <div id="lf-selection" class="selection" hidden>
            <div id="lf-selection-meta" class="selection-meta">0 / 0 selected</div>
            <input id="lf-file-filter" placeholder="ファイル名 / パスで絞り込み" />
            <div class="selection-actions"><button id="lf-select-all" class="secondary">全件選択</button><button id="lf-clear-all" class="secondary">全解除</button><button id="lf-select-visible" class="secondary">表示中を選択</button><button id="lf-clear-visible" class="secondary">表示中を解除</button></div>
            <div id="lf-file-list" class="file-list"></div>
            <div id="lf-selection-note" class="notice"></div>
            <div class="row" style="margin-top:8px;margin-bottom:0"><button id="lf-start-selected" class="primary" disabled>選択をダウンロード</button></div>
          </div>
          <div id="lf-queue-actions" class="row" hidden><button id="lf-resume" class="primary" disabled>Queueを再開</button><button id="lf-pause" class="secondary" disabled>現在ファイル後に停止</button></div>
          <div class="progress-wrap">
            <div class="progress-meta"><span id="lf-progress-text">Queueなし</span><span id="lf-progress-pct">0%</span></div>
            <div class="progress"><i id="lf-progress-bar"></i></div>
          </div>
          <div id="lf-state-line" class="state-line">待機中</div>
          <details id="lf-more" class="more">
            <summary>詳細</summary>
            <div class="more-body">
              <div class="row"><button id="lf-destination" class="secondary">保存先を変更</button><button id="lf-analyze" class="secondary">共有を再解析</button></div>
              <div class="row"><button id="lf-selftest" class="secondary">署名テスト</button><button id="lf-export" class="secondary">診断ログを保存</button></div>
              <div class="row"><button id="lf-refresh" class="secondary">状態を再表示</button><button id="lf-retry" class="secondary" disabled>容量スキップを再試行</button></div>
              <div class="row" style="margin-bottom:0"><button id="lf-abandon" class="secondary" disabled>Queueを安全に破棄</button></div>
              <details id="lf-log-details" class="log">
                <summary>ログを表示</summary>
                <div id="lf-status" class="status">共有ページでは「すべてダウンロード」だけで解析からQueue開始まで進めます。\n安全処理は1ファイルずつ COPY → DL → VERIFY → 所有destIdだけDELETE します。</div>
              </details>
            </div>
          </details>
          <div class="notice">安全規則: copy/delete応答不明時は盲目的に再送しません。削除はLOCAL_COMMITTEDかつ所有権確定済みdestId 1件だけ。実行中は別端末からLinkexを変更しないでください。診断ログはtoken・署名付きURLを伏せて書き出します。</div>
        </div>
      </div>`;
    document.body.appendChild(root);

    const input = root.querySelector('#lf-url');
    const shareContextEl = root.querySelector('#lf-share-context');
    const status = root.querySelector('#lf-status');
    const stateLine = root.querySelector('#lf-state-line');
    const moreDetails = root.querySelector('#lf-more');
    const logDetails = root.querySelector('#lf-log-details');
    const analyzeBtn = root.querySelector('#lf-analyze');
    const startBtn = root.querySelector('#lf-start');
    const selectModeBtn = root.querySelector('#lf-select-mode');
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
    const pauseBtn = root.querySelector('#lf-pause');
    const retryBtn = root.querySelector('#lf-retry');
    const abandonBtn = root.querySelector('#lf-abandon');
    const destinationBtn = root.querySelector('#lf-destination');
    const queueActions = root.querySelector('#lf-queue-actions');
    const exportBtn = root.querySelector('#lf-export');
    const refreshBtn = root.querySelector('#lf-refresh');
    const collapseBtn = root.querySelector('#lf-collapse');
    const progressText = root.querySelector('#lf-progress-text');
    const progressPct = root.querySelector('#lf-progress-pct');
    const progressBar = root.querySelector('#lf-progress-bar');

    let lastUiEventText = '';
    let lastUiEventAt = 0;
    const write = (text, cls='') => {
      const message = String(text ?? '');
      status.className = `status ${cls}`;
      status.textContent = message;
      const firstLine = message.split('\n').find(line => line.trim())?.trim() || '待機中';
      stateLine.textContent = firstLine.length > 110 ? `${firstLine.slice(0, 107)}…` : firstLine;
      stateLine.title = firstLine;
      stateLine.className = `state-line ${cls}`;
      if (cls === 'err') {
        moreDetails.open = true;
        logDetails.open = true;
      }
      const now = Date.now();
      // Download progress can update frequently; avoid flooding persistent diagnostics.
      const isProgress = /^DOWNLOADING\b/.test(message);
      if (message !== lastUiEventText && (!isProgress || now - lastUiEventAt >= 5000)) {
        recordEvent(cls === 'err' ? 'error' : 'info', 'ui', message);
        lastUiEventText = message;
        lastUiEventAt = now;
      }
      refreshProgress();
    };

    let manifest = null;
    let running = false;
    let activeRunJob = null;
    let selectedIndexes = new Set();
    let selectionExpanded = false;
    let preparing = false;
    let pageShareTarget = null;
    let preferredBaseDirHandle = null;
    let preferredDirPermission = 'unknown';
    let preferredHandleReady = false;
    input.value = GM_getValue(LAST_URL_KEY, '') || '';

    const prefs = loadUiPrefs();
    if (prefs.collapsed) root.classList.add('collapsed');
    collapseBtn.textContent = prefs.collapsed ? '+' : '−';

    function isTerminal(job) { return job && ['DONE','DONE_WITH_SKIPS'].includes(job.state); }

    function preferredDirectoryLabel() {
      if (!preferredHandleReady) return '読み込み中…';
      if (!preferredBaseDirHandle) return '未設定（初回に選択）';
      const suffix = preferredDirPermission === 'granted' ? '' : '（再許可が必要）';
      return `${preferredBaseDirHandle.name || '選択済みフォルダ'}${suffix}`;
    }

    async function refreshPreferredDirectoryState({reloadHandle = false} = {}) {
      try {
        if (reloadHandle || !preferredHandleReady) preferredBaseDirHandle = await idbGetHandle(PREFERRED_DIR_HANDLE_KEY);
        if (!preferredBaseDirHandle) preferredDirPermission = 'missing';
        else if (preferredBaseDirHandle.queryPermission) preferredDirPermission = await preferredBaseDirHandle.queryPermission({mode:'readwrite'});
        else preferredDirPermission = 'prompt';
      } catch (e) {
        console.warn('[Linkex preferred directory]', e);
        preferredBaseDirHandle = null;
        preferredDirPermission = 'missing';
      } finally {
        preferredHandleReady = true;
        syncSharePageContext({initial:true});
        refreshQueueUi();
      }
    }

    async function rememberPreferredDirectory(handle) {
      await idbPutHandle(PREFERRED_DIR_HANDLE_KEY, handle);
      preferredBaseDirHandle = handle;
      preferredDirPermission = 'granted';
      preferredHandleReady = true;
      syncSharePageContext({initial:true});
      refreshQueueUi();
      return handle;
    }

    async function acquirePreferredBaseDirFromGesture({forcePicker = false} = {}) {
      // showDirectoryPicker / requestPermission はuser gestureが必要。
      // この関数のpicker分岐より前にnetwork/IDB awaitを置かないこと。
      if (forcePicker || !preferredBaseDirHandle || preferredDirPermission === 'denied' || preferredDirPermission === 'missing') {
        const picked = await invokeDirectoryPicker({mode:'readwrite'});
        await ensureHandlePermission(picked);
        return await rememberPreferredDirectory(picked);
      }
      if (preferredDirPermission === 'granted') return preferredBaseDirHandle;
      if (preferredBaseDirHandle.requestPermission) {
        const permission = await preferredBaseDirHandle.requestPermission({mode:'readwrite'});
        preferredDirPermission = permission;
        if (permission === 'granted') {
          syncSharePageContext({initial:true});
          refreshQueueUi();
          return preferredBaseDirHandle;
        }
      }
      throw new LinkexError('保存先フォルダへの書き込み権限がありません。「詳細」→「保存先を変更」から選び直してください。', {kind:'filesystem'});
    }

    function shortShareToken(token) {
      const value = String(token || '');
      return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-4)}`;
    }

    function syncSharePageContext({initial = false} = {}) {
      const next = detectSharePageTarget(globalThis.location?.href || '');
      const previousToken = pageShareTarget?.shareToken || null;
      const nextToken = next?.shareToken || null;
      const changed = previousToken !== nextToken;
      const onShareHost = isSharePageHost(globalThis.location?.href || '');
      pageShareTarget = next;

      if (next) {
        input.value = next.href;
        input.hidden = true;
        shareContextEl.hidden = false;
        const authReady = !!readCredentialBridge();
        shareContextEl.textContent = `このページの共有: ${shortShareToken(next.shareToken)} · 認証: ${authReady ? '準備済み' : '未準備'} · 保存先: ${preferredDirectoryLabel()}`;
        analyzeBtn.textContent = 'この共有を再解析';
      } else {
        input.hidden = false;
        shareContextEl.hidden = true;
        shareContextEl.textContent = '';
        analyzeBtn.textContent = '共有URLを解析';
      }

      if (onShareHost && !running && !preparing && manifest && manifest.shareToken !== nextToken) {
        manifest = null;
        selectedIndexes.clear();
        selectionExpanded = false;
        fileFilter.value = '';
        renderSelection();
        if (!initial) write('共有ページが変わりました。現在の共有を解析してください。');
      } else if (changed && running) {
        recordEvent('warn', 'share-page-change-during-run', 'Queue実行中に共有ページURLが変わりました。実行中Queueは作成時のshareTokenを維持します。', {jobId:activeRunJob?.jobId || null});
      }
      refreshQueueUi();
      return next;
    }

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
      selectionPanel.hidden = !hasManifest || !selectionExpanded;
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

    input.addEventListener('input', refreshQueueUi);
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
      const busy = running || preparing;
      const hasShareInput = !!detectSharePageTarget(globalThis.location?.href || '') || !!String(input.value || '').trim();
      resumeBtn.disabled = busy || !active;
      resumeBtn.hidden = running || !active;
      pauseBtn.disabled = !running || !activeRunJob || !!activeRunJob.stopRequested;
      pauseBtn.hidden = !running;
      queueActions.hidden = resumeBtn.hidden && pauseBtn.hidden;
      startBtn.disabled = busy || !!active || !hasShareInput || !preferredHandleReady;
      selectModeBtn.disabled = busy || !!active || !hasShareInput;
      selectedStartBtn.disabled = busy || !manifest?.files?.length || selectedIndexes.size === 0 || !!active || !preferredHandleReady;
      const c = queueCounts(job);
      retryBtn.disabled = busy || !job || !(c.skippedCapacity || c.unfittable) || !isTerminal(job);
      abandonBtn.disabled = busy || !active;
      analyzeBtn.disabled = busy || !hasShareInput;
      destinationBtn.disabled = busy;
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

    async function analyzeCurrentShare({announceSuccess = true} = {}) {
      const pageTargetAtStart = detectSharePageTarget(globalThis.location?.href || '');
      const sourceInput = pageTargetAtStart?.href || input.value;
      const token = pageTargetAtStart?.shareToken || parseShareToken(sourceInput);
      GM_setValue(LAST_URL_KEY, String(sourceInput || '').trim());
      const api = new LinkexApi({token:null});
      write('共有manifestを読み取り中…');
      const nextManifest = await buildManifest(api, token, x => write(`共有manifestを読み取り中…\nfiles: ${x.files}\n${x.path || ''}`));
      if (pageTargetAtStart) {
        const currentTarget = detectSharePageTarget(globalThis.location?.href || '');
        if (currentTarget?.shareToken !== token) throw new LinkexError('解析中に共有ページが変わりました。現在の共有をもう一度解析してください。', {kind:'share_context_changed'});
      }
      manifest = nextManifest;
      selectedIndexes = new Set(manifest.files.map((_, i) => i));
      fileFilter.value = '';
      renderSelection();
      const largest = [...manifest.files].sort((a,b)=>Number(b.size||0)-Number(a.size||0))[0];
      if (announceSuccess) {
        write([
          '解析成功（読み取りのみ）',
          `共有名: ${manifest.shareName || '(unknown)'}`,
          `全ファイル: ${manifest.files.length}`,
          `全フォルダ: ${manifest.folders.length}`,
          `合計: ${formatBytes(manifest.totalBytes)}`,
          largest ? `最大ファイル: ${formatBytes(largest.size)}  ${largest.remotePath}` : '',
          '',
          '全件なら「すべてダウンロード」、必要なものだけなら「ファイルを選ぶ」を使えます。'
        ].filter(Boolean).join('\n'), 'ok');
      }
      recordEvent('info', 'manifest', '共有解析成功', {shareName:manifest.shareName, fileCount:manifest.files.length, folderCount:manifest.folders.length, totalBytes:manifest.totalBytes});
      return manifest;
    }

    function handleAnalyzeFailure(e) {
      console.error('[Linkex analyze]', e);
      write(`解析失敗: ${e?.message || e}`, 'err');
      recordEvent('error', 'manifest', `共有解析失敗: ${e?.message || e}`);
      manifest = null;
      selectedIndexes.clear();
      selectionExpanded = false;
      renderSelection();
    }

    analyzeBtn.addEventListener('click', async () => {
      if (running || preparing) return;
      preparing = true;
      refreshQueueUi();
      try { await analyzeCurrentShare({announceSuccess:true}); }
      catch (e) { handleAnalyzeFailure(e); }
      finally { preparing = false; refreshQueueUi(); }
    });

    async function runJob(job, queueRoot, resume=false) {
      // 呼び出し側がleaseを取得済みであること。Queue stateのmutationより先に排他を確立する。
      assertLease();
      // 停止ボタンは実行中の同一job objectを直接更新する。GM storageの別snapshot経由だと
      // 後続saveQueueJob(job)で停止予約が巻き戻る可能性があるため、in-memory参照を保持する。
      activeRunJob = job;
      refreshQueueUi();
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
      } finally {
        activeRunJob = null;
        refreshQueueUi();
      }
    }

    async function startManifestQueue(selection = null, {baseDir = null, skipConfirm = false} = {}) {
      if (!manifest || running) return;
      const selected = selection == null ? null : Array.from(selection).sort((a,b) => a - b);
      const chosenFiles = selected == null ? manifest.files : selected.map(index => manifest.files[index]).filter(Boolean);
      if (!chosenFiles.length) { write('処理するファイルが選択されていません。', 'err'); return; }
      const currentHref = String(globalThis.location?.href || '');
      const currentPageTarget = detectSharePageTarget(currentHref);
      if (isSharePageHost(currentHref) && (!currentPageTarget || currentPageTarget.shareToken !== manifest.shareToken)) {
        manifest = null;
        selectedIndexes.clear();
        selectionExpanded = false;
        fileFilter.value = '';
        renderSelection();
        write('共有ページが解析時点から変わっています。現在の共有をもう一度解析してください。', 'err');
        syncSharePageContext({initial:true});
        return;
      }
      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }
      const totalBytes = chosenFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);
      const modeText = selected == null ? '全ファイル' : '選択ファイル';
      if (!skipConfirm) {
        const pageWindow = getNativePageWindow();
        const ok = Reflect.apply(pageWindow.confirm, pageWindow, [`${modeText} ${chosenFiles.length}件（合計 ${formatBytes(totalBytes)}）を順番に処理します。\n\n各ファイルはLinkexへ一時コピー → ローカル検証 → 確定済み一時コピーだけ削除します。\n開始しますか？`]);
        if (!ok) return;
      }
      let chosenBaseDir = baseDir;
      if (!chosenBaseDir) {
        try { chosenBaseDir = await invokeDirectoryPicker({mode:'readwrite'}); }
        catch (e) { if (e?.name !== 'AbortError') write(`保存先選択失敗: ${e?.message || e}`, 'err'); return; }
      }
      running = true;
      try {
        await acquireLease();
        const activeJob = loadQueueJob();
        if (activeJob && !isTerminal(activeJob)) throw new LinkexError('別の未完了Queueを検出しました。状態を再表示してから再開または整理してください。', {kind:'queue_conflict'});
        await ensureHandlePermission(chosenBaseDir);
        const job = createQueueFromManifest(manifest, selected);
        const queueRoot = await chosenBaseDir.getDirectoryHandle(job.folderName, {create:true});
        await putQueueRootHandle(job, queueRoot);
        saveQueueJob(job);
        recordEvent('info', 'queue-created', `Queue作成: ${job.jobId}`, {jobId:job.jobId, selectionMode:job.selectionMode, sourceOriginalCount:job.sourceOriginalCount, shareName:job.shareName, folderName:job.folderName, items:job.items.length, totalBytes:job.sourceTotalBytes});
        write(`${modeText} Queue作成\n\n${queueSummary(job)}\n\n${job.items.length}ファイルを順次処理します。`, 'ok');
        await runJob(job, queueRoot, false);
      } catch (e) {
        console.error('[Linkex Queue]', e);
        const job = loadQueueJob();
        write(`Queue停止: ${e?.message || e}\n\n${queueSummary(job)}\n\n危険な状態では安全側で停止します。「Queueを再開」はcopy/delete POSTを盲目的に再送しません。`, 'err');
      } finally { running = false; releaseLease(); syncSharePageContext({initial:true}); refreshQueueUi(); }
    }

    startBtn.addEventListener('click', async () => {
      if (running || preparing) return;
      const active = loadQueueJob();
      if (active && !isTerminal(active)) { write('未完了Queueがあります。先に「Queueを再開」または詳細から状態を確認してください。'); refreshQueueUi(); return; }
      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }
      preparing = true;
      refreshQueueUi();
      try {
        // user gestureが失われる前に保存先permission/pickerを確定し、その後でnetwork解析する。
        const baseDir = await acquirePreferredBaseDirFromGesture();
        await analyzeCurrentShare({announceSuccess:false});
        preparing = false;
        refreshQueueUi();
        await startManifestQueue(null, {baseDir, skipConfirm:true});
      } catch (e) {
        if (e?.name !== 'AbortError') {
          if (e?.kind === 'filesystem') write(`保存先準備失敗: ${e?.message || e}`, 'err');
          else handleAnalyzeFailure(e);
        }
      } finally {
        preparing = false;
        refreshQueueUi();
      }
    });

    selectModeBtn.addEventListener('click', async () => {
      if (running || preparing) return;
      preparing = true;
      refreshQueueUi();
      try {
        await analyzeCurrentShare({announceSuccess:false});
        selectionExpanded = true;
        renderSelection();
        write(`ファイルを選択してください。\n${manifest.files.length}件 / ${formatBytes(manifest.totalBytes)}\n選択後に「選択をダウンロード」を押します。`, 'ok');
      } catch (e) { handleAnalyzeFailure(e); }
      finally { preparing = false; refreshQueueUi(); }
    });

    selectedStartBtn.addEventListener('click', async () => {
      if (running || preparing || !manifest || !selectedIndexes.size) return;
      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }
      preparing = true;
      refreshQueueUi();
      try {
        const baseDir = await acquirePreferredBaseDirFromGesture();
        preparing = false;
        refreshQueueUi();
        await startManifestQueue(new Set(selectedIndexes), {baseDir, skipConfirm:true});
      } catch (e) {
        if (e?.name !== 'AbortError') write(`保存先準備失敗: ${e?.message || e}`, 'err');
      } finally { preparing = false; refreshQueueUi(); }
    });

    destinationBtn.addEventListener('click', async () => {
      if (running || preparing) return;
      preparing = true;
      refreshQueueUi();
      try {
        const handle = await acquirePreferredBaseDirFromGesture({forcePicker:true});
        write(`保存先を「${handle.name || '選択済みフォルダ'}」に設定しました。次回から権限が有効なら1クリックで開始できます。`, 'ok');
      } catch (e) {
        if (e?.name !== 'AbortError') write(`保存先変更失敗: ${e?.message || e}`, 'err');
      } finally { preparing = false; refreshQueueUi(); }
    });

    resumeBtn.addEventListener('click', async () => {
      if (running) return;
      const snapshot = loadQueueJob();
      if (!snapshot || isTerminal(snapshot)) { refreshQueueUi(); return; }
      if (!resolveCredentials()) { write(credentialBootstrapMessage(), 'err'); syncSharePageContext({initial:true}); return; }
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
      } finally { running = false; releaseLease(); syncSharePageContext({initial:true}); refreshQueueUi(); }
    });

    pauseBtn.addEventListener('click', () => {
      const job = activeRunJob;
      if (!job || !running) return;
      job.stopRequested = true;
      saveQueueJob(job);
      recordEvent('info', 'pause-requested', `停止予約: ${job.jobId}`);
      write(`停止予約を受け付けました。\n新しいCOPYを止め、進行中のDOWNLOAD/VERIFY/DELETEを安全に完了してから停止します。\n\n${queueSummary(job)}`);
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

    abandonBtn.addEventListener('click', async () => {
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
      ].join('\n');
      if (!Reflect.apply(pageWindow.confirm, pageWindow, [warning])) return;
      running = true;
      try {
        await acquireLease();
        const job = loadQueueJob();
        if (!job || isTerminal(job)) { write('破棄対象の未完了Queueはありません。'); return; }
        if (job.jobId !== snapshot.jobId) throw new LinkexError('確認後にQueueが変更されました。状態を再表示してからやり直してください。', {kind:'queue_conflict'});
        recordEvent('warn', 'queue-abandon', `Queue stateを手動破棄: ${job.jobId}`, {jobId:job.jobId, state:job.state, lastError:job.lastError || null});
        const result = await abandonQueueJob(job);
        write(`Queue stateを破棄しました。\nLinkex上のファイルは削除していません。未確定の一時コピーがないかLinkex側を確認してください。${result.handleCleanupError ? `\n\n保存先Handle整理警告: ${result.handleCleanupError}` : ''}`, 'ok');
      } catch (e) {
        write(`Queue破棄失敗: ${e?.message || e}`, 'err');
      } finally {
        running = false;
        releaseLease();
        refreshQueueUi();
      }
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

    if (isDiskStoragePage()) {
      syncCredentialBridgeFromDisk();
      setTimeout(() => syncCredentialBridgeFromDisk({clearIfMissing:true}), 4000);
      setInterval(() => syncCredentialBridgeFromDisk({clearIfMissing:true}), 60000);
    }
    syncSharePageContext({initial:true});
    void refreshPreferredDirectoryState({reloadHandle:true});
    let observedPageHref = String(globalThis.location?.href || '');
    setInterval(() => {
      const currentHref = String(globalThis.location?.href || '');
      if (currentHref === observedPageHref) return;
      observedPageHref = currentHref;
      syncSharePageContext();
    }, 750);
    globalThis.addEventListener?.('focus', () => {
      if (isDiskStoragePage()) syncCredentialBridgeFromDisk();
      void refreshPreferredDirectoryState({reloadHandle:false});
      syncSharePageContext({initial:true});
    });

    const existing = refreshQueueUi();
    if (existing) {
      if (existing.state === 'DONE') write(`前回Full Queueは完了済みです。\n\n${queueSummary(existing, {detail:true})}\n\n別共有は「すべてダウンロード」から開始できます。`, 'ok');
      else if (existing.state === 'DONE_WITH_SKIPS') write(`前回Full Queueはスキップありで走査完了しています。\n\n${queueSummary(existing, {detail:true})}\n\n容量条件を変えた場合は「容量スキップを再試行」が使えます。`, 'ok');
      else write(`未完了Full Queueを検出しました。\n\n${queueSummary(existing)}\n\n「Queueを再開」で状態照合から続けられます。`, '');
    }
    recordEvent('info', 'startup', `Linkex Downloader v${VERSION} 起動`);
    return root;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel, {once:true});
  else createPanel();
})();
