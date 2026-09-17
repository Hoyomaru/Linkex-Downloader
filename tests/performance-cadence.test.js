const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('linkex-downloader.user.js', 'utf8');

test('cadence experiment uses 16 MiB or 1 s checkpoints and 750 ms UI refresh', () => {
  assert.match(source, /const CHECKPOINT_BYTES = 16 \* 1024 \* 1024;/);
  assert.match(source, /const CHECKPOINT_INTERVAL_MS = 1000;/);
  assert.match(source, /const UI_UPDATE_INTERVAL_MS = 750;/);
  assert.match(source, /written >= nextCheckpoint \|\| now - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS/);
  assert.match(source, /now - lastUi >= UI_UPDATE_INTERVAL_MS/);
});

test('instantaneous transfer-rate sampling remains at 250 ms for A\/B comparability', () => {
  assert.match(source, /now - lastRateAt >= 250/);
});
