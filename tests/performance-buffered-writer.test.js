'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {TextEncoder} = require('node:util');

const SOURCE_PATH = 'linkex-downloader.user.js';
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const STARTUP = "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel, {once:true});\n  else createPanel();\n})();";
const EXPOSE = "  globalThis.__writerTest = {mergeWriteBufferChunks};\n})();";

function loadRuntime() {
  assert.ok(SOURCE.includes(STARTUP), 'test harness could not find userscript startup block');
  const storage = new Map();
  const context = {
    console,
    TextEncoder,
    URL,
    URLSearchParams,
    Uint8Array,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto:webcrypto,
    navigator:{language:'ja-JP'},
    location:new URL('https://disk.linkex.io/'),
    localStorage:{length:0,key(){return null;},getItem(){return null;}},
    atob(value) { return Buffer.from(String(value), 'base64').toString('binary'); },
    window:{},
    unsafeWindow:{},
    document:{readyState:'loading', addEventListener(){}},
    GM_getValue(key, fallback) { return storage.has(key) ? storage.get(key) : fallback; },
    GM_setValue(key, value) { storage.set(key, value); },
    GM_xmlhttpRequest() { throw new Error('unexpected GM_xmlhttpRequest'); },
    fetch:async () => { throw new Error('unexpected fetch'); },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE.replace(STARTUP, EXPOSE), context, {filename:SOURCE_PATH});
  return context.__writerTest;
}

test('buffered writer batches at 4 MiB while preserving cadence controls', () => {
  assert.match(SOURCE, /const WRITE_BUFFER_BYTES = 4 \* 1024 \* 1024;/);
  assert.match(SOURCE, /bufferedBytes >= WRITE_BUFFER_BYTES/);
  assert.match(SOURCE, /await flushBufferedWrite\(\);/);
  assert.match(SOURCE, /downloadedBytes:written/);
  assert.match(SOURCE, /onProgress\(\{written:received,/);
});

test('mergeWriteBufferChunks preserves byte order', () => {
  const api = loadRuntime();
  const merged = api.mergeWriteBufferChunks([
    new Uint8Array([1, 2]),
    new Uint8Array([3]),
    new Uint8Array([4, 5, 6]),
  ], 6);
  assert.deepEqual(Array.from(merged), [1, 2, 3, 4, 5, 6]);
});
