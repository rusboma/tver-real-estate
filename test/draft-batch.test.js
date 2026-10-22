import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDraftBatch} from '../src/draft-batch.js';
const context={draft:null,article:{status:'new',updated_at:'2026-10-22T10:00:00Z'},source_fingerprint:'fingerprint'};
test('bulk preparation spans all items, deduplicates IDs and preserves existing drafts',async()=>{
 const posts=[];
 const api={get:async path=>({data:path.includes('/existing/')?{...context,draft:{revision:2}}:context}),post:async(path,payload)=>{posts.push({path,payload});return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch([{id:'a'},{id:'a'},{id:'existing'},{id:'b'}],api);
 assert.equal(posts.length,2);assert.equal(result.results.filter(r=>r.status==='skipped').length,1);
 assert(posts.every(p=>p.payload.batch===true&&p.payload.expected_revision===0&&!p.payload.confirm_replace));
});
test('one failed item does not block the rest; output retains an actionable error',async()=>{
 const api={get:async()=>({data:context}),post:async path=>{if(path.includes('/bad/'))throw {response:{status:502,data:{error:'Источник недоступен'}}};return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch([{id:'bad'},{id:'good'}],api);
 assert.equal(result.results.find(r=>r.id==='bad').message,'Источник недоступен');assert.equal(result.results.find(r=>r.id==='good').status,'prepared');
});
test('stop does not issue further generation calls after context read',async()=>{
 let stop=false;let posts=0;
 const api={get:async()=>{stop=true;return {data:context};},post:async()=>{posts++;return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch([{id:'one'},{id:'two'},{id:'three'}],api,{shouldStop:()=>stop});
 assert.equal(posts,0);assert.equal(result.stopped,true);
});

test('two workers bound concurrency and a rate limit stops further requests',async()=>{
 let active=0;let peak=0;const api={get:async()=>({data:context}),post:async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {data:{draft:{revision:1}}};}};
 const result=await prepareDraftBatch(Array.from({length:6},(_,id)=>({id:String(id)})),api);assert.equal(result.results.length,6);assert.equal(peak,2);
 let posts=0;const limited={get:async()=>({data:context}),post:async()=>{posts++;throw {response:{status:429,data:{error:'Лимит'}}};}};const stopped=await prepareDraftBatch(Array.from({length:6},(_,id)=>({id:String(id)})),limited);assert.equal(stopped.stopped,true);assert(posts<=2);
});
