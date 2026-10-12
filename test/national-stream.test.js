import test from 'node:test';
import assert from 'node:assert/strict';
import {nationalRelevant} from '../src/national-filter.js';
import {parseTildaFeed} from '../src/tilda.js';
import {collectWebsite,parseWebsiteArticle,eventDate} from '../src/website.js';
import {relevant} from '../src/filter.js';
const source={name:'Федеральный источник',url:'https://example.test/',national:true,sourceType:'national_media',tier:'B'};
test('national technology and operational practices do not require Tver geography',()=>{
 const item={title:'В Казани внедрили автоматизацию приёма платежей ЖКХ',body:'Управляющая компания повысила качество обработки начислений.'};
 assert.equal(nationalRelevant(item,source),true);assert.equal(relevant(item),false);
 for(const title of ['Обслуживание пожарной автоматики','Новое решение для домофонов и шлагбаумов','Роботизация уборки территорий','Котельная получила систему диспетчеризации'])assert.equal(nationalRelevant({title},source),true);
 assert.equal(nationalRelevant({title:'В Германии выросли продажи тепловых насосов'},source),false);
 assert.equal(nationalRelevant({title:'Скидка на домофоны до конца недели'},source),false);
 assert.equal(nationalRelevant({title:'Приглашаем на выставку оборудования для ЦОД'},source),false);
});
test('public Tilda feed preserves real publication dates, paragraphs and same-site original links',()=>{
 const data={feedtz:3,posts:[{uid:'one',url:'https://example.test/news/one',title:'Цифровизация ЖКХ',published:'2026-10-10 09:30:00',descr:'Анонс',text:'<p>'+'Полный текст о работе управляющей компании. '.repeat(5)+'</p><p>Второй абзац.</p>',image:'https://example.test/photo.jpg'},{uid:'foreign',url:'https://evil.test/news/one',title:'ЖКХ',published:'2026-10-10 09:30:00'}]};
 const items=parseTildaFeed(data,source);assert.equal(items.length,1);assert.equal(items[0].publishedAt,'2026-10-10T09:30:00+03:00');assert.equal(items[0].summary,'Анонс');assert.ok(items[0].fullText.includes('\n\nВторой абзац.'));assert.equal(items[0].imageUrl,'https://example.test/photo.jpg');
});
test('future professional calendar event has an event date without a fabricated publication date',async()=>{
 const calendar={...source,calendar:true,articlePattern:'/events/',rootSelector:'main'};
 const url='https://example.test/events/online/20261013/seminar';
 const html='<main><h1>Семинар по управлению МКД</h1><p>'+'Программа семинара: автоматизация платежей и практика управляющих организаций. '.repeat(5)+'</p></main>';
 const item=parseWebsiteArticle(html,url,calendar);assert.equal(item.publishedAt,null);assert.equal(item.eventDate,'2026-10-13');
 assert.equal(eventDate(html,'https://example.test/events/online/20260231/seminar',calendar),null);
 const list='<main><a href="'+url+'">Семинар по управлению МКД</a></main>';
 const result=await collectWebsite(calendar,{maxItems:8,maxAgeDays:14,timeoutMs:1000,userAgent:'test'},()=>{}, {now:Date.parse('2026-10-12T12:00:00Z'),fetchPage:async request=>({text:request.endsWith('robots.txt')?'User-agent: *\nAllow: /':request===source.url?list:html})});
 assert.equal(result.length,1);assert.equal(result[0].eventDate,'2026-10-13');assert.equal(result[0].publishedAt,null);
});
test('overlay article links retain substantive card titles rather than menu or author links',async()=>{
 const s={...source,linkSelector:'.article-wrapper-link',articlePattern:'/news/'};
 const html='<div class="article-wrapper"><a class="article-wrapper-link" href="/news/digital"></a><div class="article-content">В Москве внедрили цифровизацию ЖКХ</div></div>';
 const {websiteLinks}=await import('../src/website.js');assert.equal(websiteLinks(html,s.url,s)[0].url,'https://example.test/news/digital');
});
test('Nuxt relative-date pages use explicit public UTC metadata and respect restricted full content',async()=>{
 const {parseNuxtPublicArticle}=await import('../src/nuxt-public.js');
 const data=[{title:1,publishedUtcDateTime:2,content:3,contentAvailable:4,id:5},'Новости ЖКХ','2026-10-11T08:00:00','<p>'+'Публичный анонс о новых технологиях ЖКХ. '.repeat(6)+'</p>',false,100];
 const html='<h1>Новости ЖКХ</h1><script type="application/json">'+JSON.stringify(data)+'</script>';
 const item=parseNuxtPublicArticle(html,'https://example.test/news/one',source);
 assert.equal(item.publishedAt,'2026-10-11T08:00:00Z');assert.equal(item.fullText,null);assert.ok(item.summary.includes('Публичный анонс'));
 data[4]=true;const full=parseNuxtPublicArticle('<h1>Новости ЖКХ</h1><script type="application/json">'+JSON.stringify(data)+'</script>',item.url,source);assert.ok(full.fullText.length>=100);
});
