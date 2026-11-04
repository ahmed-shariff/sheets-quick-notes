import { afterEach, describe, expect, it, vi } from "vitest";
import { appendEntry, getTableData, initializeGoogle, parseSpreadsheetId, signIn, signOut, validateHeaders } from "./google";

function setup() {
  const clients: Array<{ callback: (response: { access_token?: string; expires_in?: string; error?: string }) => void; requestAccessToken: ReturnType<typeof vi.fn> }> = [];
  const revoke = vi.fn();
  vi.stubGlobal("window", { google: { accounts: { oauth2: {
    initTokenClient: vi.fn((options: { callback: typeof clients[number]["callback"] }) => { const client = { callback: options.callback, requestAccessToken: vi.fn() }; clients.push(client); return client; }), revoke,
  } } } });
  return { clients, revoke };
}
async function initialize(): Promise<void> { await initializeGoogle("test-client.apps.googleusercontent.com"); }

describe("Google Sheets integration", () => {
  afterEach(async () => {
    const revoke = typeof window === "undefined" ? undefined : window.google?.accounts?.oauth2?.revoke;
    if (revoke && vi.isMockFunction(revoke)) revoke.mockImplementation((_token: string, callback: (response: { successful: boolean }) => void) => callback({ successful: true }));
    await signOut();
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  it("accepts spreadsheet IDs and URLs and rejects malformed URLs", () => {
    expect(parseSpreadsheetId("abc_123-x")).toBe("abc_123-x");
    expect(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/abc_123-x/edit#gid=1")).toBe("abc_123-x");
    expect(() => parseSpreadsheetId("https://example.org/spreadsheets/d/abc")).toThrow();
    expect(() => parseSpreadsheetId("https://docs.google.com/spreadsheets/d/")).toThrow();
  });
  it("validates headers", () => {
    expect(validateHeaders(["Title", "", "Timestamp"])).toMatch(/empty/);
    expect(validateHeaders(["Title", "title", "Timestamp"])).toMatch(/unique/);
    expect(validateHeaders(["Title", "Body"])).toMatch(/Timestamp/);
    expect(validateHeaders(["Title", "Timestamp"])).toBeNull();
  });
  it("parses data and quotes apostrophes in tab names", async () => {
    const { clients } = setup(); await initialize(); const auth = signIn(); clients[0].callback({ access_token: "token", expires_in: "3600" }); await auth;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ values: [["Title", "Timestamp"], ["Prior", "2024"]] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    expect(await getTableData("spreadsheet", "O'Brien")).toEqual({ headers: ["Title", "Timestamp"], rows: [["Prior", "2024"]] });
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain("'O''Brien'!1:ZZZ");
  });
  it("surfaces API errors without retries", async () => {
    const { clients } = setup(); await initialize(); const auth = signIn(); clients[0].callback({ access_token: "token", expires_in: "3600" }); await auth;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "denied", errors: [{ reason: "forbidden" }] } }), { status: 403, statusText: "Forbidden" })); vi.stubGlobal("fetch", fetchMock);
    await expect(getTableData("id", "Sheet")).rejects.toThrow(/403, forbidden.*denied/); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("prevents overlapping sign-ins and ignores callbacks invalidated by signout", async () => {
    const { clients } = setup(); await initialize(); const first = signIn(); await expect(signIn()).rejects.toThrow(/already in progress/);
    await signOut(); await expect(first).rejects.toThrow(/cancelled/); await initialize(); const next = signIn();
    clients[0].callback({ access_token: "stale", expires_in: "3600" });
    await expect(appendEntry("id", "Sheet", ["x"])).rejects.toThrow(/authentication failed/i);
    clients[1].callback({ access_token: "fresh", expires_in: "3600" }); await next;
  });
  it("reinitialization cancels pending sign-in and invalidates old token-client callbacks", async () => {
    const { clients } = setup(); await initialize(); const auth = signIn(); await expect(initialize()).resolves.toBeUndefined(); await expect(auth).rejects.toThrow(/cancelled/);
    clients[0].callback({ access_token: "stale", expires_in: "3600" }); const freshAuth = signIn(); clients[1].callback({ access_token: "fresh", expires_in: "3600" }); await freshAuth;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })); vi.stubGlobal("fetch", fetchMock); await getTableData("id", "Sheet");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer fresh");
  });
  it("handles synchronous revoke throws and callbacks that never fire", async () => {
    vi.useFakeTimers(); const { clients, revoke } = setup(); await initialize(); const auth = signIn(); clients[0].callback({ access_token: "token", expires_in: "3600" }); await auth;
    revoke.mockImplementationOnce(() => { throw new Error("revoke failed"); }); await expect(signOut()).resolves.toEqual({ revoked: false });
    await initialize(); const again = signIn(); clients[1].callback({ access_token: "token2", expires_in: "3600" }); await again; revoke.mockImplementationOnce(() => undefined);
    const logout = signOut(); await vi.advanceTimersByTimeAsync(5000); await expect(logout).resolves.toEqual({ revoked: false }); vi.useRealTimers();
  });
  it("reports grant revocation success and failure without retaining a token", async () => {
    const { clients, revoke } = setup(); await initialize(); const auth = signIn(); clients[0].callback({ access_token: "token", expires_in: "3600" }); await auth;
    revoke.mockImplementationOnce((_token: string, callback: (response: { successful: boolean }) => void) => callback({ successful: true }));
    await expect(signOut()).resolves.toEqual({ revoked: true });
    await initialize(); const again = signIn(); clients[1].callback({ access_token: "token2", expires_in: "3600" }); await again;
    revoke.mockImplementationOnce((_token: string, callback: (response: { successful: boolean }) => void) => callback({ successful: false }));
    await expect(signOut()).resolves.toEqual({ revoked: false });
    await expect(appendEntry("id", "Sheet", ["x"])).rejects.toThrow(/authentication failed/i);
  });
});
