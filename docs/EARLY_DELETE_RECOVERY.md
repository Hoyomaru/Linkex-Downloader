# Early-delete recovery / Range-resume validation

This branch keeps the selected early-delete performance settings: DOWNLOAD=8, maxInFlight=16, normal manifest order.

The **1件 復旧テスト** is an explicit one-file fault-injection test.

## Stage 1

1. Run the normal ownership-safe COPY.
2. Obtain the signed URL in memory only.
3. DELETE exactly the owned temporary destination and confirm absence.
4. Start the local download.
5. After a bounded amount of data has been flushed to the local file, intentionally stop with a dedicated recovery-probe error.
6. Persist the transaction as DOWNLOAD_PAUSED. The signed URL is never persisted.

Reload the page after the planned stop. This removes the in-memory URL and task closure from the recovery path.

## Stage 2

1. Press Queue resume after reload.
2. Archive the deleted operation metadata while leaving the local partial file untouched.
3. Run a new ownership-safe COPY and obtain a new signed URL.
4. DELETE the replacement temporary destination and confirm absence.
5. Open the existing local file and issue a Range request from its current size.
6. Complete the file and run the normal final local verification.

FULL_PASS requires a different operation ID, a different temporary destination ID, confirmed deletion of the replacement temporary destination, an actual Range resume, and successful final local verification.

No production ownership/delete guard is weakened, and no signed URL is persisted.
