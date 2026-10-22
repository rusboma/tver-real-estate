import test from 'node:test';
import assert from 'node:assert/strict';
import {formatTelegramPost,telegramTransport,checkTelegramConnection,deliverTelegramAttempt,TelegramFailure} from '../src/telegram-publish.js';
const content={title:'Ремонт <дома> & лифта',lead:'Начаты работы по ремонту общего имущества.',body:'Собственники согласовали порядок работ. О сроках управляющая организация сообщит отдельно.',source_url:'https://example.org/news?a=1&b=2',image_url:'https://example.org/photo.jpg'};
test('preview escapes untrusted text, retains approved prose and never truncates',()=>{
 const result=formatTelegramPost(content);assert.match(result.html,/&lt;дома&gt; &amp;/);assert.match(result.plain,/Собственники согласовали/);assert.match(result.html,/a=1&amp;b=2/);
 assert.throws(()=>formatTelegramPost({...content,body:'я'.repeat(4100)}),/TEXT_TOO_LONG/);
 assert.throws(()=>formatTelegramPost({...content,source_url:'javascript:alert(1)'}),/INVALID_CONTENT/);
 assert.equal(formatTelegramPost(content,true).method,'sendPhoto');
 assert.throws(()=>formatTelegramPost({...content,body:'я'.repeat(1100)},true),/CAPTION_TOO_LONG/);
});
test('transport sanitizes errors and distinguishes rejected sends from ambiguous outcomes',async()=>{
 const token='123:secret';
 const rejected=telegramTransport(token,async()=>({ok:false,status:429,json:async()=>({ok:false,error_code:429,description:token,parameters:{retry_after:8}})}));
 await assert.rejects(rejected('sendMessage',{}),e=>e.message==='TELEGRAM_RATE_LIMIT'&&!e.uncertain&&e.retryAfter===8&&!JSON.stringify(e).includes(token));
 const lost=telegramTransport(token,async()=>{throw new Error('URL contains '+token);});
 await assert.rejects(lost('sendMessage',{}),e=>e.uncertain&&!e.message.includes(token));
 const server=telegramTransport(token,async()=>({ok:false,status:500,json:async()=>({ok:false,error_code:500})}));
 await assert.rejects(server('sendMessage',{}),e=>e.uncertain);
 const malformed=telegramTransport(token,async()=>({ok:true,status:200,json:async()=>null}));
 await assert.rejects(malformed('sendMessage',{}),e=>e.uncertain);
});
test('connection verifies channel identity and posting permission, never sends',async()=>{
 const methods=[];
 const call=async(method,payload)=>{methods.push(method);if(method==='getMe')return {id:123,is_bot:true};if(method==='getChat')return {id:payload.chat_id==='@prod'?-100111:-100222,type:'channel',title:'Канал'};return {status:'administrator',can_post_messages:true};};
 const result=await checkTelegramConnection(call,'@prod','@test');assert.equal(result.production.id,'-100111');assert(methods.every(m=>!m.startsWith('send')));
 await assert.rejects(checkTelegramConnection(call,'@prod','@prod'),/TEST_CHANNEL_REQUIRED/);
 await assert.rejects(checkTelegramConnection(async(m,p)=>m==='getChatMember'?{status:'member'}:call(m,p),'@prod','@test'),/FORBIDDEN/);
});
test('delivery sends once and records the exact message before reporting success',async()=>{
 const attempt={id:'attempt',target_chat_id:'-100111',payload:formatTelegramPost(content)};
 let calls=0;const writes=[];
 const result=await deliverTelegramAttempt(attempt,async(method,payload)=>{calls++;assert.equal(method,'sendMessage');assert.equal(payload.chat_id,'-100111');return {message_id:17,chat:{id:-100111}};},async(id,value)=>writes.push({id,...value}));
 assert.equal(calls,1);assert.equal(result.state,'sent');assert.equal(writes[0].message_id,17);
});
test('ambiguous delivery and failed receipt write never automatically send again',async()=>{
 const attempt={id:'attempt',target_chat_id:'-100111',payload:formatTelegramPost(content)};
 let calls=0;const writes=[];
 const unknown=await deliverTelegramAttempt(attempt,async()=>{calls++;throw new TelegramFailure('TELEGRAM_NETWORK',true);},async(_,value)=>writes.push(value));
 assert.equal(unknown.state,'unknown');assert.equal(calls,1);assert.equal(writes[0].state,'unknown');
 const failedWrite=await deliverTelegramAttempt(attempt,async()=>{calls++;return {message_id:2,chat:{id:-100111}};},async()=>{throw new Error('DB offline');});
 assert.equal(failedWrite.state,'unknown');assert.equal(calls,2);
});
test('known rejection records failed with retry_after; photos use one API request',async()=>{
 const attempt={id:'attempt',target_chat_id:'-100111',payload:formatTelegramPost(content,true)};
 let written;
 const result=await deliverTelegramAttempt(attempt,async(method,payload)=>{assert.equal(method,'sendPhoto');assert.equal(payload.caption,attempt.payload.html);throw new TelegramFailure('TELEGRAM_RATE_LIMIT',false,12);},async(_,value)=>{written=value;});
 assert.equal(result.state,'failed');assert.equal(written.retry_after,12);
});
