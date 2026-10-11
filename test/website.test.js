import test from 'node:test';
import assert from 'node:assert/strict';
import {robotsPolicy,parseWebsiteArticle,websiteLinks,publishedDate} from '../src/website.js';
import {load} from 'cheerio';
import {relevant} from '../src/filter.js';
const source={name:'ТСЖ',url:'https://example.test/',tier:'B',sourceType:'utility',articlePattern:'/news/[0-9]+'};
test('robots applies our group, longest matching rule and crawl delay',()=>{
 const p=robotsPolicy('User-agent: Googlebot\nAllow: /\nUser-agent: *\nDisallow: /\nAllow: /news/\nDisallow: /news/private/*\nCrawl-delay: 40');
 assert.equal(p.allowed('https://example.test/news/42'),true);
 assert.equal(p.allowed('https://example.test/news/private/42'),false);
 assert.equal(p.allowed('https://example.test/admin'),false);
 assert.equal(p.delay,40);
 assert.equal(robotsPolicy('User-agent: *\nDisallow: */feed/').allowed('https://example.test/feed/'),false);
});
test('article date and full text exclude menus, related stories and footer',()=>{
 const text='В Осташкове проведён капитальный ремонт лифтов в многоквартирном доме. '.repeat(4);
 const html='<header>Меню</header><main><article><h1>Ремонт лифтов</h1><time datetime="2026-10-08T12:00:00+03:00"></time><div class="entry-content"><p>'+text+'</p><p>Второй абзац.</p><div class="related">Посторонняя новость</div></div></article></main><footer>Подвал</footer>';
 const item=parseWebsiteArticle(html,'https://example.test/news/42',source);
 assert.ok(item.fullText.includes('Второй абзац.'));assert.ok(!item.fullText.includes('Посторонняя'));assert.ok(!item.fullText.includes('Подвал'));assert.equal(item.publishedAt,'2026-10-08T09:00:00.000Z');
 assert.equal(relevant(item),true);
});
test('undated content remains undated and invalid dates are rejected',()=>{
 const $=load('<main><h1>Новость</h1><div class="date">31.02.2026</div><p>Ремонт</p></main>');
 assert.equal(publishedDate($,$('main')),null);
 const item=parseWebsiteArticle('<main><h1>Ремонт дома</h1><p>'+'Длинный текст. '.repeat(20)+'</p></main>','https://example.test/news/42',source);
 assert.equal(item.publishedAt,null);
});
test('news link extraction prevents foreign URLs, navigation and duplicate fragments',()=>{
 const html='<nav><a href="/news/1">Ремонт дома в меню</a></nav><a href="https://evil.test/news/2">Ремонт жилого дома</a><a href="/news/42">Ремонт жилого дома</a><a href="/news/42#more">Ремонт жилого дома</a>';
 assert.deepEqual(websiteLinks(html,source.url,source),[{url:'https://example.test/news/42',title:'Ремонт жилого дома'}]);
});
test('regional filter includes municipalities outside Tver city',()=>{
 for(const city of ['Осташков','Лихославль','Калязин','Торопец','Нелидово','Старица','Зубцов','Удомля','Кашин'])assert.equal(relevant({title:city+' — ремонт многоквартирного дома'}),true);
 assert.equal(relevant({title:'Москва — ремонт многоквартирного дома'}),false);
});
test('national Telegram locality is not inferred from words confirmed or Thursday',async()=>{
 const {region,housingNews}=await import('../src/region.js');
 assert.equal(region.test('Суд подтвердил решение в Калининграде'),false);
 assert.equal(region.test('Собрание состоится в четверг'),false);
 assert.equal(region.test('В Тверской области приняли решение'),true);
 assert.equal(housingNews({title:'Капремонт школы в Твери',body:'Строительство'}),false);
 assert.equal(housingNews({title:'Отопление жилых домов и школ в Кимрах'}),true);
});
test('image-only news preserves the original image with an explicit text notice',()=>{
 const item=parseWebsiteArticle('<div class="item-page"><h1>Тарифы водоснабжения</h1><div itemprop="articleBody"><img src="/tariffs.png"></div></div>','https://example.test/news/42',source);
 assert.equal(item.imageUrl,'https://example.test/tariffs.png');
 assert.ok(item.fullText.includes('Источник разместил основную информацию в изображении'));
 assert.ok(!item.fullText.includes('Тариф составляет'));
});
