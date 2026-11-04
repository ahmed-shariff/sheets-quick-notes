# Sheetnote

Sheetnote creates a separate entry form for a Google Sheets tab. It reads the tab's first row as headers and appends submitted values to that same tab. Suggestions come from existing rows; users can enter new values. Each linked item stores one spreadsheet ID and tab ID/title in this browser's local storage. Sheet contents, rows, and OAuth tokens are not saved locally. Entries use the Google Sheets API with `RAW` input and a UTC ISO-8601 timestamp from the client clock at submission. Offline mode is viewing-only; submissions are not queued.

## Requirements and commands

Install Node.js 20.19+ or 22.12+ (Vite 6 requirement) and npm. In PowerShell:

```powershell
cd S:\Projects\sheets-quick-notes
npm install
Copy-Item .env.example .env.local
# Edit .env.local and set the Google browser client ID, API key, and Cloud project number
npm run dev -- --host 0.0.0.0 --port 5173
npm run test
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

Open `http://localhost:5173` on the development computer. Set the same origin and port in Google Cloud. Do not change the port unless you update Authorized JavaScript origins. Production hosting must use HTTPS and its exact origin must also be authorized.

For Android on a LAN, serve the development app from the computer's LAN address and access that address from Android. Google OAuth requires a secure context: plain HTTP on a LAN IP is generally not secure. Use a trusted HTTPS development tunnel/host with that exact HTTPS origin configured, or test on localhost on the same device. Do not assume an arbitrary LAN HTTP address works for Google sign-in.

## Google Cloud setup

1. Create or select a Google Cloud project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen, including the application name and required contact details. While the consent screen is in Testing, add each account that will sign in as a test user. Testing-mode refresh/access behavior may require signing in again.
3. Create an OAuth client ID of type **Web application**. Add `http://localhost:5173` under Authorized JavaScript origins for local development and the exact deployed HTTPS origin (for example, `https://notes.example.com`) for production. Origins have no path. Add no client secret to this browser application.
4. Copy the client ID into `.env.local` as `VITE_GOOGLE_CLIENT_ID=...`, then restart Vite. A Google client ID is public configuration, not a secret. Never put a client secret or access token in the repository.

The app requests `https://www.googleapis.com/auth/drive.file` and uses Google Picker to select one Google Sheets file at a time. This grants the app access only to files the user selects or creates with the app; it does not grant access to all accessible spreadsheets or list/search Drive. Permission is per spreadsheet file, not per tab. Each linked tab in a file uses that same file-level grant. Removing a link only removes local metadata; it does not revoke Google's grant. The app does not request the broad Sheets scope.

In Google Cloud, enable both the Google Sheets API and Google Picker API. Create an API key, restrict it to the app's website origins and the required Google Picker/Sheets APIs, and set it as `VITE_GOOGLE_API_KEY`. Set `VITE_GOOGLE_APP_ID` to the numeric Cloud project number (not project name or OAuth client ID), in the same project used for the API key. Keep the OAuth client ID, API key, and project number in one project. OAuth uses the existing Web application client and authorized origins described above. The API key and project number are public browser configuration; never add a client secret.

## Content security policy

The static `index.html` applies a CSP for GIS and Google Picker, including the Picker loader (`https://apis.google.com/js/api.js`) and its Google-hosted frames, scripts, styles, images, and API connections. Google may change Picker resource hosts; if the dialog fails under CSP, inspect browser console violations and update the policy to include the actual documented Google endpoints. Deployments with additional asset hosts or a host-managed CSP must merge the listed Google endpoints with their policy. A meta CSP cannot set every directive (notably `frame-ancestors` and reporting). Configure `Content-Security-Policy` as an HTTP response header with `frame-ancestors 'none'` (or the deployment's intended embedding policy); `frame-ancestors` is deliberately omitted from the meta policy. The policy permits inline styles for the current UI.

## Spreadsheet format

Each tab must have one header row in row 1, with nonblank unique headers (case-insensitive) and exactly one `Timestamp` header. Do not leave blank columns inside the header layout. Add at least one other header to create an input field. Example:

| Title | Note | Timestamp |
| --- | --- | --- |
| Follow-up | Ask about the draft | 2026-06-20T14:32:10.123Z |

Timestamp can appear in any column. The app inserts the UTC timestamp at submission; it uses the device's client clock. Values are sent as `RAW`, so entries are not interpreted as formulas. A user must grant the app access to the spreadsheet and have permission to edit it.

Saved links are browser-local metadata. Selecting a spreadsheet links its first tab; the current UI does not offer a tab selector. Each item's form and suggestions are scoped to that tab, but Google grants access to the whole spreadsheet file. Clearing this browser's site storage removes the saved links, not spreadsheet content.

## Verification

`npm run test` exercises authentication concurrency and callback invalidation, revocation outcomes, spreadsheet ID parsing, header validation, quoted ranges, response parsing and API errors. Google Picker requires browser credentials and user interaction; its live OAuth/Picker flow must be tested in a configured browser. `npm run build` type-checks and produces the production bundle. No offline submission queue or automatic retry is used; if an append reports an error, inspect the sheet before trying again because Google may have received the request.
