import {load} from 'cheerio';import {nationalSources} from './national-sources.js';import {robotsPolicy} from './website.js';
if(process.env.RENDER==='true'){
 const read=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'tver-real-estate-scout/0.1'}});return {status:r.status,url:r.url,text:await r.text()};};
 for(let i=0;i<nationalSources.length;i+=6)await Promise.all(nationalSources.slice(i,i+6).map(async s=>{try{
  const robot=await read(new URL(s.url).origin+'/robots.txt');const policy=robotsPolicy(robot.status===404?'':robot.text);const url=s.listUrl||s.url;
  if(robot.status!==404&&robot.status!==200)throw new Error('robots HTTP '+robot.status);if(robot.status===200&&/<html/i.test(robot.text))throw new Error('robots returned HTML');if(!policy.allowed(url))throw new Error('robots disallows news path');
  if(policy.delay)await new Promise(r=>setTimeout(r,Math.min(policy.delay,180)*1000));
  const page=await read(url);const $=load(page.text);
  console.log(JSON.stringify({event:'national_probe',source:s.name,status:page.status,url:page.url,title:$('title').text().slice(0,160),robots:robot.text.slice(0,2500),feeds:$('link[type="application/rss+xml"],link[type="application/atom+xml"]').map((_,a)=>$(a).attr('href')).get(),navigation:$('a[href]').map((_,a)=>({text:$(a).text().replace(/\\s+/g,' ').trim().slice(0,100),href:$(a).attr('href')})).get().filter(x=>/новост|стать|пресс|блог|семинар|вебинар|жкх|цифров|лифт|котель|домофон|шлагбаум|уборк|платеж/i.test(x.text)).slice(0,16),classes:$('[class]').map((_,a)=>$(a).attr('class')).get().filter(c=>/article|news|date|post|entry/i.test(c)).slice(-15)}));
 }catch(e){console.log(JSON.stringify({event:'national_probe',source:s.name,error:e.cause?.code||e.message}));}}));
}