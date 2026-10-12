import {nationalSources} from './national-sources.js';
import {collectSources} from './collect.js';
import {config,assertConfig} from './config.js';
import {ingest} from './ingest.js';
assertConfig();const log=(event,data)=>console.log(JSON.stringify({event,...data}));const r=await collectSources(nationalSources,config,log);for(const i of r.items)log('national_seed_item',{source:i.sourceName,title:i.title,date:i.publishedAt,eventDate:i.eventDate,textLength:i.fullText?.length||0});const result=await ingest(r.items);log('national_seed_complete',{items:r.items.length,failed:r.failedSources,result});