# Sheetnote

Sheetnote creates a separate entry form for a Google Sheets tab. It reads the tab's first row as headers and appends submitted values to that same tab. Suggestions come from existing rows; users can enter new values. Each linked item stores one spreadsheet ID and tab ID/title in this browser's local storage. Sheet contents, rows, and OAuth tokens are not saved locally. Entries use the Google Sheets API with `RAW` input and a UTC ISO-8601 timestamp from the client clock at submission. Offline mode is viewing-only; submissions are not queued.

## Requirements and commands

Install Node.js 20.19+ or 22.12+ (Vite 6 requirement) and npm. In PowerShell:

```powershell
cd S:\Projects\sheets-quick-notes
npm install
Copy-Item .env.example .env.local
# Edit .env.local and set your Google browser client ID
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

The app requests the `https://www.googleapis.com/auth/spreadsheets` scope. This grants access to spreadsheets the signed-in user can access, including editing their contents; it does not request Drive listing or search permissions. The full Sheets scope may trigger OAuth verification or restricted-scope review when publishing broadly. Requirements and possible personal-use/testing exceptions depend on Google's current policies and distribution; approval or an exemption is not guaranteed. Check current Google OAuth verification guidance before public distribution. This app does not integrate with Notion.

## Spreadsheet format

Each tab must have one header row in row 1, with nonblank unique headers (case-insensitive) and exactly one `Timestamp` header. Do not leave blank columns inside the header layout. Add at least one other header to create an input field. Example:

| Title | Note | Timestamp |
| --- | --- | --- |
| Follow-up | Ask about the draft | 2026-06-20T14:32:10.123Z |

Timestamp can appear in any column. The app inserts the UTC timestamp at submission; it uses the device's client clock. Values are sent as `RAW`, so entries are not interpreted as formulas. A user must grant the app access to the spreadsheet and have permission to edit it.

Saved links are browser-local metadata. To link another tab, add that tab as a separate linked item; each item's form and suggestions are scoped to its own spreadsheet and tab. Clearing this browser's site storage removes the saved links, not spreadsheet content.

## Verification

`npm run test` exercises spreadsheet ID parsing, header validation, quoted ranges, response parsing and API errors. `npm run build` type-checks and produces the production bundle. No offline submission queue or automatic retry is used; if an append reports an error, inspect the sheet before trying again because Google may have received the request.
