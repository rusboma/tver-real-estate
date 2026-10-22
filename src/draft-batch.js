// Two independent requests at most; failures do not stop the remaining materials.
export async function prepareDraftBatch(items, api, {onProgress=()=>{},shouldStop=()=>false}={}) {
  const unique=[...new Map(items.map(item=>[item.id,item])).values()];
  const results=[];
  let next=0;
  let halted=false;
  async function worker() {
    while (!shouldStop() && !halted && next<unique.length) {
      const item=unique[next++];
      try {
        const {data:context}=await api.get('/api/articles/'+item.id+'/draft');
        if (shouldStop() || halted) return;
        if (context.draft || !['new','review'].includes(context.article.status)) {
          results.push({...item,status:'skipped',message:'Уже есть черновик или изменён статус'});
        } else {
          const {data}=await api.post('/api/articles/'+item.id+'/draft/generate',{
            batch:true,expected_revision:0,source_fingerprint:context.source_fingerprint,
            article_updated_at:context.article.updated_at,
          });
          if (!data.skipped && !data.draft) throw new Error('Missing saved draft');
          results.push({...item,status:data.skipped?'skipped':'prepared',message:data.reason||'Черновик сохранён'});
        }
      } catch (cause) {
        const status=cause?.response?.status;
        const message=cause?.response?.data?.error||'Не удалось подготовить черновик';
        results.push({...item,status:status===409?'skipped':'error',message});
        if (status===401 || status===403 || status===429) {halted=true;onProgress([...results]);return;}
      }
      onProgress([...results]);
    }
  }
  await Promise.all([worker(),worker()]);
  return {results,stopped:shouldStop()||halted};
}
