import { afterEach, describe, expect, it, vi } from "vitest";
import { appendEntry, getTableData, initializeGoogle, parseSpreadsheetId, signIn, validateHeaders } from "./google";

async function authenticateWithGoogle(): Promise<void> {
  let callback: ((response: { access_token: string; expires_in: string }) => void) | undefined;
  vi.stubGlobal("window", { google: { accounts: { oauth2: {
    initTokenClient: vi.fn((options: { callback: typeof callback }) => { callback = options.callback; return { requestAccessToken: vi.fn(() => callback?.({ access_token: "test-token", expires_in: "3600" })) }; }),
    revoke: vi.fn(),
  } } } });
  await initializeGoogle("test-client.apps.googleusercontent.com");
  await signIn();
}

describe("Google Sheets integration", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("accepts spreadsheet IDs and full URLs, rejects malformed URLs", () => {
    expect(parseSpreadsheetId("abc_123-x")).toBe("abc_123-x");
    expect(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/abc_123-x/edit#gid=1")).toBe("abc_123-x");
    expect(() => parseSpreadsheetId("https://example.org/spreadsheets/d/abc")).toThrow();
    expect(() => parseSpreadsheetId("https://docs.google.com/spreadsheets/d/")).toThrow();
  });
  it("rejects internal blanks, duplicate headers and missing timestamps", () => {
    expect(validateHeaders(["Title", "", "Timestamp"])).toMatch(/empty/);
    expect(validateHeaders(["Title", "title", "Timestamp"])).toMatch(/unique/);
    expect(validateHeaders(["Title", "Body"])).toMatch(/Timestamp/);
    expect(validateHeaders(["Title", "Timestamp"])).toBeNull();
  });
  it("parses values response and quotes apostrophes in a sheet title", async () => {
    await authenticateWithGoogle();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ values: [["Title", "Timestamp"], ["Prior", "2024"]] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await getTableData("spreadsheet", "O'Brien");
    expect(data).toEqual({ headers: ["Title", "Timestamp"], rows: [["Prior", "2024"]] });
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain("'O''Brien'!1:ZZZ");
  });
  it("surfaces API errors without retrying", async () => {
    await authenticateWithGoogle();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "denied", errors: [{ reason: "forbidden" }] } }), { status: 403, statusText: "Forbidden" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getTableData("id", "Sheet")).rejects.toThrow(/403, forbidden.*denied/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires an active Google token for writes", async () => {
    await expect(appendEntry("id", "Sheet", ["value", ""])).rejects.toThrow(/authentication failed/i);
  });
});
