import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSourceDraft} from '../src/source-draft.js';
import {validateGeneratedDraft} from '../src/draft-validation.js';
const text='В многоквартирном доме завершили замену приборов учёта. Управляющая организация сообщила об окончании работ.\n\nНовые приборы передают показания дистанционно. Порядок расчёта платы для собственников не изменился. Работы выполнены в рамках обслуживания общедомовых систем.';
test('source fallback preserves supplied facts and passes the same evidence validation',()=>{
 const result=validateGeneratedDraft(buildSourceDraft({title:'Замена приборов учёта'},text),text);
 assert.match(result.verification_notes,/без AI/);assert(text.includes(result.facts[0].quote));assert.match(result.body,/Порядок расчёта/);assert.doesNotMatch(result.body,/Твер|миллион/);
});
test('course fallback stays an announcement with an explicit editorial warning',()=>{
 const result=validateGeneratedDraft(buildSourceDraft({title:'Программа семинара по ЖКХ'},text,true),text,true);
 assert.equal(result.content_kind,'event_announcement');assert.match(result.lead,/анонс/);assert.match(result.verification_notes,/отредактируйте/);
});
test('empty source is not replaced with fabricated prose',()=>assert.throws(()=>buildSourceDraft({title:'Короткая заметка'},'Кратко.'),/SOURCE_DRAFT_INSUFFICIENT/));
