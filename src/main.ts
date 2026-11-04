import { appendEntry, getSpreadsheet, getTableData, initializeGoogle, pickSpreadsheet, signIn, signOut, validateHeaders } from "./google";
import type { TableLink } from "./types";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
const storageKey = "sheetnote.links.v1";
let links: TableLink[] = [];
let selectedId = "";
let data: Awaited<ReturnType<typeof getTableData>> | null = null;
let loading = false;
let writing = false;
let signedIn = false;
let busyLink = false;
let status = "";
let statusKind = "";
let isOnline = navigator.onLine;
let installPrompt: BeforeInstallPromptEvent | null = null;
let submittedValues: string[] | null = null;
let generation = 0;
let signingIn = false;
let sessionGeneration = 0;
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "";
const appId = import.meta.env.VITE_GOOGLE_APP_ID || "";

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function persist(): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(links));
    }
    catch {
        notice("This browser could not save linked sheet metadata. Check storage settings and try again.", "error");
    }
}

function loadLinks(): void {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(parsed)) links = parsed.filter((item): item is TableLink => !!item && typeof item.id === "string" && typeof item.spreadsheetId === "string" && typeof item.spreadsheetTitle === "string" && Number.isInteger(item.tabId) && typeof item.tabTitle === "string");
    } catch {
        links = [];
        status = "Saved links could not be read. Clear this site's storage or add the sheet again.";
        statusKind = "error";
    }
}

function notice(text: string, kind = "info"): void {
    status = text;
    statusKind = kind;
    render();
}

function selected(): TableLink | undefined {
    return links.find((link) => link.id === selectedId);
}

function setData(next: typeof data): void {
    data = next;
}

function render(): void {
    const link = selected();
    const headersError = data ? validateHeaders(data.headers) : null;
    const headers = data?.headers ?? [];
    const timestampIndex = headers.findIndex((header) => header.trim().toLocaleLowerCase() === "timestamp");
    const fields = headers.map((header, index) => ({ header, index })).filter(({ index }) => index !== timestampIndex);
    const suggestions = (index: number) => [...new Set((data?.rows ?? []).map((row) => row[index] ?? "").filter((value) => value.trim()))];
    const onlineText = isOnline ? "Online" : "Offline — viewing only";
    app.innerHTML = `
    <header class="topbar"><a class="brand" href="#" aria-label="Sheetnote home"><span class="brand-mark" aria-hidden="true">S</span><span>sheetnote</span></a><div class="top-actions"><span class="connection ${isOnline ? "" : "offline"}" role="status"><i></i>${onlineText}</span>${installPrompt ? '<button class="button button-quiet install" type="button">Install</button>' : ""}<button class="button button-quiet auth" type="button" ${!clientId ? "disabled title='Configure VITE_GOOGLE_CLIENT_ID to enable Google Sheets'" : ""}>${signedIn ? "Sign out" : signingIn ? "Signing in…" : "Sign in with Google"}</button></div></header>
    <main><section class="intro"><p class="eyebrow">YOUR SHEETS, READY WHEN YOU ARE</p><h1>A quick form for<br class="desktop-break"> the things worth noting.</h1><p class="subhead">Connect a spreadsheet and add entries without opening a grid.</p></section>
    <section class="workspace" aria-label="Sheet entry workspace"><aside class="sidebar"><div class="section-heading"><div><p class="eyebrow">YOUR WORKSPACE</p><h2>Linked sheets</h2></div><span class="count">${links.length}</span></div>
    ${links.length ? `<ul class="link-list">${links.map((item) => `<li><button class="link-item ${item.id === selectedId ? "active" : ""}" type="button" data-select="${escapeHtml(item.id)}" ${writing || loading ? "disabled" : ""}><span class="sheet-icon" aria-hidden="true">▤</span><span class="link-copy"><strong>${escapeHtml(item.spreadsheetTitle)}</strong><small>${escapeHtml(item.tabTitle)}</small></span><span class="arrow" aria-hidden="true">›</span></button><button class="remove" type="button" data-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.spreadsheetTitle)} — ${escapeHtml(item.tabTitle)}" ${writing ? "disabled" : ""}>×</button></li>`).join("")}</ul>` : `<div class="empty-links"><span class="empty-icon">＋</span><p>No sheets linked yet.</p><small>Add a spreadsheet below to get started.</small></div>`}
    <div class="link-form"><label>Add a spreadsheet</label><p class="hint">Choose one Google Sheets file. Access is requested per file.</p><button class="button button-primary full picker-button" type="button" ${busyLink || writing || !signedIn || !isOnline || !apiKey || !appId ? "disabled" : ""}>${busyLink ? "Opening spreadsheet picker…" : "Choose spreadsheet"}</button>${!apiKey || !appId ? '<p class="hint">Set VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID in .env.local, then restart the app.</p>' : ""}</div><p class="sidebar-note">You need edit access to submit entries.</p></aside>
    <section class="form-panel" aria-label="Entry form" aria-busy="${loading || writing}">${link ? `<div class="form-heading"><div><p class="eyebrow">${escapeHtml(link.spreadsheetTitle)}</p><h2>${escapeHtml(link.tabTitle)}</h2></div><button class="button button-quiet refresh" type="button" ${loading || writing || !isOnline ? "disabled" : ""} aria-label="Refresh sheet headers and suggestions">↻ <span>Refresh</span></button></div><div id="form-content">${loading ? '<div class="loading"><span class="spinner"></span><p>Loading your sheet…</p></div>' : headersError ? `<div class="state-card"><span class="state-icon">!</span><h3>Sheet needs a quick fix</h3><p>${escapeHtml(headersError)}</p><button class="button button-quiet refresh" type="button" ${!isOnline ? "disabled" : ""}>Refresh sheet</button></div>` : data && fields.length ? `<form id="entry-form" novalidate><div class="fields">${fields.map(({ header, index }) => `<div class="field"><label for="field-${index}">${escapeHtml(header)}</label><input id="field-${index}" name="field-${index}" type="text" autocomplete="off" list="suggestions-${index}" placeholder="Enter ${escapeHtml(header.toLocaleLowerCase())}" value="${escapeHtml(submittedValues?.[index] ?? "")}" ${writing ? "disabled" : ""}><datalist id="suggestions-${index}">${suggestions(index).map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}</datalist></div>`).join("")}</div><p class="timestamp-note"><span aria-hidden="true">◷</span> Timestamp is added automatically when you save.</p><button class="button button-primary submit" type="submit" ${writing || !isOnline ? "disabled" : ""}>${writing ? '<span class="spinner small"></span> Saving…' : 'Save entry <span aria-hidden="true">→</span>'}</button></form>` : '<div class="state-card"><span class="state-icon">✎</span><h3>No entry fields</h3><p>Add at least one column besides Timestamp to your sheet, then refresh.</p></div>'}</div>` : `<div class="welcome"><div class="welcome-art" aria-hidden="true"><span>✳</span><span>▤</span><span>✦</span></div><p class="eyebrow">A LITTLE LESS SPREADSHEET</p><h2>Your next note<br>starts here.</h2><p>Sign in, then link a sheet to build a simple entry form from its column headers.</p><button class="button button-primary welcome-signin" type="button" ${!clientId ? "disabled" : ""}>Sign in with Google</button></div>`}</section></section>
    ${status ? `<div class="notice ${escapeHtml(statusKind)}" role="${statusKind === "error" ? "alert" : "status"}"><span>${statusKind === "error" ? "!" : "•"}</span><p>${escapeHtml(status)}</p><button class="notice-close" type="button" aria-label="Dismiss message">×</button></div>` : ""}
    <p class="install-hint">${!installPrompt ? "Tip: use your browser menu to install Sheetnote on Android or Windows." : ""}</p></main><footer><span>Sheetnote</span><span>Your sheet data stays in Google Sheets. Only link details are saved on this device.</span></footer>`;
    bind();
}

function bind(): void {
    app.querySelector<HTMLButtonElement>(".auth")?.addEventListener("click", () => signedIn ? doSignOut() : doSignIn());
    app.querySelector<HTMLButtonElement>(".welcome-signin")?.addEventListener("click", doSignIn);
    app.querySelector<HTMLButtonElement>(".install")?.addEventListener("click", install);
    app.querySelector<HTMLButtonElement>(".notice-close")?.addEventListener("click", () => {
        status = "";
        render();
    });
    app.querySelectorAll<HTMLButtonElement>("[data-select]").forEach((button) => button.addEventListener("click", () => selectLink(button.dataset.select!)));
    app.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((button) => button.addEventListener("click", () => removeLink(button.dataset.remove!)));
    app.querySelectorAll<HTMLButtonElement>(".refresh").forEach((button) => button.addEventListener("click", refresh));
    app.querySelector<HTMLButtonElement>(".picker-button")?.addEventListener("click", () => void linkSheet());
    app.querySelector<HTMLFormElement>("#entry-form")?.addEventListener("submit", submitEntry);
}

async function doSignIn(): Promise<void> {
    if (signingIn || signedIn) return;
    signingIn = true;
    const session = ++sessionGeneration;
    render();
    try {
        await initializeGoogle(clientId);
        if (session !== sessionGeneration) return;
        await signIn();
        if (session !== sessionGeneration) return;
        signedIn = true;
        notice("Signed in. Link a spreadsheet to get started.");
    }
    catch (error) {
        if (session === sessionGeneration) notice(error instanceof Error ? error.message : "Sign in failed. Check your connection and try again.", "error");
    }
    finally {
        signingIn = false;
        render();
    }
}

async function doSignOut(): Promise<void> {
    const session = ++sessionGeneration;
    generation++;
    signedIn = false;
    data = null;
    submittedValues = null;
    loading = false;
    busyLink = false;
    status = "";
    render();
    try {
        const result = await signOut();
        if (session !== sessionGeneration) return;
        notice(result.revoked ? "Signed out and Google access revoked." : "Signed out locally. Google did not confirm access revocation.", result.revoked ? "success" : "error");
    } catch {
        if (session === sessionGeneration) notice("Signed out locally. Google did not confirm access revocation.", "error");
    }
}

async function linkSheet(): Promise<void> {
    if (!isOnline) return notice("Connect to the internet to choose a spreadsheet.", "error");
    const generationAtStart = generation;
    const sessionAtStart = sessionGeneration;
    if (!signedIn) return notice("Sign in to connect a spreadsheet.", "error");
    if (busyLink) return;
    busyLink = true;
    status = "";
    render();
    try {
        const id = await pickSpreadsheet(apiKey, appId);
        if (!id) return;
        if (generationAtStart !== generation || sessionAtStart !== sessionGeneration) return;
        const info = await getSpreadsheet(id);
        if (generationAtStart !== generation || sessionAtStart !== sessionGeneration) return;
        if (!info.tabs.length) throw new Error("No tabs were found in this spreadsheet.");
        const tab = info.tabs[0];
        const item: TableLink = { id: `${info.id}:${tab.id}`, spreadsheetId: info.id, spreadsheetTitle: info.title, tabId: tab.id, tabTitle: tab.title };
        const existing = links.find((entry) => entry.id === item.id);
        if (!existing) links.push(item);
        persist();
        selectedId = item.id;
        await loadSelected();
    } catch (error) {
        if (generationAtStart === generation && sessionAtStart === sessionGeneration) notice(error instanceof Error ? "The Google service could not complete this request. Check your access and try again." : "Could not choose that spreadsheet. Check your access and try again.", "error");
    }
    finally {
        if (sessionAtStart === sessionGeneration) {
            busyLink = false;
            render();
        }
    }
}

async function selectLink(id: string): Promise<void> {
    if (writing) return;
    generation++;
    selectedId = id;
    status = "";
    setData(null);
    loading = false;
    await loadSelected();
}

async function loadSelected(): Promise<void> {
    const link = selected();
    if (!link) {
        render();
        return;
    }
    const requestId = ++generation;
    loading = true;
    setData(null);
    submittedValues = null;
    render();
    try {
        if (!signedIn) throw new Error("Sign in to load this sheet.");
        if (!isOnline) throw new Error("Connect to the internet to load this sheet.");
        const next = await getTableData(link.spreadsheetId, link.tabTitle);
        if (requestId !== generation || selectedId !== link.id) return;
        data = next;
        status = validateHeaders(next.headers) || "";
        statusKind = status ? "error" : "";
    } catch (error) {
        if (requestId === generation && selectedId === link.id) {
            status = error instanceof Error ? error.message : "Could not load the sheet.";
            statusKind = "error";
        }
    }
    finally {
        if (requestId === generation && selectedId === link.id) {
            loading = false;
            render();
        }
    }
}

async function refresh(): Promise<void> {
    if (!selected() || loading || writing || !isOnline) return;
    status = "";
    await loadSelected();
}

function removeLink(id: string): void {
    if (writing) return;
    const item = links.find((link) => link.id === id);
    if (!item || !window.confirm(`Remove “${item.spreadsheetTitle} — ${item.tabTitle}” from Sheetnote? The spreadsheet will not be changed.`)) return;
    links = links.filter((link) => link.id !== id);
    persist();
    if (selectedId === id) {
        generation++;
        selectedId = links[0]?.id || "";
        data = null;
        loading = false;
        if (selectedId) void loadSelected();
    }
    render();
}

async function submitEntry(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (writing || !isOnline || !data) return;
    const capturedLink = selected();
    if (!capturedLink) return;
    const capturedData = data;
    const sessionAtStart = sessionGeneration;
    const capturedValues = capturedData.headers.map((_, index) => index === capturedData.headers.findIndex((header) => header.trim().toLocaleLowerCase() === "timestamp") ? "" : (app.querySelector<HTMLInputElement>(`#field-${index}`)?.value ?? ""));
    submittedValues = capturedValues;
    writing = true;
    status = "";
    render();
    try {
        await appendEntry(capturedLink.spreadsheetId, capturedLink.tabTitle, capturedValues);
        if (sessionAtStart !== sessionGeneration || selectedId !== capturedLink.id) return;
        const latest = await getTableData(capturedLink.spreadsheetId, capturedLink.tabTitle);
        if (sessionAtStart !== sessionGeneration || selectedId !== capturedLink.id) return;
        data = latest;
        submittedValues = null;
        status = "Entry saved. Suggestions are up to date.";
        statusKind = "success";
    } catch (error) {
        if (sessionAtStart === sessionGeneration && selectedId === capturedLink.id) {
            status = `${error instanceof Error ? error.message : "Could not save your entry."} Your values are still here. Check the sheet before retrying, as the request may have reached Google.`;
            statusKind = "error";
        }
        if (sessionAtStart === sessionGeneration && error instanceof Error && /authentication failed/i.test(error.message)) {
            signedIn = false;
            data = null;
            submittedValues = null;
        }
    } finally {
        writing = false;
        render();
    }
}

async function install(): Promise<void> {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    render();
}

window.addEventListener("online", () => {
    isOnline = true;
    render();
});

window.addEventListener("offline", () => {
    isOnline = false;
    render();
});

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
    render();
});

loadLinks();
selectedId = links[0]?.id || "";
render();

if (selectedId && !links.some((link) => link.id === selectedId))
    selectedId = "";

if (selectedId) void loadSelected();

if ("serviceWorker" in navigator && import.meta.env.PROD)
    window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
