import {load} from 'cheerio';
import {plainText} from './text.js';
import {fresh} from './collect.js';
import {fetchText} from './fetch.js';
import {housing,region as local,developerNews} from './region.js';
export function parseTelegram(html,source,config,now=Date.now()) {
 const $=load(html);const posts=$('.tgme_widget_message');
 if(!posts.length) throw new Error('Telegram public posts unavailable');
 const items=[];
 posts.each((_,el)=>{
  const row=$(el);const id=row.attr('data-post');
  if(!id || !new RegExp('^'+source.channel+'/[0-9]+$').test(id))return;
  const text=plainText(row.find('.tgme_widget_message_text').first().html()||'');
  const publishedAt=row.find('time').first().attr('datetime');
  if(text.length<100 || !fresh({publishedAt},now,config.maxAgeDays) || !housing.test(text))return;
  if(!source.localChannel && !local.test(text))return;
  if(source.developer && !developerNews(text))return;
  const title=text.split('\n').find(s=>s.trim())?.slice(0,240)||'Сообщение Telegram';
  items.push({title,url:'https://t.me/'+id,sourceName:source.name,sourceUrl:source.url,sourceTier:source.tier,sourceType:'telegram',externalId:id,publishedAt,summary:text.slice(0,600),body:text,fullText:text,imageUrl:null,contentType:'news',confidence:0.5});
 });
 return [...new Map(items.map(i=>[i.url,i])).values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,config.maxItems);
}
export async function collectTelegram(source,config,log){
 const result=await fetchText('https://t.me/s/'+source.channel,config.timeoutMs,config.userAgent);
 const items=parseTelegram(result.text,source,config);
 log('telegram_filtered',{source:source.name,collected:items.length});
 return items;
}
