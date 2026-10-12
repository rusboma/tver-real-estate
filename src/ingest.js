import { config } from './config.js';

async function ingestBatch(materials) {
  const response = await fetch(config.ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.serviceRoleKey },
    body: JSON.stringify({ items: materials.map(m => ({
      title: m.title, url: m.url, source_url: m.sourceUrl,
      source_name: m.sourceName, source_tier: m.sourceTier, source_type: m.sourceType,
      external_id: m.externalId, published_at: m.publishedAt,
      summary: m.summary, body: m.body, full_text: m.fullText, event_date: m.eventDate,
      image_url: m.imageUrl, content_type: m.contentType, confidence: m.confidence,
    })) }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error('Ingest failed: HTTP ' + response.status + ': ' + body.slice(0, 500));
  try { return JSON.parse(body); } catch { return { raw: body }; }
}

export async function ingest(materials) {
  const results=[];
  for(let i=0;i<materials.length;i+=100) {
    const result=await ingestBatch(materials.slice(i,i+100));
    results.push(...(result.results||[]));
  }
  return {ok:true,results};
}
