import {plainText,publicImageUrl} from './text.js';
export function parseTildaFeed(data,source) {
 if(!Array.isArray(data.posts))throw new Error('Invalid public Tilda feed');
 const offset=Number(data.feedtz);const hours=Number.isFinite(offset)&&Math.abs(offset)<=14?offset:3;
 const zone=(hours<0?'-':'+')+String(Math.abs(hours)).padStart(2,'0')+':00';
 return data.posts.flatMap(post=>{
  let url;try{url=new URL(post.url||post.directlink,source.url);if(url.protocol!=='https:'||url.hostname.replace(/^www\./,'')!==new URL(source.url).hostname.replace(/^www\./,''))return [];}catch{return [];}
  const title=plainText(post.title);if(!title||!post.uid)return [];
  const stamp=String(post.published||post.date||'').replace(' ','T');
  const publishedAt=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(stamp)?stamp+zone:null;
  const fullText=plainText(post.text||'');const summary=plainText(post.descr||'');
  return [{title,url:url.href,sourceName:source.name,sourceUrl:source.url,sourceTier:source.tier,sourceType:source.sourceType,externalId:'tilda:'+post.uid,postUid:String(post.uid),publishedAt,summary:summary||fullText.slice(0,600),body:fullText||summary,fullText:fullText.length>=100?fullText:null,imageUrl:publicImageUrl(post.image||post.thumb,url.href),contentType:'news',confidence:source.sourceType==='national_vendor'?0.55:0.8}];
 });
}
