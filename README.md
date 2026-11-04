# Sheetnote

Sheetnote is a Google Apps Script web app that builds quick entry forms from Google Sheets tabs. The Apps Script server opens and edits spreadsheets as the user accessing the deployed app. **Never deploy this shared app to execute as its owner**: that would let visitors write with the owner's authority.

## Build and deploy

Requires Node.js and npm. From Windows PowerShell:

```powershell
cd D:\Projects\sheets-quick-notes
npm install
npm run build
npm test
```

`npm run build` creates three deployable files in `dist/`: `Code.gs`, `Index.html`, and `appsscript.json`. `npm run dev` and `npm run preview` explain that the app requires the Apps Script runtime; there is no misleading local browser preview.

1. Create a **new standalone Apps Script project** at script.google.com. Copy the generated `Code.gs` into `Code.gs`, `Index.html` into an HTML file named `Index`, and the generated manifest into `appsscript.json` (enable **Project Settings → Show "appsscript.json" manifest file** first).
2. In **Deploy → New deployment → Web app**, set **Execute as: User accessing the web app**. Do not select owner/me. Choose who can access the deployment. Broad access can be constrained by Workspace administrator policy; users may be asked to authorize the app and need edit rights on the target sheet.
3. Deploy and test using an account that can edit a test spreadsheet. Read the displayed authorization prompt carefully. Apps Script authorization UI and organization policies vary; the manifest cannot guarantee that a deployment is available to every Google account.
4. After changes, rebuild, copy all three generated files, then use **Deploy → Manage deployments → Edit** and select a new version. Updating source alone does not update an existing versioned deployment.

The generated manifest explicitly requests the Google Sheets scope, which is required for `SpreadsheetApp.openById` to open user-linked spreadsheets. Each accessing user authorizes that permission; no browser OAuth client ID, API key, or client secret is needed. The deployment must execute as that accessing user: each viewer then sees only spreadsheets they themselves can access. Web-app access selections such as anyone, anyone in an organization, or only yourself control who can open the app, not which sheets its code can access.

## Use and data contract

Paste a Google Sheets URL or spreadsheet ID, then select one of its tabs. Each tab needs a row-one header layout with nonblank, case-insensitively unique names and exactly one `Timestamp` header. The app reads up to 1,000 data rows as display strings for suggestions. On save, the server revalidates the current headers to prevent writing against a changed schema and generates a UTC ISO-8601 timestamp on the server. It serializes appends with a script lock. A lock timeout fails without retry. A network/Apps Script error can still occur after a write reached the sheet: inspect the sheet before trying again. Failed writes leave the entered values in the form.

Values are treated as text. For every non-timestamp value, the server prefixes an apostrophe before writing with `setValues`; this includes values with leading whitespace/control characters and values that already begin with apostrophes. Apps Script/Sheets treats that leading apostrophe as a text-entry escape, preserving the value as text rather than evaluating formula markers. Timestamps are generated separately and are not prefixed. Header and value sizes are bounded in server code.

Saved spreadsheet/tab links live in this browser's local storage under a namespace returned by Apps Script for the accessing user. This separates users of the deployed app within the same browser profile; it is not isolation between browser profiles or devices. No access tokens, rows, or submissions are persisted by the app; Google Sheets remains the record of submitted entries. **Clear local links** removes the saved link metadata in this namespace only; it does not delete sheet data, sign out of Google, or revoke Google authorization. The server does not store rows or link metadata. The accessing user grants the app spreadsheet access through Apps Script authorization; unlike the old `drive.file` Picker design, this is broader spreadsheet access under the user's Google authorization, not a per-selected-file `drive.file` boundary. Review the authorization prompt and use an account with suitable access.

This is not a PWA and has no offline or queued submissions. Google Apps Script execution quotas, simultaneous execution limits, authorization behavior, and account/admin restrictions apply; check Google's current Apps Script quotas. Live Apps Script authorization and deployment behavior cannot be fully tested by the local automated suite.

## Checks

Run `npm run build` before `npm test`: artifact checks inspect the generated `dist/` files and do not build them. `npm test` runs the Node.js tests in `tests/*.test.mjs` and validates that the build contains all three files, the server has locking/timestamp/display-value contracts, and the client bridge is present without browser OAuth. The checks inspect source and generated files; they do not invoke Google's live services.
