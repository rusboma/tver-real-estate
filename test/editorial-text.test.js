import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanEditorialText as clean} from '../src/editorial-text.js';
test('course keeps program but removes prices, biographies, attendee lists and sales conditions', () => {
 const value='Главная\n\nСтоимость участия:\n\n5 900 руб.\n\nСписок участников\n\nИван Иванов\n\nПрограмма семинара:\n\n1. Условия договора управления\n\nПорядок изменения размера платы за содержание жилого помещения\n\nРазмер платы 35 рублей за м².\n\nРаздаточные материалы:\n\nПрезентация\n\nСКИДКИ\n\n10%';
 const r=clean(value);assert.match(r,/Условия договора/);assert.match(r,/35 рублей/);assert.doesNotMatch(r,/5 900|Иван|Презентация|СКИДКИ|10%/);
});
test('article drops comments, polls and related offers but retains essential money, legal references and questions', () => {
 const value='Почему тариф вырос?\n\nСтоимость ремонта лифта — 5 900 руб.\n\nПо делу № 305-ЭС25-15025 взыскано 341 тыс. рублей.\n\nОцените статью\n\nДа\n\nНет\n\nКупите наш курс';
 const r=clean(value);assert.match(r,/Почему тариф/);assert.match(r,/5 900 руб/);assert.match(r,/305-ЭС25-15025/);assert.doesNotMatch(r,/Оцените|Купите/);
});
test('advertising footer does not eat program and sponsor disclosure is preserved without identifiers',()=>{
 const r=clean('Реклама ООО «Плазма» | ИНН: 123 erid: abc\n\nПрограмма вебинара:\n\nОптимизация систем противопожарной защиты\n\nЗаписаться и скачать запись можно после авторизации\n\nВопросы\n\nЧтобы задать вопрос необходимо авторизоваться\n\nРеклама на сайте\n\nБиржа труда');
 assert.match(r,/Рекламный материал источника/);assert.match(r,/противопожарной защиты/);assert.doesNotMatch(r,/ИНН|erid|Биржа|авторизоваться/);
});
test('commercial inline ending is removed without losing operational claims or source limitations',()=>{
 const r=clean('CRM помогает фиксировать заявки жителей. Попробуйте платформу Doma.ai бесплатно\n\nПолная версия доступна только подписчикам\n\nКомментарии\n\nПлохая статья');
 assert.match(r,/CRM помогает фиксировать заявки жителей/);assert.match(r,/только фрагмент статьи/);assert.doesNotMatch(r,/Попробуйте|Плохая/);
});
test('cleanup is stable, empty input never falls back to commercial text and ordinary prose is retained',()=>{
 assert.equal(clean(null),'');assert.equal(clean('Оформить заявку'),'');const text='Плата за участие собственников в расходах на ремонт составила 500 рублей.\n\nКак улучшить работу УК?';assert.equal(clean(text),text);assert.equal(clean(clean(text)),text);
});

test('common usefulness and like polls are excluded without removing the preceding news',()=>{
 for(const question of ['Нравится ли вам статья?', 'Вам нравится статья?', 'Понравился материал?', 'Была ли статья полезна?'])assert.equal(clean('Собственники утвердили план ремонта.\n\n'+question+'\n\nДа\n\nНет'),'Собственники утвердили план ремонта.');
});
