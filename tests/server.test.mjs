import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function setup({ headers=['Timestamp','Name'], rows=[] }={}) {
  const props = new Map(); let releases=0, lockThrows=false;
  const sheet={getSheetId:()=>7,getName:()=> 'Tab',getLastColumn:()=>headers.length,getLastRow:()=>rows.length+1,
    getRange(r,_c,n,w){return {getDisplayValues:()=>r===1?[headers.slice(0,w)]:rows.map(x=>x.slice(0,w)),setValues(v){if(lockThrows)throw Error('write failure'); rows.push(v[0]);}}}};
  const ss={getId:()=> 'abc',getName:()=> 'Book',getSheets:()=>[sheet]};
  const context={SpreadsheetApp:{openById:()=>ss},PropertiesService:{getUserProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},Utilities:{getUuid:()=>`uuid-${Math.random()}`,formatDate:(date,zone,pattern)=>{assert.ok(date instanceof Date);assert.equal(pattern,"yyyy-MM-dd'T'HH:mm:ss.SSSZ");if (!['America/Toronto','Asia/Kolkata','Etc/UTC'].includes(zone)) throw Error('Unsupported timezone');return zone==='Etc/UTC'?'2026-05-04T13:30:00.000+0000':zone==='America/Toronto'?'2026-05-04T09:30:00.000-0400':'2026-05-04T19:00:00.000+0530';}},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>releases++})},Date};
  vm.createContext(context); return readFile(new URL('../gas/Code.gs',import.meta.url),'utf8').then(code=>{vm.runInContext(code,context);return {context,headers,rows,released:()=>releases,failWrite:()=>lockThrows=true};});
}
test('bootstrap has stable opaque per-user namespace; spreadsheet and tabs are enumerated',async()=>{const {context}=await setup();const a=context.bootstrap(),b=context.bootstrap();assert.equal(a.namespace,b.namespace);assert.match(a.namespace,/^uuid-/);assert.deepEqual(JSON.parse(JSON.stringify(context.getSpreadsheet('abc'))),{id:'abc',title:'Book',tabs:[{id:7,title:'Tab'}]});});
test('reads headers and rows; rejects empty or malformed header schemas',async()=>{const x=await setup({rows:[['2025','A']]});assert.deepEqual(JSON.parse(JSON.stringify(x.context.readTable('abc',7))),{headers:['Timestamp','Name'],rows:[['2025','A']]});const y=await setup({headers:[]});assert.throws(()=>y.context.readTable('abc',7),/Headers/);const z=await setup({headers:['Timestamp','timestamp']});assert.throws(()=>z.context.readTable('abc',7),/Headers/);});
test('rechecks schema while locked and prefixes every non-timestamp value with a text escape',async()=>{const x=await setup();assert.throws(()=>x.context.appendEntry('abc',7,['Timestamp','Old'],['','x']),/changed/);assert.equal(x.rows.length,0);x.context.appendEntry('abc',7,['Timestamp','Name'],['ignored','=1+1'],'America/Toronto');assert.equal(x.rows.length,1);assert.equal(x.rows[0][0],'2026-05-04T09:30:00.000-04:00');assert.equal(x.rows[0][1],"'=1+1");x.context.appendEntry('abc',7,['Timestamp','Name'],['ignored',' ' + String.fromCharCode(9) + '=1+1'],'Asia/Kolkata');assert.equal(x.rows[1][0],'2026-05-04T19:00:00.000+05:30');assert.equal(x.rows[1][1],"' " + String.fromCharCode(9) + '=1+1');x.context.appendEntry('abc',7,['Timestamp','Name'],['ignored',"'=1+1"],'America/Toronto');assert.equal(x.rows[2][1],"''=1+1");assert.equal(x.released(),4);});
test('missing, malformed, or unsupported timezone falls back to UTC', async () => {
  const x = await setup();
  for (const zone of [undefined, '', '   ', 42, 'x'.repeat(101), 'Unsupported/Zone']) {
    x.context.appendEntry('abc',7,['Timestamp','Name'],['','x'],zone);
    assert.equal(x.rows.at(-1)[0], '2026-05-04T13:30:00.000+00:00');
  }
  assert.equal(x.rows.length, 6);
  assert.equal(x.released(), 6);
});
test('timestamp formatting failure does not write and releases the lock', async () => {
  const x = await setup();
  x.context.Utilities.formatDate = () => { throw Error('format failure'); };
  assert.throws(() => x.context.appendEntry('abc',7,['Timestamp','Name'],['','x'],'America/Toronto'), /format failure/);
  assert.equal(x.rows.length, 0);
  assert.equal(x.released(), 1);
});
test('lock releases on validation and write failures',async()=>{const x=await setup();assert.throws(()=>x.context.appendEntry('abc',7,['Timestamp','Name'],['only']),/Invalid entry/);x.failWrite();assert.throws(()=>x.context.appendEntry('abc',7,['Timestamp','Name'],['','x'],'America/Toronto'),/write failure/);assert.equal(x.released(),2);});
