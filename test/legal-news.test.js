import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProsecutorList,parseProsecutorArticle} from '../src/legal-news.js';
const source={url:'https://epp.genproc.gov.ru/ru/proc_69/',name:'Прокуратура Тверской области',tier:'A',sourceType:'official_news'};
test('official news carries grouped dates and skips old, unrelated and foreign links',()=>{
 const row=(date,title,href)=>`<div class="feeds-list__list_item"><h4 class="feeds-list__list_date">${date}</h4><span class="feeds-list__list_time_span-time">12:10</span><a class="feeds-list__list_link" href="${href}">${title}</a></div>`;
 const html=row('09.10.2026','Суд обязал восстановить водоснабжение','/ru/proc_69/mass-media/news/regional/e1/')+row('','Управляющая организация оштрафована','/ru/proc_69/mass-media/news/regional/e2/')+row('','Осужден водитель','/ru/proc_69/mass-media/news/regional/e3/')+row('','Тарифы ЖКХ','https://other.test/')+row('01.01.2020','Тарифы ЖКХ','/ru/proc_69/mass-media/news/regional/e4/');
 const result=parseProsecutorList(html,source,Date.parse('2026-10-11'),14);
 assert.equal(result.length,2);assert.equal(result[1].publishedAt,'2026-10-09T12:10:00+03:00');
});
test('full official article excludes navigation and fails closed when content disappears',()=>{
 const body='По иску прокуратуры суд обязал администрацию обеспечить надлежащее водоснабжение жителей муниципального округа. '.repeat(3);
 const result=parseProsecutorArticle(`<nav>Меню</nav><div class="feeds-page__article_text"><p>${body}</p></div>`,{url:source.url+'mass-media/news/regional/e1/'},source);
 assert.equal(result.fullText,body.trim());assert.ok(!result.fullText.includes('Меню'));
 assert.throws(()=>parseProsecutorArticle('<main>Новая разметка</main>',{},source));
});
