import {regionalSources} from './regional-sources.js';
import {collectWebsite} from './website.js';import {collectTelegram} from './telegram.js';import {config} from './config.js';
if(process.env.RENDER==='true'){
 const log=(event,data)=>console.log(JSON.stringify({event,...data}));
 const active=regionalSources.filter(s=>!s.disabledReason);
 for(let i=0;i<active.length;i+=6)await Promise.all(active.slice(i,i+6).map(async s=>{try{const items=await(s.adapter==='telegram'?collectTelegram(s,config,log):collectWebsite(s,config,log));log('regional_result',{source:s.name,count:items.length,items:items.map(x=>({title:x.title,url:x.url,date:x.publishedAt,full:x.fullText?.length||0,preview:x.fullText?.slice(0,140)}))});}catch(e){log('regional_failure',{source:s.name,error:e.message});}}));
}