import {load} from 'cheerio';
import {fetchText} from './fetch.js';
import {parseFeed} from './parse.js';
import {plainText,publicImageUrl} from './text.js';
import {housing,housingNews,developerNews} from './region.js';
import {fresh} from './collect.js';
import {parseTildaFeed} from './tilda.js';
import {nationalRelevant,nationalLink} from './national-filter.js';

export function robotsPolicy(text,userAgent='tver-real-estate-scout') {
 const groups=[];let group={agents:[],rules:[],delay:0};let directives=false;
 for(const line of text.split(/\r?\n/)){
  const m=line.replace(/#.*/,'').match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);if(!m)continue;
  const key=m[1].toLowerCase(),value=m[2];
  if(key==='user-agent'){if(directives){groups.push(group);group={agents:[],rules:[],delay:0};directives=false;}group.agents.push(value.toLowerCase());}
  else if(group.agents.length){directives=true;if((key==='allow'||key==='disallow')&&value)group.rules.push({allow:key==='allow',path:value});if(key==='crawl-delay'&&Number.isFinite(Number(value)))group.delay=Math.max(0,Number(value));}
 }
 groups.push(group);const ua=userAgent.toLowerCase();
 const rank=g=>Math.max(-1,...g.agents.map(a=>a==='*'?0:ua.includes(a)?a.length:-1));const best=Math.max(...groups.map(rank));
 const selected=groups.filter(g=>rank(g)===best&&best>=0),rules=selected.flatMap(g=>g.rules);
 return {delay:Math.max(0,...selected.map(g=>g.delay)),allowed(url){const u=new URL(url);const path=u.pathname+u.search;const matches=rules.filter(r=>new RegExp('^'+r.path.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')).test(path)).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow;}};
}
export function publishedDate($,root) {
 const direct=$('meta[property="article:published_time"],meta[itemprop="datePublished"]').first().attr('content')||root.find('time[datetime]').add(root.filter('time[datetime]')).first().attr('datetime');
 if(direct&&Number.isFinite(Date.parse(direct)))return new Date(direct).toISOString();
 for(const el of $('script[type="application/ld+json"]').toArray()){
  try{const walk=o=>{if(!o||typeof o!=='object')return null;if(o.datePublished&&Number.isFinite(Date.parse(o.datePublished)))return new Date(o.datePublished).toISOString();for(const v of Object.values(o)){if(typeof v==='object'){const d=walk(v);if(d)return d;}}return null;};const d=walk(JSON.parse($(el).text()));if(d)return d;}catch{}
 }
 const raw=root.find('.news-date-time,.article-info,.date,.news-date,.news__date,.tmpl-date,.published,.news-date-index,.post-date,.state_date,.article__date,.pub-date').text()+' '+root.text().slice(0,400);
 let m=raw.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
 if(!m){const months=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];const r=raw.match(/\b(\d{1,2})\s+(январ\S*|феврал\S*|март\S*|апрел\S*|ма[яй]|июн\S*|июл\S*|август\S*|сентябр\S*|октябр\S*|ноябр\S*|декабр\S*)\s+(20\d{2})/i);if(r)m=[r[0],r[1],String(months.findIndex(x=>r[2].toLowerCase().startsWith(x))+1),r[3]];}
 if(!m)return null;const year=+m[3],month=+m[2],day=+m[1];const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;return `${m[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T12:00:00+03:00`;
}
export function parseWebsiteArticle(html,url,source) {
 const $=load(html);
 let scope=$(source.rootSelector||'.item-page,.news-detail,article,#content,main').first();
 if(!scope.length)scope=$('.article,.news-content,.news-text,.content').filter((_,el)=>$(el).find('h1,h2').length).first();
 const title=$(source.titleSelector||'h1').first().text().trim()||scope.find('.page-header h2,h2').first().text().trim()||$('meta[property="og:title"]').attr('content')||'';if(!title||!scope.length)return null;
 const selector=source.contentSelector||'[itemprop="articleBody"],.entry-content,.news-detail,.article-body,.news-text,.news-content,.post-content';
 let body=scope.find(selector).add(scope.filter(selector)).first();
 if(!body.length)body=scope;
 const copy=body.clone();copy.find('h1,nav,header,footer,script,style,.article-info,.social,.share,.related,.news-list').remove();
 let fullText=plainText(copy.html()||'').slice(0,100000);
 const imageUrl=publicImageUrl(body.find('img').first().attr('src')||$('meta[property="og:image"]').attr('content'),url);
 if(fullText.length<100){
  if(!body.find('img').length||!imageUrl)return null;
  fullText=(fullText?fullText+'\n\n':'')+'Источник разместил основную информацию в изображении. На странице нет развёрнутого текстового описания. Ниже показано изображение из оригинальной публикации; данные нужно проверить по нему.';
 }

 return {title,url,sourceName:source.name,sourceUrl:source.url,sourceTier:source.tier,sourceType:source.sourceType,externalId:url,eventDate:eventDate(html,url,source),publishedAt:source.calendar ? null : publishedDate($,source.dateSelector?$(source.dateSelector):scope),summary:fullText.slice(0,600),body:fullText,fullText,imageUrl,contentType:'news',confidence:source.tier==='A'?0.95:0.8};
}
export function websiteLinks(html,url,source) {
 const $=load(html);$('body>nav,body>header,body>footer,.site-header,.site-footer,.menu,.t228,.t450,.t456').remove();const pattern=source.articlePattern?new RegExp(source.articlePattern):null;const host=new URL(source.url).hostname.replace(/^www\./,'');const result=[];
 $(source.linkSelector||'a[href]').each((_,a)=>{const title=($(a).text().trim()||$(a).closest('.article-wrapper').find('.article-content').text().trim()).replace(/\s+/g,' ').trim();if(title.length<12||!(source.national ? nationalLink(title,source) : housing.test(title)))return;try{const u=new URL($(a).attr('href'),url);u.hash='';if(u.protocol==='http:'&&u.hostname.replace(/^www\./,'')===host)u.protocol='https:';if(u.protocol!=='https:'||u.hostname.replace(/^www\./,'')!==host||(pattern&&!pattern.test(u.pathname))||u.href===url||/\/(category|tag|author|page|objects)\//.test(u.pathname))return;result.push({url:u.href,title});}catch{}});
 return [...new Map(result.map(x=>[x.url,x])).values()];
}
export async function collectWebsite(source,config,log,{fetchPage=fetchText,now=Date.now()}={}) {
 const origin=new URL(source.url).origin;let policy;
 try{policy=robotsPolicy((await fetchPage(origin+'/robots.txt',config.timeoutMs,config.userAgent)).text,config.userAgent);}catch(error){if(!/HTTP 404|HTTP 410/.test(error.message))throw new Error('robots.txt unavailable: '+error.message);policy=robotsPolicy('');}
 let lastRequest=Date.now();
 const read=async url=>{if(!policy.allowed(url))throw new Error('robots.txt disallows '+new URL(url).pathname);const remaining=lastRequest+policy.delay*1000-Date.now();if(remaining>0){log('website_wait',{source:source.name,seconds:Math.ceil(remaining/1000)});await new Promise(r=>setTimeout(r,remaining));}lastRequest=Date.now();return(await fetchPage(url,config.timeoutMs,config.userAgent)).text;};
 let items=[];
 if(source.tildaFeeds){for(const uid of source.tildaFeeds){const data=JSON.parse(await read('https://feeds.tildacdn.com/api/getfeed/?feeduid='+uid+'&size=20'));items.push(...parseTildaFeed(data,source));}}
 else if(source.feedUrl){const xml=await read(source.feedUrl);items=await parseFeed(xml,source);}
 else {const url=source.listUrl||source.url;const html=await read(url);const links=websiteLinks(html,url,source).slice(0,Math.min(config.maxItems,source.maxPages||8));for(const link of links){try{const item=parseWebsiteArticle(await read(link.url),link.url,source);if(item)items.push(item);}catch(e){log('website_article_error',{source:source.name,url:link.url,error:e.message});}}}
 const recent=items.filter(item=>(fresh(item,now,config.maxAgeDays)||(source.calendar&&freshEvent(item.eventDate,now)))&&(source.national?nationalRelevant(item,source):housingNews(item))&&(!source.developer||developerNews(`${item.title} ${item.body||''}`)));
 const selected=recent.slice(0,Math.min(config.maxItems,source.maxItems||config.maxItems));for(const item of selected){if(!item.fullText){try{
   if(item.postUid){const data=JSON.parse(await read('https://feeds.tildacdn.com/api/getpost/?postuid='+encodeURIComponent(item.postUid)));const post=data.post||data;if(post.uid&&String(post.uid)!==item.postUid)throw new Error('Tilda post ID mismatch');const fullText=plainText(post.text||'');if(fullText.length>=100){item.fullText=fullText.slice(0,100000);item.body=item.fullText;item.imageUrl=publicImageUrl(post.image||post.thumb,item.url)||item.imageUrl;continue;}}
   const full=parseWebsiteArticle(await read(item.url),item.url,source);if(full){item.fullText=full.fullText;item.body=full.fullText;item.imageUrl=full.imageUrl;}}catch(e){log('website_article_error',{source:source.name,url:item.url,error:e.message});}}}
 log('website_filtered',{source:source.name,fetched:items.length,collected:selected.length,fullText:selected.filter(i=>i.fullText).length});return selected;
}

export function freshEvent(value,now=Date.now()) {
 const date=Date.parse(value||'');
 return Number.isFinite(date)&&date>=now-7*86400000&&date<=now+365*86400000;
}
export function eventDate(html,url,source) {
 if(!source.national)return null;
 const $=load(html);const direct=$('[itemprop="startDate"]').first().attr('content')||$('[itemprop="startDate"]').first().attr('datetime');
 if(direct&&Number.isFinite(Date.parse(direct)))return new Date(direct).toISOString().slice(0,10);
 if(source.calendar){
  let m=url.match(/\/(20\d{2})(\d{2})(\d{2})\//);
  if(m)return validEventDate(+m[1],+m[2],+m[3]);
  m=url.match(/\/(\d{2})_(\d{2})_(20\d{2})\//);
  if(m)return validEventDate(+m[3],+m[2],+m[1]);
 }
 return null;
}
function validEventDate(year,month,day) {
 const d=new Date(Date.UTC(year,month-1,day));
 return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d.toISOString().slice(0,10):null;
}
