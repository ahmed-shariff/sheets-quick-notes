import type { GoogleApiError, SpreadsheetInfo, TableData } from "./types";

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: {
      initTokenClient(options: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: { type?: string; message?: string }) => void }): { requestAccessToken(options?: { prompt?: string }): void };
      revoke(token: string, callback: () => void): void;
    } } };
  }
}
interface TokenResponse { access_token?: string; expires_in?: string | number; error?: string; error_description?: string }
interface SheetsSpreadsheet { spreadsheetId: string; properties?: { title?: string }; sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }
interface SheetsValues { values?: unknown[][] }
const GIS_URL = "https://accounts.google.com/gsi/client";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
let clientId = "", tokenClient: { requestAccessToken(options?: { prompt?: string }): void } | undefined, accessToken: string | undefined, tokenExpiresAt = 0;
let pendingSignIn: (() => void) | undefined, pendingSignInReject: ((error: Error) => void) | undefined, loadScriptPromise: Promise<void> | undefined;
function authError(detail?: string): Error { return new Error(`Google authentication failed${detail ? ` (${detail})` : ""}. Check the OAuth client ID, enable the Google Sheets API, and authorize this account for the spreadsheet.`); }
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
export async function initializeGoogle(configuredClientId: string): Promise<void> {
  clientId = configuredClientId.trim(); if (!clientId) throw new Error("Google OAuth client ID is missing. Configure a browser OAuth client ID before using Google Sheets.");
  await loadGoogleIdentityServices();
  tokenClient = window.google!.accounts!.oauth2!.initTokenClient({ client_id: clientId, scope: SHEETS_SCOPE, callback: (response) => {
    if (response.error || !response.access_token) pendingSignInReject?.(authError(response.error_description || response.error));
    else { accessToken = response.access_token; tokenExpiresAt = Date.now() + Math.max(0, Number(response.expires_in) || 0) * 1000; pendingSignIn?.(); }
    pendingSignIn = undefined; pendingSignInReject = undefined;
  }, error_callback: (error) => { pendingSignInReject?.(authError(error.message || error.type)); pendingSignIn = undefined; pendingSignInReject = undefined; } });
}
export async function signIn(): Promise<void> {
  if (!clientId || !tokenClient) throw new Error("Google is not initialized. Call initializeGoogle(clientId) first.");
  if (accessToken && tokenExpiresAt > Date.now()) return;
  return new Promise<void>((resolve, reject) => { pendingSignIn = resolve; pendingSignInReject = reject; try { tokenClient!.requestAccessToken({ prompt: "" }); } catch (error) { pendingSignIn = undefined; pendingSignInReject = undefined; reject(authError(error instanceof Error ? error.message : String(error))); } });
}
export function signOut(): void { const token = accessToken; accessToken = undefined; tokenExpiresAt = 0; if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => undefined); }
export function parseSpreadsheetId(input: string): string {
  const value = input.trim(); const match = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:\/|$)/i.exec(value);
  const id = match?.[1] ?? (value.includes(":") || value.includes("/") ? "" : value);
  if (!id || !/^[\w-]+$/.test(id)) throw new Error("Enter a valid Google Sheets URL or spreadsheet ID."); return id;
}
async function sheetsRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken || tokenExpiresAt <= Date.now()) { accessToken = undefined; tokenExpiresAt = 0; throw authError("sign in again to continue"); }
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } }); }
  catch (error) { throw new Error(`Network request failed; check your connection. ${error instanceof Error ? error.message : ""}`); }
  const body = await response.json().catch(() => ({})) as GoogleApiError;
  if (!response.ok) { if (response.status === 401) { accessToken = undefined; tokenExpiresAt = 0; throw authError(body.error?.message || "token expired; sign in again"); } const reason = body.error?.errors?.[0]?.reason, message = body.error?.message || response.statusText; throw new Error(`Google Sheets API error (${response.status}${reason ? `, ${reason}` : ""}): ${message}`); }
  return body as T;
}
export async function getSpreadsheet(input: string): Promise<SpreadsheetInfo> {
  const id = parseSpreadsheetId(input), fields = encodeURIComponent("spreadsheetId,properties(title),sheets(properties(sheetId,title))");
  const result = await sheetsRequest<SheetsSpreadsheet>(`${SHEETS_API}/${encodeURIComponent(id)}?fields=${fields}`);
  return { id: result.spreadsheetId, title: result.properties?.title || "", tabs: (result.sheets || []).flatMap((sheet) => { const p = sheet.properties; return p?.sheetId !== undefined && p.title !== undefined ? [{ id: p.sheetId, title: p.title }] : []; }) };
}
function quoteTabTitle(title: string): string { return `'${title.replace(/'/g, "''")}'`; }
function stringCell(value: unknown): string { return value === null || value === undefined ? "" : typeof value === "string" ? value : String(value); }
export async function getTableData(spreadsheetId: string, tabTitle: string): Promise<TableData> {
  const range = `${quoteTabTitle(tabTitle)}!1:ZZZ`, result = await sheetsRequest<SheetsValues>(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`);
  const values = result.values || [], headers = (values[0] || []).map(stringCell), width = headers.length;
  const rows = values.slice(1).map((row) => Array.from({ length: width }, (_, i) => stringCell(row[i])));
  while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) rows.pop(); return { headers, rows };
}
export function validateHeaders(headers: string[]): string | null {
  if (!headers.length || headers.every((header) => !header.trim())) return "The first row is empty. Add column headers, including exactly one Timestamp header.";
  if (headers.some((header) => !header.trim())) return "Column headers cannot be empty; internal blank columns are not supported.";
  const normalized = headers.map((header) => header.trim().toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) return "Column headers must be unique (case-insensitive). Remove or rename duplicate headers.";
  if (normalized.filter((header) => header === "timestamp").length !== 1) return "Add exactly one column named Timestamp (case-insensitive) to the first row of the sheet.";
  return null;
}
export async function appendEntry(spreadsheetId: string, tabTitle: string, values: string[]): Promise<void> {
  const data = await getTableData(spreadsheetId, tabTitle), validation = validateHeaders(data.headers); if (validation) throw new Error(validation);
  const timestampIndex = data.headers.findIndex((header) => header.trim().toLocaleLowerCase() === "timestamp"), entry = [...values];
  while (entry.length < data.headers.length) entry.push(""); entry.length = data.headers.length; entry[timestampIndex] = new Date().toISOString();
  const range = `${quoteTabTitle(tabTitle)}!A1`;
  await sheetsRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: [entry] }) });
}
