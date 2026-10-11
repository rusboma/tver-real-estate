import {load} from 'cheerio';
if(process.env.RENDER==='true'){
 const sites={"illidium":"https://illidium.com/","dsk":"https://dsktver.com/","water":"https://www.tvervodokanal.ru/","oes":"https://www.oes-tver.ru/news","zvezda":"https://uk-zvezda.ru/news","tsj":"https://tsjtver.kvado.ru/","tver":"https://www.tver.ru/about/info/news/","ved":"https://vedtver.ru/","kim":"https://kimvestnik.ru/","bezh":"https://bzgazeta.ru/","seliger":"https://seliger-news.ru/","konakovo":"https://gazeta-konakovo.ru/","kashin":"https://www.kashin.info/materialy/zhkkh","volok":"https://v-volok.ru/","liho":"https://lihoslavl69.ru/","toropec":"https://toropecadm.ru/","ost":"https://xn----8sbgnuc0acykh9d.xn--p1ai/","rzh":"https://presska.ru/"};
 for(const [name,url] of Object.entries(sites)){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});const html=await r.text();const $=load(html);
  const root=new URL(url).origin;
  let robots='';try{robots=await(await fetch(root+'/robots.txt',{signal:AbortSignal.timeout(10000)})).text()}catch{}
  console.log(JSON.stringify({event:'detail_probe',name,status:r.status,robots:robots.slice(0,2200),links:$('h1 a,h2 a,h3 a,.news-list a,.news-item a,.media-heading a,article a').map((_,a)=>({text:$(a).text().trim().slice(0,130),href:$(a).attr('href')})).get().filter(x=>x.text).slice(0,8),classes:$('[class]').map((_,a)=>$(a).attr('class')).get().filter(c=>/news|entry-content|item-page|article|date/i.test(c)).slice(-25),tail:$('main,.content,.news-list,.news,.item-page').first().text().replace(/\s+/g,' ').slice(-2000),feeds:$('link[type="application/rss+xml"]').map((_,a)=>$(a).attr('href')).get()}));
  }catch(e){console.log(JSON.stringify({event:'detail_probe',name,error:e.message}))}
 }
}