---
name: google-sheets-entry-apps-script
description: Build and maintain Google Apps Script web apps for quick entry into user-linked Google Sheets.
---

# Google Sheets entry Apps Script web apps

Use this skill when the UI should be hosted by Google Apps Script and use Apps Script services to access linked Sheets. This architecture is distinct from a browser OAuth/PWA: do not retain GIS token flows, Sheets API browser calls, service workers, or PWA claims unless explicitly required for a separate deployment.

## Architecture

- Serve the UI through HtmlService. The browser calls server functions through `google.script.run`; wrap calls with success and failure handlers in a Promise adapter.
- For user-linked spreadsheets, deploy as **User accessing the web app**. Never deploy shared access as the script owner unless an explicit design securely constrains owner-authorized operations. Treat deployment audience and spreadsheet authorization as separate controls.
- Use `SpreadsheetApp.openById` for supplied spreadsheet IDs, and include the full `https://www.googleapis.com/auth/spreadsheets` scope when the manifest pins scopes. `spreadsheets.currentonly` does not cover arbitrary linked IDs.
- A pasted spreadsheet URL/ID plus tab selection avoids the additional Google Picker/API-key setup. Resolve a tab by stable numeric sheet ID, not only its mutable title. Recheck access and schema on every operation; saved links are metadata, not authorization grants.
- Keep spreadsheet rows and credentials out of browser storage. Persist only link metadata. If multiple Google users may share one browser profile, derive a stable opaque namespace on the server via `UserProperties`; do not trust a client-supplied email or identity as authorization. Explain that local browser profiles/devices remain separate.
- Build forms from a unique, nonblank first-row header schema with exactly one `Timestamp` column. Exclude timestamp from user fields; provide autocomplete from existing nonempty column values while allowing free-form entries.
- Generate timestamps on the server in UTC ISO format. Validate headers again immediately before writes so schema changes cannot silently misplace values.
- Serialize writes with a script lock and release in `finally`. A script lock does not coordinate with external editors or other script projects. Do not automatically retry ambiguous append failures; preserve entered values and tell the user to inspect the sheet. After confirmed append, treat refresh failure as refresh failure, not write failure.
- Choose a write method and escaping policy that makes user input literal text rather than executable spreadsheet formulas. Test formula-like values including leading whitespace/control characters and leading apostrophes; document any escaping representation.

## Client state and safety

- Capture the selected spreadsheet/tab and request generation when starting asynchronous reads or link lookups. Ignore stale successes and stale failures after selection changes or clear/reset.
- While a write is active, disable link selection/removal, tab selection, and conflicting actions. Preserve drafts on failures; clear them only after confirmed successful append.
- Provide a visible local-clear action. It clears link metadata, rows, suggestions, form values, and pending client state; it is not Google sign-out, grant revocation, sheet deletion, or cancellation of an accepted write.
- Escape spreadsheet-derived text before rendering; do not insert it as trusted HTML.
- Apps Script HtmlService has a sandbox and deployment behavior not reproduced by Node tests. Verify inline client execution and the complete authorization/read/write flow in a deployed browser.

## Build and validation

- Package HtmlService HTML, inline CSS/client JavaScript, `.gs` server code, and manifest into a clear deployable output directory. Reject unsafe script/style closing sequences in source embedded into HTML; clean generated output before rebuilding to avoid stale deployable artifacts.
- Document manual deployment: copy generated files to a standalone Apps Script project, enable the manifest editor, deploy as the accessing user, choose the intended audience, and publish a new version after updates.
- Unit tests should mock Apps Script services and cover namespace behavior, access/tab resolution, header validation, stale-schema rejection, timestamp placement, literal writes, lock release, client RPC failures, and no retry. Build checks should verify deployable artifacts and ensure obsolete browser OAuth/PWA artifacts are not included.
- Run build before artifact tests, then tests and diff whitespace checks. Report that mocks/build checks do not validate real Apps Script scopes, authorization prompts, quotas, or deployment behavior.

## Current repository implementation

See the repository README for the validated build/deploy workflow. Current build command is `npm run build`, producing `dist/Code.gs`, `dist/Index.html`, and `dist/appsscript.json`; run it before `npm test`. The app is not a PWA. Its server uses `USER_ACCESSING`, full Sheets scope, per-user opaque local-storage namespace, URL/ID linking, tab selection, header-driven forms, autocomplete, and server UTC timestamps.
