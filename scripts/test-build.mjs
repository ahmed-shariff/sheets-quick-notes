import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
for (const f of ['Code.gs','Index.html','appsscript.json']) { const s=await readFile(new URL('../dist/'+f,import.meta.url),'utf8'); if(!s.length)throw Error(`Empty build artifact: ${f}`); }
const code=await readFile(new URL('../dist/Code.gs',import.meta.url),'utf8');
for(const text of ['function bootstrap()','function getSpreadsheet(','function readTable(','function appendEntry(','LockService.getScriptLock()','new Date().toISOString()','getDisplayValues()','setValues']) if(!code.includes(text))throw Error(`Missing server contract: ${text}`);
const html=await readFile(new URL('../dist/Index.html',import.meta.url),'utf8');
if(!html.includes('google.script.run')||html.includes('accounts.google.com')) throw Error('Client bridge missing or browser OAuth present.');
const start = html.indexOf('<script>'), end = html.indexOf('</script>', start);
if(start < 0 || end < 0) throw Error('Client script missing.');
const client = new Script(html.slice(start + '<script>'.length, end), { filename: 'dist/Index.html client' });
const listeners = {};
const elements = Object.fromEntries(['#add', '#sheet-url', '#tabs'].map(id => [id, { value: '', addEventListener(type, fn) { listeners[id + ':' + type] = fn; } }]));
const app = { innerHTML: '', querySelector: id => elements[id] || null, querySelectorAll: () => [], addEventListener() {} };
const calls = [];
const context = { document: { querySelector: () => app }, google: { script: { run: {
  withSuccessHandler(resolve) { return { withFailureHandler() { return {
    bootstrap() {},
    getSpreadsheet(id) { calls.push(id); resolve({ id, title: 'Test sheet', tabs: [{ id: 0, title: 'Notes & tasks' }] }); }
  }; } }; }
} } } };
client.runInNewContext(context);
function checkForm(disabled) {
  if (app.innerHTML.includes("'+(") || app.innerHTML.includes('pendingSheet')) throw Error('Unevaluated JavaScript in rendered form.');
  if (!app.innerHTML.includes('<div id="tabs">' )) throw Error('Tab container missing.');
  for (const id of ['sheet-url', 'add', 'clear-links']) {
    const tag = app.innerHTML.match(new RegExp('<(?:input|button)[^>]*id="' + id + '"[^>]*>'))?.[0];
    if (!tag || /disabled/.test(tag) !== disabled) throw Error(`Incorrect control state: ${id}`);
  }
}
checkForm(false);
elements['#sheet-url'].value = 'https://docs.google.com/spreadsheets/d/test-sheet-id/edit';
await listeners['#add:click']();
checkForm(false);
if (calls[0] !== 'test-sheet-id' || calls.length !== 1) throw Error('Find spreadsheet did not call the server with the parsed ID.');
if (!app.innerHTML.includes('data-tab="0"') || !app.innerHTML.includes('Notes &amp; tasks')) throw Error('Discovered tabs were not rendered safely.');
new Script('writing=true;draw()').runInNewContext(context);
checkForm(true);
