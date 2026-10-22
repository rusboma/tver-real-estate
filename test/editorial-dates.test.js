import test from 'node:test';
import assert from 'node:assert/strict';
import {dateRange} from '../src/editorial-dates.js';
import {archiveStale} from '../src/retention.js';
test('date range supports a single day, open bounds and calendar validity',()=>{
 assert.deepEqual(dateRange('2026-10-22','2026-10-22'),{from:'2026-10-22',to:'2026-10-22'});
 assert.deepEqual(dateRange('','2026-10-22'),{from:null,to:'2026-10-22'});
 for(const pair of [['2026-02-30',''],['2026-10-23','2026-10-22'],['bad','']])assert.throws(()=>dateRange(...pair),/INVALID_DATE_RANGE/);
});
test('retention uses only the server RPC and tolerates temporary failure',async()=>{
 const events=[];
 const settings={ingestUrl:'https://example.supabase.co/functions/v1/scout',serviceRoleKey:'sb_secret_fixture',timeoutMs:1000};
 const count=await archiveStale((event,data)=>events.push({event,...data}),{settings,fetchRpc:async(url,request)=>{
  assert.equal(url,'https://example.supabase.co/rest/v1/rpc/editorial_archive_stale');
  assert.equal(request.headers.Authorization,undefined);
  return {ok:true,json:async()=>({archived:3})};
 }});
 assert.equal(count,3);
 assert.equal(await archiveStale((event)=>events.push({event}),{settings,fetchRpc:async()=>{throw new Error('network failure');}}),null);
 assert.equal(events.at(-1).event,'retention_error');
});
