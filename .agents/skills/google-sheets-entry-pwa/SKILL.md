---
name: google-sheets-entry-pwa
description: Build and maintain a browser PWA for quick entry into user-linked Google Sheets.
---

# Google Sheets entry PWA

Use this skill when implementing or extending a standalone PWA that treats linked Google Sheets as the source of truth and provides quick-entry forms.

## Architecture

- Keep the app client-side when requirements do not need a backend. Authenticate with Google Identity Services and call the Sheets API using an access token held only in memory.
- Request the Sheets scope only when users explicitly link spreadsheets by URL or ID; avoid Drive listing scopes.
- Persist only spreadsheet/tab metadata in browser storage. Do not persist tokens, retrieved rows, or form submissions outside Sheets.
- Map each saved table to a spreadsheet ID and tab ID/title. Populate a form from the tab's first-row headers.
- Build autocomplete suggestions from existing non-empty values in the corresponding column. Keep inputs free-form so users can add new values.
- Require a single designated timestamp header and generate its value at submission time. Document whether timestamps use the client clock and UTC representation.
- Append with explicit value input mode and insert-row behavior. Never blindly retry an append after ambiguous network failure; duplicates may result.
- Treat offline support as app-shell availability only. Do not queue writes or claim that Sheets data is available offline.

## Implementation and validation sequence

1. Inspect the repository and existing integration exports before delegating or writing UI code. Agree on function signatures and ownership boundaries between integration, UI, docs, and tests.
2. Implement spreadsheet URL parsing, tab discovery, header validation, row retrieval, range quoting, and append behavior in a separable integration module.
3. Implement the responsive form UI with captured table identity for asynchronous operations. Ignore stale read results after selection changes; a submission must always target the table captured when it began. Prevent conflicting table changes/removal during writes.
4. Keep error paths actionable and preserve user-entered values after failed submissions. Clear/reset only after confirmed success. Allow recovery from expired/invalid authentication by returning the UI to a sign-in state.
5. Render spreadsheet-derived text as text, not HTML. Check online status before reads/writes, but treat API errors as authoritative.
6. Configure a PWA manifest and app-shell-only service worker. Do not cache Google/API responses or force page activation/reload during an active session. Include valid raster icons at the declared sizes for installability.
7. Document OAuth client setup, authorized origins, Sheets API enablement, deployment HTTPS requirements, spreadsheet header contract, permissions, privacy/storage, and the lack of offline submission. Explain why URL/ID linking requires the broad Sheets scope if per-file authorization is not used.
8. Define CSP with the GIS-compatible script, style, connection, and frame origins actually required by the integration. A static meta policy is a fallback: `frame-ancestors` and reporting need HTTP response headers. Document hosting-specific policy requirements and test the production app's OAuth loading under the policy.
9. Treat authentication and logout as asynchronous state transitions. Permit one token request at a time; invalidate callbacks and pending initialization when signing out or changing OAuth clients. Local logout must synchronously discard tokens and private UI data. Do not let late sheet reads, link lookups, or post-write refreshes repopulate signed-out state. Do not imply that an already-issued append was cancelled.
10. Keep local sign-out distinct from Google grant revocation. Check the GIS revoke callback, handle synchronous failure and missing callbacks with a bounded timeout, and report unconfirmed revocation without retaining the local token.
11. Test authentication through mocked Identity Services callbacks, including overlap, stale callbacks, client reinitialization, sign-out cancellation, and revoke success/failure. Mock Sheets API calls to verify range encoding, append payload, input mode, timestamp, and error handling. Run tests, production build, and diff whitespace checks. State clearly whether browser/OAuth flows were actually exercised.

## Project contract

The current implementation uses Vite and TypeScript, with integration exports in `src/google.ts` and data types in `src/types.ts`. Each linked sheet tab requires a unique, nonblank header row with exactly one `Timestamp` column. The app appends timestamp values in UTC ISO format. Consult the repository README and implementation before changing this contract; update tests and documentation together.
