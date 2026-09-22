# Linkex Downloader Performance Plan

This document tracks the v1.3 performance work without weakening the current deletion-safety invariants.

## Scope

v1.3 performance work proceeds in this order:

1. Measure the current browser pipeline.
2. Optimize single-download behavior.
3. Add safe pipeline concurrency with COPY=1 / DOWNLOAD=2 (optionally 4 after measurement) / DELETE=1.
4. Evaluate Gopeed as the only external download engine.

AB Download Manager and aria2 are out of scope for this branch.

## Safety invariants

Performance changes must not weaken the existing ownership proof, `LOCAL_COMMITTED` gate, single-`destId` DELETE, ambiguous COPY stop behavior, identity re-check, lease behavior, or signed-URL/token redaction.

When safety and throughput conflict, stop rather than risk deleting the wrong Linkex object.

## Phase A — Telemetry

Record timings per transaction for:

- COPY
- ownership reconcile
- DOWNLOAD
- VERIFY
- DELETE
- total

During DOWNLOAD, record:

- downloaded bytes
- elapsed time
- average MB/s
- instantaneous MB/s for UI display
- resume/full-restart mode
- verification method (`content-length` or `stream-eof`)

Telemetry must not persist signed URLs, Authorization headers, access tokens, or other credentials.

### Proposed support JSON shape

```json
{
  "performance": {
    "copyMs": 0,
    "ownershipReconcileMs": 0,
    "downloadMs": 0,
    "verifyMs": 0,
    "deleteMs": 0,
    "totalMs": 0,
    "downloadedBytes": 0,
    "averageBytesPerSec": 0,
    "peakBytesPerSec": 0,
    "verificationMethod": "content-length"
  }
}
```

The exact persisted schema may change during implementation, but it must remain operation-scoped so later multi-worker work cannot collide through a single global state entry.

Implemented on `feat/v1.3-performance`: transaction-scoped phase timing, transfer-rate telemetry, UI average/instant rate display, and an aggregate `performance` section in the support bundle. The existing 2 MiB checkpoint and ~250 ms UI cadence are intentionally unchanged for the baseline measurement.

### Browser baseline (3 runs, same 26-file / 6.37 GB workload)

| Metric | Run 1 | Run 2 | Run 3 | Median |
|---|---:|---:|---:|---:|
| Transfer throughput (MiB/s) | 27.63 | 35.45 | 40.19 | 35.45 |
| Transfer time (s) | 219.962 | 171.460 | 151.203 | 171.460 |
| DOWNLOAD phase (s) | 235.033 | 178.346 | 157.902 | 178.346 |
| COPY phase (s) | 8.807 | 7.246 | 6.489 | 7.246 |
| Ownership reconcile (s) | 8.153 | 6.917 | 5.952 | 6.917 |
| DELETE phase (s) | 25.463 | 21.802 | 19.113 | 21.802 |
| Transaction total (s) | 286.182 | 221.200 | 196.092 | 221.200 |
| Queue effective throughput (MiB/s) | 20.03 | 25.86 | 29.19 | 25.86 |

The three baseline runs improved monotonically (27.63 -> 35.45 -> 40.19 MiB/s), so CDN/cache/time effects are material. Candidate measurements must therefore be followed by at least one baseline rerun when the result is close enough that drift could explain the difference.

`exp/v1.3-cadence` changes only checkpoint/UI cadence for the first A/B candidate: checkpoint after 16 MiB **or** 1000 ms (whichever is reached first on a received chunk), UI refresh every 750 ms, while the 250 ms transfer-rate sampling remains unchanged for comparability.


Cadence A/B follow-up: the candidate measured 38.52 MiB/s and the immediate baseline rerun measured 36.90 MiB/s. That +4.4% paired difference is smaller than the observed baseline drift; the candidate is almost exactly the midpoint of the two most recent baseline runs (40.19 and 36.90 MiB/s). Treat cadence as throughput-neutral and keep it because it substantially reduces checkpoint/UI update frequency without changing verification or deletion gates.

`exp/v1.3-buffered-writer` adds a 4 MiB multi-chunk write buffer on top of the cadence candidate. Checkpoints only persist bytes that have actually been flushed to the File System Access writable stream. Unflushed JS-buffer bytes are intentionally discarded on interruption so the resume offset cannot overstate durable local progress.

## Phase A — Low-risk optimization experiments

Compare each change against the v1.2.1-equivalent baseline using the same file and environment.

| Experiment | Baseline | Candidate | Result |
|---|---|---|---|
| Checkpoint cadence | 2 MiB | 16 MiB or 1000 ms | throughput-neutral; keep |
| UI update cadence | ~250 ms | 750 ms | throughput-neutral; keep |
| Writer behavior | per stream chunk | 4 MiB buffered multi-chunk writes | strong positive signal; carry forward into pipeline benchmark |

Do not keep a change that does not improve performance or at least remain neutral while preserving all safety tests.

## Phase B — Pipeline concurrency

Target pipeline:

```text
COPY lane: 1
  -> ownership confirmed
DOWNLOAD pool: 2
  -> verified
DELETE lane: 1
```

A 4-worker download setting is retained only if real measurements show better aggregate throughput.

COPY remains serial because current ownership proof depends on the copy producing a uniquely attributable new ID.

Before enabling more than one download worker, operation/download state must be separated by `operationId` or `queueJobId:index`, and queue persistence must be serialized.

## Phase C — Gopeed only

Gopeed is the only external engine to evaluate.

Initial benchmark matrix:

| Case | Purpose | Result |
|---|---|---|
| Browser v1.2.1-equivalent, 1 connection | baseline | pending |
| Browser optimized, 1 connection | browser overhead after Phase A | pending |
| Browser pool=2 | aggregate throughput | pending |
| Browser pool=4 | determine whether 4 workers help | pending |
| Gopeed 1 connection | compare browser vs external engine | pending |
| Gopeed 2 connections | CDN connection scaling | pending |
| Gopeed 4 connections | CDN connection scaling | pending |
| Gopeed 8 connections | CDN connection scaling | pending |
| Gopeed 16 connections | CDN connection scaling | pending |

Use files around 170 MB and at least one file >= 1 GB. When practical, run each condition three times and use the median. Do not run competing benchmark conditions simultaneously.

Record bytes, download seconds, average MB/s, connection count, COPY seconds, DELETE seconds, CPU, memory, failures, retries, and resume success.

## External-mode deletion gate

Gopeed reporting `complete` is not equivalent to the browser mode's `LOCAL_COMMITTED` evidence.

The first external-mode implementation may submit tasks and observe progress/completion, but must not automatically DELETE the Linkex temporary copy solely because Gopeed says the task completed.

Automatic deletion requires an independent local verification design, such as a local helper that can inspect the saved file from the OS side.

## Current execution order

- [x] P0: Add performance telemetry to support JSON and UI.
- [x] P0: A/B checkpoint and UI update cadence.
- [x] P0: Test buffered writer approach.
- [x] P0: Split download state by operation ID.
- [x] P1: Implement COPY=1 / DOWNLOAD=2 / DELETE=1.
- [ ] P1: Evaluate DOWNLOAD=4 and keep only if aggregate throughput improves.
- [ ] P1: Gopeed PoC and 1/2/4/8/16 connection benchmark.
- [ ] P1: Document and test external-mode deletion gate.


### Buffered-writer follow-up

Using the same 26-file / 6.37 GB workload, the corrected implementation labels produced two cadence runs around 38 MiB/s (38.52 and 38.11 MiB/s) and two buffered-writer runs around 66-68 MiB/s (67.58 and 65.88 MiB/s). The repeated separation is a strong positive signal for the 4 MiB writer buffer, so Phase B carries the buffered writer forward. Continue to treat CDN/path variance as material and judge the pipeline by repeated aggregate measurements rather than a single run.

### Phase B implementation candidate

`exp/v1.3-pipeline` layers a bounded safety-first pipeline on top of the buffered writer:

- COPY lane remains strictly serial (1).
- DOWNLOAD pool is 2.
- DELETE lane is strictly serial (1).
- At most 3 ownership-confirmed transactions may be in flight.
- New COPY work uses a byte reservation budget seeded from Linkex usage and rechecks reported free space before reserving.
- Download checkpoint/probe state is keyed by `operationId`; the old global key is only a migration fallback.
- Queue-level concurrent mutations use a serialized commit chain.
- A user pause stops new COPY work and drains already-started DOWNLOAD/VERIFY/DELETE work to safe boundaries.
- Lease ownership is rechecked during long downloads at a low frequency, so lease loss cannot silently run through to DELETE.

The destructive gate is unchanged: DELETE still requires `LOCAL_COMMITTED`, the ownership-confirmed `destId`, identity re-check, and the one-ID `select_all:false` request.


### Pipeline benchmark metrics

The support bundle now keeps the original `aggregateDownloadMBps` for single-worker comparability and adds concurrency-aware metrics:

- `poolDownloadMBps`: all transferred bytes divided by the wall-clock transfer window from the first transfer start to the last transfer end. This is the primary DOWNLOAD=2 aggregate-throughput metric.
- `pipelineEffectiveMBps`: transferred bytes divided by the active pipeline wall time.
- `queueEffectiveMBps`: transferred bytes divided by Queue creation-to-completion wall time.
- `transferWindowMs`, `pipelineWallMs`, and `queueWallMs` are included so the rate calculations remain auditable.

A stop/fatal check is also repeated after the asynchronous capacity recheck and immediately before COPY. If stop/fatal arrives during that network request, the unused reservation is released and no new COPY starts.


### Pipeline DOWNLOAD=1 vs DOWNLOAD=2 A/B

Same 26-file workload (6,372,761,319 transferred bytes), all runs completed with no download retry/resume:

| Browser pipeline | Transfer sum / per-connection | Transfer wall window | Pool throughput | Pipeline wall | Queue wall | Queue effective |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DOWNLOAD=1 | 62.64 MiB/s | 114.061 s | 53.28 MiB/s | 116.405 s | 116.684 s | 52.09 MiB/s |
| DOWNLOAD=2 | 40.21 MiB/s weighted per-connection | 97.974 s | 62.03 MiB/s | 100.575 s | 100.848 s | 60.26 MiB/s |

DOWNLOAD=2 reduces Queue wall time by 13.57% versus DOWNLOAD=1 and raises Queue effective throughput by 15.70%.

The key result is not higher per-connection speed. With DOWNLOAD=1, actual network transfer time sums to 97.023 s but the first-to-last transfer window is 114.061 s, leaving about 17.038 s of no active network transfer between files. With DOWNLOAD=2, the pool transfer window falls to 97.974 s; overlapping setup and adjacent transfers fills most of those holes while keeping aggregate pool throughput around the same network ceiling.

Decision for the browser candidate: keep COPY=1 / DOWNLOAD=2 / DELETE=1. There is no current evidence that increasing DOWNLOAD beyond 2 would raise the observed pool throughput enough to justify extra contention or safety complexity. The DL=1 branch remains an A/B reference only.


## Early-delete signed-URL survival probe

`exp/v1.3-early-delete-probe` is an isolated one-file destructive experiment. It does **not** change the production `assertDeleteGuards()` rule: normal downloads still require `LOCAL_COMMITTED` before DELETE.

The probe sequence is:

1. Run the normal Linkex COPY and ownership reconciliation.
2. Refresh the confirmed destination URL and re-check destination identity.
3. Start one CDN GET and read the first data chunk.
4. DELETE only the ownership-confirmed temporary `destId` using `select_all:false` and exactly one `file_ids` entry.
5. Reconcile DELETE to confirmed absence; an uncertain DELETE is never blindly replayed.
6. Continue the already-open CDN stream to normal EOF, verifying Content-Length when exposed.
7. With the same in-memory signed URL, start a fresh GET after deletion and read one chunk.
8. Start a fresh Range GET after deletion and require HTTP 206.
9. Persist only the probe results, never the signed URL. CDN bytes are discarded and no local file is saved.

A `FULL_PASS` means all three behaviors are confirmed: the in-flight stream survives deletion, a new GET works after deletion, and a new Range GET returns 206 after deletion. Only that result justifies a later capacity-decoupled architecture experiment.


### Early-delete probe result (2026-09-19)

One-file probe result: **FULL_PASS**.

- Source metadata size: 1,783,148,262 bytes.
- CDN Content-Length: 1,783,147,708 bytes.
- The stream was opened with HTTP 200 and the first chunk was received before DELETE.
- The owned temporary destination was deleted and confirmed absent about 691 ms after stream open.
- The already-open stream then reached normal EOF after deletion with exactly 1,783,147,708 bytes.
- Post-delete fresh GET returned HTTP 200 and delivered data.
- Post-delete Range GET from offset 1,048,576 returned HTTP 206 and delivered data.
- The Range response Content-Length was 1,782,099,132 bytes, exactly CDN total minus the requested offset.

Decision: signed CDN access is not tied to continued presence of the temporary Linkex destination, at least for the tested URL lifetime. This removes the active-download capacity coupling in principle. The next experiment should use real local writes with early deletion and a bounded multi-download pool; signed URLs should not be persisted, and recovery after a process/tab loss should obtain a new owned temporary copy and new signed URL before resuming a local partial file.


## Early-delete DL=4 real-write pipeline

After the one-file signed-URL probe returned FULL_PASS, `exp/v1.3-early-delete-pipeline-dl4` adds a real local-write benchmark mode.

Experimental transaction order:

`COPY -> ownership confirm -> signed URL (memory only) -> DELETE + confirmed absent -> DOWNLOAD/VERIFY -> DONE`

The production browser mode remains unchanged and still deletes only after `LOCAL_COMMITTED`.

Pipeline settings:

- COPY workers: 1
- early DELETE workers: 1 (serialized in the COPY scheduler)
- DOWNLOAD workers: 4
- max in-flight detached transactions: 5
- signed URL persistence: none
- local writer: existing 4 MiB buffered writer and the same final-size/EOF verification
- one extra in-flight slot allows the next COPY/DELETE setup to overlap the four active downloads.

Capacity is released immediately after the temporary destination is confirmed absent, before the download enters the worker pool. A short quota-propagation retry loop tolerates delayed Linkex usage accounting without immediately waiting for an entire download to finish.

Recovery rule: if a detached download fails after confirmed early DELETE, the signed URL is not persisted. On a later Queue resume, the old operation is archived, a new ownership-safe COPY obtains a new signed URL, that new temporary copy is early-deleted, and the existing local partial file is resumed with Range. DELETE-uncertain states are reconciled before any new COPY and are never blindly replayed.

Benchmark target: compare the same workload against the current browser candidate (COPY=1 / DOWNLOAD=2 / DELETE=1). Primary metrics are `poolDownloadMBps`, `pipelineEffectiveMBps`, `queueEffectiveMBps`, and queue wall time.


### Early-delete DL=4 first real-write run (2026-09-22)

The first real-write run completed safely: 26/26 transactions DONE, no download retries, all downloads verified, all ownership-confirmed temporary destinations confirmed absent before local transfer start.

Measured queue:

- transferred bytes: 6,372,761,319
- transfer window: 130.091 s
- pool throughput: 46.72 MiB/s
- pipeline wall: 132.300 s
- pipeline effective: 45.94 MiB/s
- queue wall: 132.571 s
- queue effective: 45.84 MiB/s
- actual download overlap reached 4.

This is slower than the previous DOWNLOAD=2 browser pipeline (62.03 MiB/s pool, 100.848 s queue wall, 60.26 MiB/s queue effective). The first DL=4 early-delete run therefore does not establish a speed gain.

Post-run timing analysis shows a starvation pattern rather than a destructive-action failure. Within the 130.091 s transfer window, no transfer was active for about 46.489 s. The first 16 setup transactions were fast (COPY ~251 ms median, ownership reconciliation ~236 ms, URL-refresh-to-delete gap ~464 ms, DELETE ~478 ms). From item 17 onward those control-plane phases stepped to approximately COPY 0.99 s, reconciliation 1.00 s, URL-refresh-to-delete gap 1.98 s, and DELETE 2.02 s. Because maxInFlight=5 allowed only one prefetched detached URL beyond the four download workers, that setup slowdown drained the download pool.

Next isolated A/B: keep DOWNLOAD=4 and every destructive guard unchanged, but raise early-delete maxInFlight from 5 to 8. This allows up to four memory-only signed URLs to wait behind four active downloads. The signed URLs are still never persisted. If this does not recover utilization, the next target is control-plane request reduction/pacing rather than higher download concurrency.
