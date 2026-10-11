import { load } from 'cheerio';
import { fetchText } from './fetch.js';
import { plainText, publicImageUrl } from './text.js';
import { fresh } from './collect.js';

const topic = /жкх|коммунал|управляющ.{0,20}(организац|компан)|водоснабж|теплоснабж|отопительн|питьев.{0,15}вод|квартир|многоквартир|жил(ь|ой|ого|ых)|капремонт|тариф|расселен|застрой|долев.{0,15}строительств/i;
export function parseProsecutorList(html, source, now, maxAgeDays) {
  const $ = load(html); let date = '';
  const items = [];
  $('.feeds-list__list_item').each((_, el) => {
    const row = $(el); const d = row.find('.feeds-list__list_date').text().trim();
    if (d) date = d;
    const a = row.find('a.feeds-list__list_link').first();
    const title = a.text().replace(/\s+/g, ' ').trim();
    const href = a.attr('href');
    const m = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m || !href || !title || !topic.test(title)) return;
    const publishedAt = `${m[3]}-${m[2]}-${m[1]}T${row.find('.feeds-list__list_time_span-time').text().trim() || '12:00'}:00+03:00`;
    const url = new URL(href, source.url).href;
    if (!url.startsWith(source.url + 'mass-media/news/')) return;
    if (fresh({publishedAt}, now, maxAgeDays)) items.push({title, url, publishedAt});
  });
  return items;
}
export function parseProsecutorArticle(html, item, source) {
  const $ = load(html);
  const fullText = plainText($('.feeds-page__article_text').first().html() || '');
  if (fullText.length < 100) throw new Error('Official article text not found');
  return {...item, sourceName:source.name, sourceUrl:source.url, sourceTier:source.tier,
    sourceType:source.sourceType, externalId:item.url, summary:fullText.split('\n')[0].slice(0,1000),
    body:fullText, fullText, imageUrl:publicImageUrl($('.feeds-page__article_image img').first().attr('src'), item.url),
    contentType:'news',confidence:0.9};
}
export async function collectProsecutor(source, config, log, {fetchPage=fetchText, now=Date.now(), wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  let lastRequest = 0;
  async function get(url) {
    const remaining = 30000 - (Date.now()-lastRequest);
    if (remaining > 0) await wait(remaining);
    lastRequest = Date.now();
    return (await fetchPage(url, Math.max(config.timeoutMs,20000), config.userAgent)).text;
  }
  const candidates=[];
  for(const url of source.listUrls) candidates.push(...parseProsecutorList(await get(url),source,now,config.maxAgeDays));
  const unique=[...new Map(candidates.map(item=>[item.url,item])).values()].slice(0,config.maxItems);
  const items=[];
  for(const item of unique) {
    try { items.push(parseProsecutorArticle(await get(item.url),item,source)); }
    catch(e) { log('article_error',{source:source.name,url:item.url,error:e.message}); }
  }
  if(unique.length && !items.length) throw new Error('All selected official articles failed to load');
  log('official_news_filtered',{source:source.name,candidates:unique.length,collected:items.length});
  return items;
}
