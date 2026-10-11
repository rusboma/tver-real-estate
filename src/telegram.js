import {load} from 'cheerio';
import {plainText} from './text.js';
import {fresh} from './collect.js';
import {fetchText} from './fetch.js';
const housing=/жкх|коммунал|управляющ.{0,20}(компан|организац)|водоснабж|теплоснабж|отопительн|квартир|многоквартир|недвижим|новостро|застрой|ипотек|капремонт|капитальн.{0,15}ремонт|расселен|жил(ь|ой|ого|ых)|тариф|кровл|питьев.{0,15}вод|вывоз.{0,15}(отход|мусор)/i;
const local=/твер|верхневолж|калининск|торжок|ржев|конаков|кимр|кашин|бежецк|вышн.{0,5}волоч/i;
const fact=/ввод.{0,25}эксплуатац|разрешени.{0,25}ввод|переда.{0,25}(ключ|собственник|управляющ)|ход.{0,15}строительств|бетонирован|армирован|монтаж|строительн.{0,15}готовност/i;
const advert=/скидк|клиентский день|запис.{0,15}просмотр|успей|акци[яи]|купить|отдел.{0,10}продаж|рассрочк|подбор.{0,15}квартир/i;
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
  if(source.developer && advert.test(text) && !fact.test(text))return;
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
