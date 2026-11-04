import { readFile } from 'node:fs/promises';
import { test } from 'node:test';import assert from 'node:assert/strict';
test('built client bridges each RPC with success and failure handlers',async()=>{const s=await readFile(new URL('../scripts/build-gas.mjs',import.meta.url),'utf8');for(const method of ['bootstrap','getSpreadsheet','readTable','appendEntry'])assert.ok(s.includes(method),`missing ${method}`);assert.match(s,/withSuccessHandler\(resolve\)/);assert.match(s,/withFailureHandler\(/);});
