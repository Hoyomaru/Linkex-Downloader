# Share Page Mode Design

## Goal

Allow Linkex Downloader to be operated directly from a `https://l2e.click/d/...` share page, removing the need to copy the share URL into the panel on `https://disk.linkex.io/`.

The existing transaction core remains unchanged:

`COPY -> ownership confirm -> DOWNLOAD -> VERIFY -> DELETE owned destId only`

This feature changes the entry point, credential resolution, and page-context UI only. It must not weaken delete guards, lease ordering, write retry policy, or local verification.

## Supported page modes

### 1. Share-page mode

Matched pages:

- `https://l2e.click/d/*`
- `https://www.l2e.click/d/*`

Behavior:

- Detect the share token from the current top-level URL.
- Hide the manual URL field while a valid share-page context is present.
- Show a page-context summary and label the analyze action `この共有を解析`.
- Analyze only after explicit user action; merely opening a share page does not recursively enumerate the share.
- After analysis, reuse the existing all-files / selected-files Queue flow.

### 2. Storage/manual mode

Matched page:

- `https://disk.linkex.io/*`

Behavior remains backward compatible:

- Keep the manual share URL field.
- Keep `共有リンクを解析`.
- A manually supplied `https://l2e.click/d/...` URL or bare token is accepted as before.
- While on this origin, synchronize the currently logged-in access token into the userscript-private credential bridge described below.

## Share target detection

A page is considered a share page only when all of the following are true:

- protocol is `https:`;
- hostname is `l2e.click` or `www.l2e.click`;
- pathname matches `/d/<token>`;
- token matches the existing safe character set `[A-Za-z0-9_-]+`.

Manual parsing stays backward compatible. Page-context detection is deliberately host-restricted so an unrelated site with a `/d/...` path cannot silently become the active share source.

## Credential bridge

### Problem

The existing authenticated COPY/list/delete operations discover the Linkex bearer token from `disk.linkex.io` localStorage. `l2e.click` is a different origin, so a share-page userscript cannot read that localStorage.

### Design

Use Tampermonkey GM storage as a userscript-private bridge:

- On `disk.linkex.io`, read credentials using the existing localStorage discovery logic.
- Cache only the access token plus metadata (`cachedAt`, optional token expiry if safely derivable).
- Never persist the refresh token in the bridge.
- On `l2e.click`, never trust page localStorage for Linkex account credentials; read only the bridge created from `disk.linkex.io`.
- Prefer a fresh `disk.linkex.io` localStorage credential over a cached bridge credential.
- Reject/clear an expired cache entry.
- When the disk page has settled and no login credential exists, clear the bridge so logout does not leave a long-lived usable token.

The token is not exported in support bundles. Existing redaction remains in force.

### First-use / expired-token UX

If share-page mode has no usable bridged credential, analysis still works because share reads are unauthenticated. Queue start/resume must stop before destructive work and explain:

`Linkexログイン情報を利用できません。disk.linkex.ioへログインした状態で一度ページを開き、この共有ページへ戻ってください。`

No refresh-token automation is added in this feature.

## CDN download behavior

The current downloader uses native streaming `fetch()` for signed CDN URLs so large files are not buffered in userscript memory. Share-page mode keeps this mechanism unchanged.

Because CDN behavior can vary by origin, real-device acceptance must explicitly verify native CDN download, Range resume, and 403 URL refresh while the top-level page is `l2e.click`.

If CDN CORS prevents share-page streaming in the real environment, do not replace it with a whole-file `GM_xmlhttpRequest` buffer. The fallback design would instead move execution back to a `disk.linkex.io` worker context while retaining share-page control. That fallback is intentionally not implemented until evidence requires it.

## SPA / URL changes

Linkex share pages may navigate without a full reload. The userscript therefore watches `location.href` at a low frequency rather than monkey-patching site history methods.

When the current share token changes:

- If no Queue is running, invalidate an analyzed manifest belonging to the old token, clear selection, and disable start actions until the new share is analyzed.
- If a Queue is running, do not mutate the active Queue or its in-memory job. The Queue remains bound to `job.shareToken` captured at Queue creation.
- After the run reaches a safe completion/pause boundary, page-context synchronization may invalidate the old manifest.

This prevents a navigation from share A to share B from causing share B UI to start with share A's manifest.

## UI state

New page-context element:

- Share page: `このページの共有: <short token>`
- Storage/manual page: hidden.

Analyze button:

- Share page: `この共有を解析`
- Storage/manual page: `共有リンクを解析`

URL field:

- Share page with a valid token: hidden; source is current page URL.
- Other supported pages: shown as today.

Queue controls are unchanged.

## Safety invariants

This feature must preserve all existing invariants:

1. Lease is acquired before shared Queue mutation.
2. COPY/DELETE writes are never blindly retried.
3. Ownership is confirmed before download/delete.
4. `LOCAL_COMMITTED` is required before delete.
5. DELETE remains exactly one owned `destId` with `select_all:false`.
6. Route/page changes never rewrite `job.shareToken` of an existing Queue.
7. A missing/stale authenticated credential fails closed; it never falls back to an unauthenticated write.
8. v1.1.0 fixed release artifacts remain byte-for-byte unchanged.

## Tests

Add regression coverage for:

- userscript metadata matches `l2e.click/d/*` and optional `www` host;
- host-restricted current-page share detection;
- existing manual `parseShareToken()` behavior;
- disk-origin credential caching;
- l2e-origin credential resolution from GM bridge rather than l2e localStorage;
- expired cache rejection;
- page-mode UI labels/field visibility structure;
- route-change logic invalidates stale manifest only while not running;
- active Queue remains bound to its stored `shareToken`;
- all existing regression tests continue to pass.

## Release scope

Develop on `feat/share-page-mode`. Keep the current source version at v1.1.0 during feature development; version metadata and fixed v1.2.0 release artifacts are created only during a later release-preparation step.
