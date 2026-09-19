# Early DELETE / signed URL survival probe

This branch is intentionally experimental. It tests whether a signed CDN URL remains useful after Linkex's temporary copied file has been removed.

## Scope

Select exactly one file and press **1件で早期DELETE検証**. The probe does not save the CDN payload locally; it reads and discards it.

The normal downloader's destructive gate is unchanged. Normal Queue deletion still requires `LOCAL_COMMITTED`. The probe has a separate, explicit guard that only accepts a one-file `early-delete-probe` job, a destination ID proven new relative to the pre-copy root IDs, and an unchanged Linkex identity.

## Pass criteria

`FULL_PASS` requires all of the following:

- An HTTP stream opened before DELETE reaches normal EOF after the temporary Linkex copy is confirmed absent.
- The same signed URL can start a brand-new GET after DELETE.
- The same signed URL can start a brand-new Range request after DELETE and returns HTTP 206.

If only the already-open stream survives, the result is `PARTIAL_PASS`; that is not enough for safe high-concurrency/resume architecture.

## Safety / recovery

DELETE remains exactly one ownership-confirmed `destId`. If the DELETE response is uncertain, the probe reconciles presence/absence and never blindly sends DELETE again. The signed URL is kept only in memory and is not persisted in Queue/support data. Because of that, a probe interrupted after confirmed early DELETE is deliberately not resumable.
