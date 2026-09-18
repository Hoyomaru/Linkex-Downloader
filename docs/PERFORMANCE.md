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


### DOWNLOAD=1 pipeline A/B

`exp/v1.3-pipeline-dl1` is an A/B branch that changes only the DOWNLOAD worker count from 2 to 1. The in-flight bound remains 3 so COPY prefetch, DELETE overlap, reservation behavior, operation-scoped state, and commit serialization stay comparable with the DOWNLOAD=2 pipeline.

Reason for the A/B: the first DOWNLOAD=2 run completed the 6.37 GB workload in about 100.8 s end-to-end, but its measured pool throughput (~62.0 MiB/s) was slightly below the previously repeated single buffered-writer transfer rate (~65.9-67.6 MiB/s). A one-worker pipeline can show whether most of the win comes from overlapping COPY/DELETE around one fast transfer rather than splitting bandwidth across two simultaneous downloads.
