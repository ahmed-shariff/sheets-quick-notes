import type { GoogleApiError, SpreadsheetInfo, TableData } from "./types";

declare global {
    interface Window {
        gapi?: { load(name: string, options?: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void };
        google?: {
            picker?: { PickerBuilder: new () => PickerBuilder; DocsView: new (viewId: string) => { setMimeTypes(types: string): unknown }; ViewId: { SPREADSHEETS: string }; Action: { PICKED: string; CANCEL: string }; Response: { ACTION: string; DOCUMENTS: string }; Document: { ID: string } };
            accounts?: { oauth2?: {
                initTokenClient(options: { client_id: string; scope: string; include_granted_scopes?: boolean; callback: (response: TokenResponse) => void; error_callback?: (error: { type?: string; message?: string }) => void }): { requestAccessToken(options?: { prompt?: string }): void };
                revoke(token: string, callback: (response?: { successful?: boolean; error?: string }) => void): void;
            } };
        };
    }
}

interface TokenResponse { access_token?: string; expires_in?: string | number; error?: string; error_description?: string }
interface PickerBuilder { addView(view: unknown): PickerBuilder; setAppId(id: string): PickerBuilder; setDeveloperKey(key: string): PickerBuilder; setOAuthToken(token: string): PickerBuilder; setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder; enableFeature(feature: unknown): PickerBuilder; setMaxItems(count: number): PickerBuilder; build(): { setVisible(visible: boolean): void; dispose?(): void } }
interface PickerPending { resolve: (id: string | null) => void; reject: (error: Error) => void; picker?: { setVisible(visible: boolean): void; dispose?(): void }; generation: number }
interface SheetsSpreadsheet { spreadsheetId: string; properties?: { title?: string }; sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }
interface SheetsValues { values?: unknown[][] }

const GIS_URL = "https://accounts.google.com/gsi/client";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PICKER_URL = "https://apis.google.com/js/api.js";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

let clientId = "", tokenClient: { requestAccessToken(options?: { prompt?: string }): void } | undefined, accessToken: string | undefined, tokenExpiresAt = 0;
let pendingSignIn: (() => void) | undefined, pendingSignInReject: ((error: Error) => void) | undefined, loadScriptPromise: Promise<void> | undefined, pickerScriptPromise: Promise<void> | undefined, pickerPending: PickerPending | undefined, pickerBusy = false, authGeneration = 0, clientGeneration = 0, initializedGeneration = -1, signInInFlight = false;

function authError(detail?: string): Error {
    return new Error(`Google authentication failed${detail ? ` (${detail})` : ""}. Check the OAuth client ID, enable the Google Sheets API, and authorize this account for the spreadsheet.`);
}

function loadGoogleIdentityServices(): Promise<void> {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (loadScriptPromise) return loadScriptPromise;

    loadScriptPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script"); script.src = GIS_URL; script.async = true; script.defer = true;
        script.onload = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error("Google Identity Services loaded without its OAuth token client."));
        script.onerror = () => reject(new Error(`Could not load Google Identity Services from ${GIS_URL}. Check your network or content security policy.`)); document.head.appendChild(script);
    }).catch((error: unknown) => { loadScriptPromise = undefined; throw error; });

    return loadScriptPromise;
}

function cancelPendingSignIn(): void {
    const reject = pendingSignInReject;
    signInInFlight = false;
    pendingSignIn = undefined;
    pendingSignInReject = undefined;
    reject?.(new Error("Google sign-in was cancelled because authentication was reset."));
}

export async function initializeGoogle(configuredClientId: string): Promise<void> {
    settlePicker(null);
    const requestedClientId = configuredClientId.trim();
    if (!requestedClientId)
        throw new Error("Google OAuth client ID is missing. Configure a browser OAuth client ID before using Google Sheets.");
    if (signInInFlight) {
        authGeneration++; cancelPendingSignIn();
    }
    const generation = authGeneration, clientEpoch = ++clientGeneration;
    if (requestedClientId !== clientId) {
        accessToken = undefined; tokenExpiresAt = 0;
    }

    clientId = requestedClientId;
    await loadGoogleIdentityServices();

    if (generation !== authGeneration || clientEpoch !== clientGeneration)
        throw new Error("Google initialization was cancelled by a newer authentication action.");

    tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
        client_id: requestedClientId, scope: SHEETS_SCOPE, include_granted_scopes: false, callback: (response) => {
            if (generation !== authGeneration || clientEpoch !== clientGeneration || !signInInFlight) return;
            signInInFlight = false;
            if (response.error || !response.access_token) pendingSignInReject?.(authError(response.error_description || response.error));
            else { accessToken = response.access_token; tokenExpiresAt = Date.now() + Math.max(0, Number(response.expires_in) || 0) * 1000; pendingSignIn?.(); }
            pendingSignIn = undefined; pendingSignInReject = undefined;
        }, error_callback: (error) => { if (generation !== authGeneration || clientEpoch !== clientGeneration || !signInInFlight) return; signInInFlight = false; pendingSignInReject?.(authError(error.message || error.type)); pendingSignIn = undefined; pendingSignInReject = undefined; }
    });
    initializedGeneration = authGeneration;
}

export async function signIn(): Promise<void> {
    if (signInInFlight) throw new Error("Google sign-in is already in progress.");
    if (!clientId || !tokenClient || initializedGeneration !== authGeneration)
        throw new Error("Google is not initialized for the current session. Call initializeGoogle(clientId) before signing in.");
    if (accessToken && tokenExpiresAt > Date.now()) return;
    return new Promise<void>((resolve, reject) => {
        signInInFlight = true;
        pendingSignIn = resolve;
        pendingSignInReject = reject;
        try {
            tokenClient!.requestAccessToken({ prompt: "" });
        } catch (error) {
            signInInFlight = false;
            pendingSignIn = undefined;
            pendingSignInReject = undefined;
            reject(authError(error instanceof Error ? error.message : String(error)));
        }
    });
}

export async function signOut(): Promise<{ revoked: boolean }> {
    const token = accessToken;
    authGeneration++;
    clientGeneration++;
    initializedGeneration = -1;
    tokenClient = undefined;
    cancelPendingSignIn();
    settlePicker(null);
    accessToken = undefined;
    tokenExpiresAt = 0;
    if (!token || !window.google?.accounts?.oauth2)
        return { revoked: false };
    return new Promise((resolve) => {
        let settled = false;
        const finish = (revoked: boolean) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve({ revoked });
            }
        };
        const timeout = setTimeout(() => finish(false), 5000);
        try {
            window.google!.accounts!.oauth2!.revoke(token, (response) => finish(response?.successful === true));
        } catch {
            finish(false);
        }
    });
}

function settlePicker(id: string | null, error?: Error): void {
    const pending = pickerPending;
    if (!pending) return;
    pickerPending = undefined; pickerBusy = false;
    try { pending.picker?.setVisible(false); pending.picker?.dispose?.(); } catch { /* Picker may already be disposed. */ }
    if (error) pending.reject(error); else pending.resolve(id);
}

function loadGooglePicker(): Promise<void> {
    if (window.google?.picker && window.gapi?.load) return Promise.resolve();
    if (pickerScriptPromise) return pickerScriptPromise;
    pickerScriptPromise = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${PICKER_URL}"]`);
        const script = existing || document.createElement("script");
        let settled = false;
        const fail = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            script.remove();
            reject(new Error("Could not load Google Picker API. Check network and CSP."));
        };
        const timeout = setTimeout(fail, 15000);
        script.onload = () => {
            if (!window.gapi?.load) return fail();
            try {
                window.gapi.load("picker", { callback: () => { if (window.google?.picker && !settled) { settled = true; clearTimeout(timeout); resolve(); } else fail(); }, onerror: fail, ontimeout: fail, timeout: 10000 });
            } catch { fail(); }
        };
        script.onerror = fail;
        if (!existing) { script.src = PICKER_URL; script.async = true; script.defer = true; document.head.appendChild(script); }
        else if (window.gapi?.load) script.onload(new Event("load"));
    }).catch((error: unknown) => { pickerScriptPromise = undefined; throw error; });
    return pickerScriptPromise;
}

export async function pickSpreadsheet(apiKey: string, appId: string): Promise<string | null> {
    if (!apiKey.trim() || !appId.trim()) throw new Error("Configure VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID to use spreadsheet selection.");
    if (pickerBusy) throw new Error("A spreadsheet picker is already open.");
    if (!accessToken || tokenExpiresAt <= Date.now()) throw authError("sign in again to select a spreadsheet");
    const generation = authGeneration;
    let resolvePending!: (id: string | null) => void, rejectPending!: (error: Error) => void;
    const pending: PickerPending = { resolve: (id) => resolvePending(id), reject: (error) => rejectPending(error), generation };
    pickerPending = pending;
    pickerBusy = true;
    const result = new Promise<string | null>((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
    try {
        await loadGooglePicker();
        if (pickerPending !== pending || generation !== authGeneration || !accessToken) return result;
        try {
            const picker = new window.google!.picker!.PickerBuilder().addView(new window.google!.picker!.DocsView(window.google!.picker!.ViewId.SPREADSHEETS).setMimeTypes("application/vnd.google-apps.spreadsheet")).setMaxItems(1).setAppId(appId).setDeveloperKey(apiKey).setOAuthToken(accessToken!).setCallback((data) => {
                if (pickerPending !== pending || pending.generation !== authGeneration) return;
                const pickerApi = window.google!.picker!, action = data[pickerApi.Response.ACTION];
                if (action === pickerApi.Action.CANCEL) settlePicker(null);
                else if (action === pickerApi.Action.PICKED) {
                    const docs = data[pickerApi.Response.DOCUMENTS] as Array<Record<string, unknown>> | undefined;
                    const id = docs?.[0]?.[pickerApi.Document.ID];
                    if (typeof id === "string" && id) settlePicker(id); else settlePicker(null, new Error("Google Picker returned no spreadsheet ID."));
                }
            }).build();
            pending.picker = picker; picker.setVisible(true);
        } catch (error) { if (pickerPending === pending) settlePicker(null, error instanceof Error ? error : new Error(String(error))); }
    } catch (error) {
        if (pickerPending === pending) settlePicker(null, error instanceof Error ? error : new Error(String(error)));
    }
    return result;
}

export function parseSpreadsheetId(input: string): string {
    const value = input.trim();
    const match = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:\/|$)/i.exec(value);
    const id = match?.[1] ?? (value.includes(":") || value.includes("/") ? "" : value);
    if (!id || !/^[\w-]+$/.test(id)) throw new Error("Enter a valid Google Sheets URL or spreadsheet ID.");
    return id;
}

async function sheetsRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
    if (!accessToken || tokenExpiresAt <= Date.now()) {
        accessToken = undefined;
        tokenExpiresAt = 0;
        throw authError("sign in again to continue");
    }
    let response: Response;
    try {
        response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    }
    catch (error) {
        throw new Error(`Network request failed; check your connection. ${error instanceof Error ? error.message : ""}`);
    }
    const body = await response.json().catch(() => ({})) as GoogleApiError;
    if (!response.ok) {
        if (response.status === 401) {
            accessToken = undefined;
            tokenExpiresAt = 0;
            throw authError(body.error?.message || "token expired; sign in again");
        } const reason = body.error?.errors?.[0]?.reason, message = body.error?.message || response.statusText;
        throw new Error(`Google Sheets API error (${response.status}${reason ? `, ${reason}` : ""}): ${message}`);
    }
    return body as T;
}

export async function getSpreadsheet(input: string): Promise<SpreadsheetInfo> {
    const id = parseSpreadsheetId(input), fields = encodeURIComponent("spreadsheetId,properties(title),sheets(properties(sheetId,title))");
    const result = await sheetsRequest<SheetsSpreadsheet>(`${SHEETS_API}/${encodeURIComponent(id)}?fields=${fields}`);
    return {
        id: result.spreadsheetId, title: result.properties?.title || "", tabs: (result.sheets || []).flatMap((sheet) => {
            const p = sheet.properties;
            return p?.sheetId !== undefined && p.title !== undefined ? [{ id: p.sheetId, title: p.title }] : [];
        })
    };
}

function quoteTabTitle(title: string): string {
    return `'${title.replace(/'/g, "''")}'`;
}

function stringCell(value: unknown): string {
    return value === null || value === undefined ? "" : typeof value === "string" ? value : String(value);
}

export async function getTableData(spreadsheetId: string, tabTitle: string): Promise<TableData> {
    const range = `${quoteTabTitle(tabTitle)}!1:ZZZ`, result = await sheetsRequest<SheetsValues>(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`);
    const values = result.values || [], headers = (values[0] || []).map(stringCell), width = headers.length;
    const rows = values.slice(1).map((row) => Array.from({ length: width }, (_, i) => stringCell(row[i])));
    while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
    return { headers, rows };
}

export function validateHeaders(headers: string[]): string | null {
    if (!headers.length || headers.every((header) => !header.trim()))
        return "The first row is empty. Add column headers, including exactly one Timestamp header.";
    if (headers.some((header) => !header.trim()))
        return "Column headers cannot be empty; internal blank columns are not supported.";
    const normalized = headers.map((header) => header.trim().toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length)
        return "Column headers must be unique (case-insensitive). Remove or rename duplicate headers.";
    if (normalized.filter((header) => header === "timestamp").length !== 1)
        return "Add exactly one column named Timestamp (case-insensitive) to the first row of the sheet.";
    return null;
}

export async function appendEntry(spreadsheetId: string, tabTitle: string, values: string[]): Promise<void> {
    const data = await getTableData(spreadsheetId, tabTitle), validation = validateHeaders(data.headers);
    if (validation)
        throw new Error(validation);
    const timestampIndex = data.headers.findIndex((header) => header.trim().toLocaleLowerCase() === "timestamp"), entry = [...values];

    while (entry.length < data.headers.length)
        entry.push("");

    entry.length = data.headers.length;
    entry[timestampIndex] = new Date().toISOString();
    const range = `${quoteTabTitle(tabTitle)}!A1`;
    await sheetsRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
                        { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: [entry] }) });
}
