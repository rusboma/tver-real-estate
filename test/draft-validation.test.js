import test from 'node:test';
import assert from 'node:assert/strict';
import {DRAFT_SYSTEM,validateGeneratedDraft as validate} from '../src/draft-validation.js';
const source='Управляющая организация организует содержание и ремонт общего имущества.';
const draft=()=>({title:'Порядок управления домом',lead:'Источник поясняет обязанности управляющей организации.',body:'Управляющая организация отвечает за организацию содержания и ремонта общего имущества многоквартирного дома.',tver_note:'Местным УК можно проверить распределение обязанностей.',verification_notes:'Проверить первичный документ.',content_kind:'news',facts:[{claim:'УК организует ремонт',quote:source}]});
test('evidence must be a real source quotation',()=>{assert.equal(validate(draft(),source).facts.length,1);assert.throws(()=>validate({...draft(),facts:[{claim:'Новый закон принят',quote:'В Твери приняли новый закон о ремонте.'}]},source),/AI_UNSUPPORTED_EVIDENCE/);});
test('calendar drafts always stay event announcements',()=>assert.equal(validate(draft(),source,true).content_kind,'event_announcement'));
test('malformed and overlong model output is rejected rather than silently saved',()=>{assert.throws(()=>validate({...draft(),body:''},source),/AI_INVALID_OUTPUT/);assert.throws(()=>validate({...draft(),title:'x'.repeat(241)},source),/AI_INVALID_OUTPUT/);assert.throws(()=>validate({...draft(),facts:[]},source),/AI_INVALID_OUTPUT/);});
test('prompt treats source as data, separates claims and event dates, and requires editor checks',()=>{assert.match(DRAFT_SYSTEM,/недоверенные данные/);assert.match(DRAFT_SYSTEM,/анонс мероприятия/);assert.match(DRAFT_SYSTEM,/Не выдумывай/);assert.match(DRAFT_SYSTEM,/возможное применение/);});
