import test from 'node:test';import assert from 'node:assert/strict';import{parseTelegram}from'../src/telegram.js';
const source={channel:'ngtver',url:'https://t.me/ngtver',name:'Новый Город',tier:'B',localChannel:true,developer:true};
const cfg={maxAgeDays:14,maxItems:20};const now=Date.parse('2026-10-11');
const post=(id,text,date='2026-10-09T12:00:00Z')=>`<div class="tgme_widget_message" data-post="${id}"><time datetime="${date}"></time><div class="tgme_widget_message_text">${text}</div></div>`;
test('Telegram retains construction facts, excludes pure advertising and old posts',()=>{
 const fact='Получено разрешение на ввод в эксплуатацию дома. Квартиры передаются собственникам. Запишитесь на просмотр. '.repeat(2);
 const ad='Клиентский день: скидки на квартиры и рассрочка, успейте купить в отделе продаж. '.repeat(3);
 const items=parseTelegram(post('ngtver/1',fact)+post('ngtver/2',ad)+post('ngtver/3',fact,'2020-01-01')+post('other/4',fact),source,cfg,now);
 assert.equal(items.length,1);assert.equal(items[0].url,'https://t.me/ngtver/1');assert.equal(items[0].fullText,fact.trim());
});
test('national channel requires Tver relevance and unavailable page is an error',()=>{
 const national={...source,channel:'gkhnewsru',localChannel:false,developer:false};
 const text='Суд рассмотрел спор управляющей компании о содержании многоквартирного дома. '.repeat(3);
 assert.equal(parseTelegram(post('gkhnewsru/1',text),national,cfg,now).length,0);
 assert.equal(parseTelegram(post('gkhnewsru/2','В Твери '+text),national,cfg,now).length,1);
 assert.throws(()=>parseTelegram('<h1>Site Unavailable</h1>',national,cfg,now));
});
