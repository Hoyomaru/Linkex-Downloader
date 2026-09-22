# v1.3 DL=8 Release Candidate

This branch promotes the validated normal-order early-delete pipeline to the default user path without publishing a release or changing main.

## Selected configuration

- COPY workers: 1
- early DELETE workers: 1
- local DOWNLOAD workers: 8
- max in-flight detached transactions: 16
- signed URL persistence: false
- processing order: manifest order
- compatibility fallback: legacy LOCAL_COMMITTED-before-DELETE pipeline

## Measured performance

Same 26-file / 6.37 GB workload:

| configuration | pool MiB/s | queue-effective MiB/s | queue wall |
|---|---:|---:|---:|
| old DOWNLOAD=2 pipeline | 62.03 | 60.26 | 100.85 s |
| early-delete DL=4 / maxInFlight=8 | 74.32 | 72.19 | 84.19 s |
| early-delete DL=6 / maxInFlight=12 | 76.08 | 73.92 | 82.22 s |
| early-delete DL=8 / maxInFlight=16 | 77.14 | 74.93 | 81.11 s |
| DL=8 size-desc ceiling probe | 77.38 | 75.13 | 80.89 s |

Size-desc was not adopted because it forced sustained eight-way overlap but improved queue-effective throughput by only about 0.27% and would reorder the user's files.

## Destructive safety model

The fast path is allowed to delete a temporary copy before local completion only when all of the following are true:

1. COPY ownership is proven from before/after ID evidence.
2. The destination ID did not exist before COPY.
3. COPY ambiguity is absent.
4. A fresh signed CDN URL has been obtained from that exact owned destination.
5. The destination identity is re-read and matches the ownership snapshot immediately before DELETE.
6. DELETE targets exactly that one destination ID with select_all=false.
7. An uncertain DELETE is reconciled by presence/absence and is never blindly replayed.
8. The shared source is never a DELETE target.

The signed URL remains memory-only.

## Recovery gate

Recovery v3 completed FULL_PASS on a 1,483,073,919-byte file:

- 64 MiB local partial persisted after the first owned temp had been deleted
- page reload produced a different runtime context
- resume used a different COPY operation and different destination ID
- replacement destination was deleted and confirmed absent
- Range resumed from 64 MiB
- final local bytes exactly matched expected CDN bytes
- final verification succeeded

A real page exit releases only a lease owned by that same runtime context. BFCache pages retain their lease; crashes still rely on the existing TTL. A live second tab is never forcibly taken over.

## Release boundary

This is a release candidate branch only. Public stable remains v1.2.1 until the user explicitly approves final v1.3 versioning, merge/tag, and GitHub Release publication.
