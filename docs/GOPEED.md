# Gopeed external-engine experiment

Target: stable Gopeed v1.9.3.

## Setup

1. In Gopeed, open Settings → Advanced and set Communication Protocol to TCP.
2. Use a local API address such as `127.0.0.1:9999`.
3. Optionally configure an API token and enter the same token in Linkex Downloader.
4. Restart Gopeed after changing communication settings.
5. In Linkex Downloader, open Details → Gopeed settings and run the connection test.

The userscript accepts only loopback HTTP endpoints (`127.0.0.1` or `localhost`).

## Workflow

Analyze the Linkex share, open file selection, select exactly one file, then press **選択1件をGopeed**. Linkex Downloader performs the existing ownership-safe COPY/reconciliation, rechecks the confirmed destination identity, and creates one Gopeed task from the signed CDN URL. Gopeed saves into its own configured default download directory.

The task request uses Gopeed v1.9.3's `opts` field and a per-task HTTP `connections` value. The userscript tags the task with the Linkex transaction operation ID so an uncertain task-creation POST can be reconciled without blind replay.

## Destructive-action boundary

Gopeed status `done` is not sufficient evidence for Linkex automatic deletion. The userscript cannot independently inspect the actual file in Gopeed's arbitrary local save directory, so the transaction ends as `EXTERNAL_COMPLETE_UNVERIFIED`.

- `LOCAL_COMMITTED` is never set from Gopeed status alone.
- `ensureDeleted()` is never entered for a Gopeed transaction.
- The ownership-confirmed Linkex temporary copy intentionally remains.
- **Queueを安全に破棄** clears only the userscript record; it does not delete the Linkex temporary file.
- Signed URL expiry or a Gopeed task error stops without automatic URL patching/re-submission.
- The userscript never invokes Gopeed task DELETE.
- Auto-delete can be added only after a local helper independently verifies the saved file identity and byte size.

## Benchmark

Use the same large representative file and compare connections 1, 2, 4, 8, and 16. Save the Linkex support JSON after each run. `externalPerformance` records the selected connection count, downloaded bytes, elapsed time, average rate, and peak observed rate without exporting the signed URL or API token.
