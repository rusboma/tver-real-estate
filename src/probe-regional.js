import {regionalSources} from './regional-sources.js';
import {collectWebsite} from './website.js';import {collectTelegram} from './telegram.js';import {config} from './config.js';import {ingest} from './ingest.js';import {load} from 'cheerio';
if(process.env.RENDER==='true'){
 const log=(event,data)=>console.log(JSON.stringify({event,...data}));
 await Promise.all(regionalSources.filter(s=>!s.disabledReason).map(async s=>{try{const items=await(s.adapter==='telegram'?collectTelegram(s,config,log):collectWebsite(s,config,log));log('regional_verified',{source:s.name,count:items.length,items:items.map(x=>({title:x.title,url:x.url,date:x.publishedAt,full:x.fullText?.length||0}))});if(items.length){const result=await ingest(items);log('regional_ingested',{source:s.name,results:result.results});}}catch(e){log('regional_failure',{source:s.name,error:e.message});}}));
}