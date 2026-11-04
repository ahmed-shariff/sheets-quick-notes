import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
for (const f of ['Code.gs','Index.html','appsscript.json']) { const s=await readFile(new URL('../dist/'+f,import.meta.url),'utf8'); if(!s.length)throw Error(`Empty build artifact: ${f}`); }
const code=await readFile(new URL('../dist/Code.gs',import.meta.url),'utf8');
for(const text of ['function bootstrap()','function getSpreadsheet(','function readTable(','function appendEntry(','LockService.getScriptLock()','new Date().toISOString()','getDisplayValues()','setValues']) if(!code.includes(text))throw Error(`Missing server contract: ${text}`);
const html=await readFile(new URL('../dist/Index.html',import.meta.url),'utf8');
if(!html.includes('google.script.run')||html.includes('accounts.google.com')) throw Error('Client bridge missing or browser OAuth present.');
const start = html.indexOf('<script>'), end = html.indexOf('</script>', start);
if(start < 0 || end < 0) throw Error('Client script missing.');
new Script(html.slice(start + '<script>'.length, end), { filename: 'dist/Index.html client' });
