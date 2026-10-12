import {load} from 'cheerio';
import {plainText,publicImageUrl} from './text.js';
// Read only the public article metadata already delivered in the page.
// contentAvailable=false is treated as an excerpt, never as a full article.
export function parseNuxtPublicArticle(html,url,source) {
 const $=load(html);const heading=$('h1').first().text().trim();
 try{const data=JSON.parse($('script[type="application/json"]').first().text());if(!Array.isArray(data))return null;
  const value=reference=>typeof reference==='number'?data[reference]:reference;
  const article=data.find(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)&&typeof value(entry.publishedUtcDateTime)==='string'&&value(entry.title)===heading);
  if(!article)return null;
  const stamp=value(article.publishedUtcDateTime);const publishedAt=/Z$|[+-]\d{2}:\d{2}$/.test(stamp)?stamp:stamp+'Z';if(!Number.isFinite(Date.parse(publishedAt)))return null;
  const text=plainText(value(article.content));if(text.length<50)return null;
  const available=value(article.contentAvailable)===true;
  return {title:heading,url,sourceName:source.name,sourceUrl:source.url,sourceTier:source.tier,sourceType:source.sourceType,externalId:'public:'+String(value(article.id)),publishedAt,summary:text.slice(0,600),body:available?text:text.slice(0,600),fullText:available&&text.length>=100?text:null,imageUrl:publicImageUrl($('meta[property="og:image"]').attr('content'),url),contentType:'news',confidence:0.8};
 }catch{return null;}
}
