# Early-delete DL=8 size-desc scheduling experiment

This branch is based on the validated early-delete DL=8 / maxInFlight=16 implementation.

Only processing order changes: the experimental early-delete queue is sorted by descending source metadata size before it starts. Each item's manifestIndex, source identity, and allocated local path are preserved. Queue-local index values are reassigned only to reflect execution order.

The purpose is to keep the eight download workers occupied with long-lived transfers. The previous DL=8 run reached at most six simultaneous transfers because short files completed before later large files were prepared.

All destructive and recovery behavior is unchanged:

- COPY ownership must be proven.
- Signed URLs remain memory-only.
- DELETE is exactly one ownership-confirmed temporary destination.
- DELETE uncertainty is reconciled and never blindly replayed.
- Local completion still uses the existing Content-Length / EOF verification path.
- Resume after a confirmed early DELETE still obtains a fresh COPY and signed URL before Range-resuming the local partial file.
