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

## Phase A — Low-risk optimization experiments

Compare each change against the v1.2.1-equivalent baseline using the same file and environment.

| Experiment | Baseline | Candidate | Result |
|---|---|---|---|
| Checkpoint cadence | 2 MiB | 16 MiB or 1000 ms | candidate implemented; A/B pending |
| UI update cadence | ~250 ms | 750 ms | candidate implemented; A/B pending |
| Writer behavior | per stream chunk | buffered multi-chunk writes | pending |

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
- [ ] P0: A/B checkpoint and UI update cadence.
- [ ] P0: Test buffered writer approach.
- [ ] P0: Split download state by operation ID.
- [ ] P1: Implement COPY=1 / DOWNLOAD=2 / DELETE=1.
- [ ] P1: Evaluate DOWNLOAD=4 and keep only if aggregate throughput improves.
- [ ] P1: Gopeed PoC and 1/2/4/8/16 connection benchmark.
- [ ] P1: Document and test external-mode deletion gate.
