import{collectTelegram}from'./telegram.js';
import{sources}from'./sources.js';
import{config}from'./config.js';
import{ingest}from'./ingest.js';
if(process.env.RENDER==='true'){
 const items=[];
 for(const source of sources.filter(s=>s.adapter==='telegram')){
  try{items.push(...await collectTelegram(source,config,(event,data)=>console.log(JSON.stringify({event,...data}))));}
  catch(e){console.log(JSON.stringify({event:'telegram_seed_error',source:source.name,error:e.message}));}
 }
 if(items.length){const result=await ingest(items);console.log(JSON.stringify({event:'telegram_seed_complete',collected:items.length,inserted:result.results.filter(x=>x.status==='inserted').length,duplicates:result.results.filter(x=>x.status==='duplicate').length}));}
}
