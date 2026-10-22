import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDraftBatch} from '../src/draft-batch.js';
const fast={wait:async()=>{}};
const context={draft:null,article:{status:'new',updated_at:'2026-10-22T10:00:00Z'},source_fingerprint:'fingerprint'};
test('bulk preparation spans all items, deduplicates IDs and preserves existing drafts',async()=>{
 const posts=[];
 const api={get:async path=>({data:path.includes('/existing/')?{...context,draft:{revision:2}}:context}),post:async(path,payload)=>{posts.push({path,payload});return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch([{id:'a'},{id:'a'},{id:'existing'},{id:'b'}],api,fast);
 assert.equal(posts.length,2);assert.equal(result.results.filter(r=>r.status==='skipped').length,1);
 assert(posts.every(p=>p.payload.batch===true&&p.payload.expected_revision===0&&!p.payload.confirm_replace));
});
test('one failed item does not block the rest; output retains an actionable error',async()=>{
 const api={get:async()=>({data:context}),post:async path=>{if(path.includes('/bad/'))throw {response:{status:502,data:{error:'Источник недоступен'}}};return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch([{id:'bad'},{id:'good'}],api,fast);
 assert.equal(result.results.find(r=>r.id==='bad').message,'Источник недоступен');assert.equal(result.results.find(r=>r.id==='good').status,'prepared');
});
test('stop does not issue further generation calls after context read',async()=>{
 let stop=false;let posts=0;
 const api={get:async()=>{stop=true;return {data:context};},post:async()=>{posts++;return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch([{id:'one'},{id:'two'},{id:'three'}],api,{shouldStop:()=>stop});
 assert.equal(posts,0);assert.equal(result.stopped,true);
});

test('requests are sequential; a temporary rate limit retries after a pause',async()=>{
 let calls=0;const delays=[];
 const api={get:async()=>({data:context}),post:async()=>{calls++;if(calls===1)throw {response:{status:429}};return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch([{id:'a'},{id:'b'}],api,{wait:async ms=>{delays.push(ms);}});
 assert.equal(calls,3);assert.equal(result.results.length,2);assert.equal(result.stopped,false);assert.equal(delays.reduce((a,b)=>a+b,0),17000);
});
test('persistent transport limit retries finitely and preserves earlier results',async()=>{
 let calls=0;const api={get:async()=>({data:context}),post:async()=>{calls++;throw {response:{status:429}};}};
 const result=await prepareDraftBatch([{id:'a'},{id:'b'}],api,fast);
 assert.equal(calls,3);assert.equal(result.stopped,true);assert.equal(result.results.length,1);
});
test('source fallback activates cooldown for following items without overwriting',async()=>{
 const payloads=[];const api={get:async()=>({data:context}),post:async(_,payload)=>{payloads.push(payload);return {data:{draft:{revision:1},generation_mode:'source_excerpt',reason:'Без AI'}};}};
 const result=await prepareDraftBatch([{id:'a'},{id:'b'}],api,{...fast,now:()=>1000});
 assert.equal(payloads[0].prefer_source_excerpt,false);assert.equal(payloads[1].prefer_source_excerpt,true);assert.equal(result.results[1].message,'Без AI');
});
test('stop interrupts backoff before issuing another request',async()=>{
 let stop=false,calls=0;const api={get:async()=>({data:context}),post:async()=>{calls++;throw {response:{status:429}};}};
 const result=await prepareDraftBatch([{id:'a'}],api,{shouldStop:()=>stop,wait:async()=>{stop=true;}});
 assert.equal(calls,1);assert.equal(result.stopped,true);assert.equal(result.results.length,0);
});
