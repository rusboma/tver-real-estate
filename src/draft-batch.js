export async function prepareDraftBatch(items, api, {onProgress=()=>{},shouldStop=()=>false,onWaiting=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now()}={}) {
  const unique=[...new Map(items.map(item=>[item.id,item])).values()];
  const results=[];
  let halted=false, excerptUntil=0;
  async function pause(ms) {
    for(let remaining=ms;remaining>0;remaining-=1000) {
      if(shouldStop()) {onWaiting(null);return false;}
      onWaiting(Math.ceil(remaining/1000));
      await wait(Math.min(1000,remaining));
    }
    onWaiting(null);
    return !shouldStop();
  }
  for(const item of unique) {
    if(shouldStop()||halted) break;
    if(results.length && !await pause(2000)) break;
    for(let attempt=0;attempt<3;attempt++) {
      if(shouldStop()) break;
      try {
        const {data:context}=await api.get('/api/articles/'+item.id+'/draft');
        if(shouldStop()) break;
        if(context.draft||!['new','review'].includes(context.article.status)) {
          results.push({...item,status:'skipped',message:'Уже есть черновик или изменён статус'});
        } else {
          const {data}=await api.post('/api/articles/'+item.id+'/draft/generate',{
            batch:true,expected_revision:0,source_fingerprint:context.source_fingerprint,
            article_updated_at:context.article.updated_at,prefer_source_excerpt:now()<excerptUntil,
          });
          if(!data.skipped&&!data.draft) throw new Error('Missing saved draft');
          if(data.generation_mode==='source_excerpt') excerptUntil=now()+60000;
          results.push({...item,status:data.skipped?'skipped':'prepared',message:data.reason||'Черновик сохранён'});
        }
        break;
      } catch(cause) {
        const status=cause?.response?.status;
        if(status===429&&attempt<2) {
          if(!await pause(15000*(attempt+1))) break;
          continue;
        }
        results.push({...item,status:status===409?'skipped':'error',message:cause?.response?.data?.error||'Не удалось подготовить черновик'});
        if([401,403,429].includes(status)) halted=true;
        break;
      }
    }
    onProgress([...results]);
  }
  onWaiting(null);
  return {results,stopped:shouldStop()||halted};
}
