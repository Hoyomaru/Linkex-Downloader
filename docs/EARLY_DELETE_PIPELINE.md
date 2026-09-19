# Early-delete DL=4 pipeline experiment

This experiment follows the successful early-delete signed-URL probe.

## Transaction order

For each file:

1. COPY the shared source into the user's Linkex root.
2. Reconcile the new destination ID and prove it did not exist before COPY.
3. Refresh the destination metadata, verify identity, and obtain the signed CDN URL.
4. Keep the signed URL in memory only.
5. DELETE exactly the proven temporary destination and confirm it is absent.
6. Release the Linkex capacity reservation.
7. Download to the local File System Access handle using the existing 4 MiB buffered writer.
8. Verify final local size against CDN Content-Length, or normal stream EOF when Content-Length is unavailable.
9. Mark the transaction DONE. No second DELETE is sent.

The normal downloader path is untouched and still requires LOCAL_COMMITTED before DELETE.

## Concurrency

COPY and early DELETE are serialized. Local downloads use four workers. At most five detached transactions are in flight, so one newly detached URL can wait while four downloads are active. This lets COPY/DELETE overlap network transfer without creating a large queue of expiring signed URLs.

## Recovery

Signed URLs are never persisted. If a detached download fails and the Queue is resumed later, the previous deleted operation is archived and a new COPY obtains a fresh signed URL. The new temporary copy is deleted again before the local partial file resumes by Range.

If DELETE is uncertain, no new COPY is started for that item until presence/absence reconciliation completes. DELETE is never blindly replayed.
