import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

async function harness({ detected = 'Asia/Kolkata', intlThrows = false, stored = {}, writeError = false, columnError = false } = {}) {
  const html = await readFile(new URL('../dist/Index.html', import.meta.url), 'utf8');
  const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  const calls = [], rpcCalls = [], values = { ...stored }, inputs = {};
  let finishWrite;
  const app = { innerHTML: '', querySelector: selector => inputs[selector] ?? null, querySelectorAll: () => [], addEventListener() {} };
  const localStorage = { getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; }, removeItem: key => { delete values[key]; } };
  const runner = {
    withSuccessHandler(resolve) {
      return { withFailureHandler(reject) {
        return {
          bootstrap() { resolve({ namespace: 'user1' }); },
          appendEntry(...args) { calls.push(args); rpcCalls.push('appendEntry'); finishWrite = () => writeError ? reject(Error('write failure')) : resolve({ ok: true }); },
          addColumn(...args) { calls.push(args); rpcCalls.push('addColumn'); finishWrite = () => columnError ? reject(Error('column failure')) : resolve({ headers: [...args[2], args[3]] }); },
          readTable() { rpcCalls.push('readTable'); resolve({ headers: ['Timestamp', 'Name'], rows: [] }); }
        };
      } };
    }
  };
  const context = vm.createContext({ document: { querySelector: () => app }, localStorage,
    Intl: { DateTimeFormat: () => { if (intlThrows) throw Error('Intl unavailable'); return { resolvedOptions: () => ({ timeZone: detected }) }; }, supportedValuesOf: () => ['America/Los_Angeles', 'Asia/Kolkata'] },
    google: { script: { run: runner } }
  });
  vm.runInContext(script + `\nglobalThis.api={state:()=>({namespace,storageKey,timezoneKey,selectedTimeZone,detectedTimeZone,links,writing,draft,data,submitted,status}),addColumn,change:e=>{selectedTimeZone=e.target.value;persistTimeZone();draw()},reset,save};`, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, calls, rpcCalls, values, inputs, app, finishWrite: () => finishWrite() };
}
test('bootstrap chooses detected timezone and falls back to UTC when unavailable', async () => {
  assert.equal((await harness()).context.api.state().selectedTimeZone, 'Asia/Kolkata');
  assert.equal((await harness({ detected: null })).context.api.state().selectedTimeZone, 'Etc/UTC');
  assert.equal((await harness({ intlThrows: true })).context.api.state().selectedTimeZone, 'Etc/UTC');
});
test('bootstrap restores valid stored timezone and ignores invalid value', async () => {
  assert.equal((await harness({ stored: { 'sheetnote.timezone.user1': 'America/Los_Angeles' } })).context.api.state().selectedTimeZone, 'America/Los_Angeles');
  assert.equal((await harness({ stored: { 'sheetnote.timezone.user1': 'Bad/Zone' } })).context.api.state().selectedTimeZone, 'Asia/Kolkata');
});
test('timezone change stores namespace preference and reset removes only owned keys', async () => {
  const h = await harness({ stored: { unrelated: 'keep', 'sheetnote.links.user1': '[]' } });
  h.context.api.change({ target: { value: 'America/Los_Angeles' } });
  assert.equal(h.values['sheetnote.timezone.user1'], 'America/Los_Angeles');
  h.context.api.reset();
  assert.equal(h.values.unrelated, 'keep');
  assert.equal(h.values['sheetnote.links.user1'], undefined);
  assert.equal(h.values['sheetnote.timezone.user1'], undefined);
  assert.equal(h.context.api.state().selectedTimeZone, 'Asia/Kolkata');
});
test('timezone change preserves draft; save sends chosen zone and disables selector while writing', async () => {
  const h = await harness();
  vm.runInContext("links=[{id:'test',spreadsheetId:'abc',tabId:7}];selectedId='test';data={headers:['Timestamp','Name'],rows:[]};draft={1:'draft value'};submitted=['','draft value'];", h.context);
  h.context.api.change({ target: { value: 'America/Los_Angeles' } });
  assert.equal(h.context.api.state().draft[1], 'draft value');
  const saving = h.context.api.save({ preventDefault() {} });
  assert.equal(h.context.api.state().writing, true);
  assert.match(h.app.innerHTML, /id="timezone" disabled/);
  h.finishWrite(); await saving;
  assert.equal(h.calls[0][4], 'America/Los_Angeles');
});
test('successful save uses one RPC, clears draft and updates suggestions locally', async () => {
  const h = await harness();
  vm.runInContext("links=[{id:'test',spreadsheetId:'abc',tabId:7}];selectedId='test';data={headers:['Timestamp','Name'],rows:[['old','before']]};draft={1:'new value'};", h.context);
  h.inputs['#f1'] = { value: 'new value' };
  const saving = h.context.api.save({ preventDefault() {} });
  h.finishWrite(); await saving;
  assert.deepEqual(h.rpcCalls, ['appendEntry']);
  assert.equal(h.context.api.state().draft, null);
  assert.equal(h.context.api.state().submitted, null);
  assert.equal(h.context.api.state().data.rows.at(-1)[1], 'new value');
  assert.equal(h.context.api.state().writing, false);
});
test('failed save preserves draft and never retries or reloads', async () => {
  const h = await harness({ writeError: true });
  vm.runInContext("links=[{id:'test',spreadsheetId:'abc',tabId:7}];selectedId='test';data={headers:['Timestamp','Name'],rows:[]};draft={1:'keep'};", h.context);
  h.inputs['#f1'] = { value: 'keep' };
  const saving = h.context.api.save({ preventDefault() {} });
  h.finishWrite(); await saving;
  assert.deepEqual(h.rpcCalls, ['appendEntry']);
  assert.equal(h.context.api.state().draft[1], 'keep');
  assert.match(h.context.api.state().status, /Check the sheet before retrying/);
});
test('adding a column preserves draft and extends local schema without a reload', async () => {
  for (const columnError of [false, true]) {
    const h = await harness({ columnError });
    vm.runInContext("links=[{id:'test',spreadsheetId:'abc',tabId:7}];selectedId='test';data={headers:['Timestamp','Name'],rows:[['old','before']]};draft={1:'keep'};", h.context);
    h.inputs['#column-name'] = { value: ' Category ' };
    const adding = h.context.api.addColumn({ preventDefault() {} });
    assert.equal(h.context.api.state().writing, true);
    assert.match(h.app.innerHTML, /id="column-name"[^>]*disabled/);
    h.finishWrite(); await adding;
    const state = h.context.api.state();
    assert.deepEqual(h.rpcCalls, ['addColumn']);
    assert.equal(h.calls[0][3], 'Category');
    assert.equal(state.draft[1], 'keep');
    assert.equal(state.data.headers.length, columnError ? 2 : 3);
    assert.equal(state.data.rows[0][1], 'before');
    if (!columnError) assert.equal(state.data.rows[0][2], '');
    assert.equal(state.writing, false);
  }
});
test('client RPC bridge uses success and failure handlers', async () => {
  const s = await readFile(new URL('../scripts/build-gas.mjs', import.meta.url), 'utf8');
  assert.ok(s.includes('withSuccessHandler(resolve)'));
  assert.ok(s.includes('withFailureHandler('));
});
