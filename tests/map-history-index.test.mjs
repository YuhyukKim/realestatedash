import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {historyIndex} from '../scripts/map-history-index.mjs';
test('history index retains confirmed zero scopes and rejects mismatched paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'market-index-'));
 try{
  await mkdir(join(root,'11470'));const snapshot={version:1,district:'양천구',kind:'sale',month:'202609',fetchedAt:'2026-09-26T00:00:00Z',records:[],expectedCount:0};
  await writeFile(join(root,'11470/202609.sale.json'),JSON.stringify(snapshot));
  const index=await historyIndex(root);assert.equal(index.scopes.length,1);assert.equal(index.scopes[0].count,0);assert.equal(index.scopes[0].region,'11470');
  await writeFile(join(root,'11470/202608.sale.json'),JSON.stringify(snapshot));await assert.rejects(historyIndex(root),/path/);
 }finally{await rm(root,{recursive:true,force:true});}
});
