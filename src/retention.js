import {config} from './config.js';

export async function archiveStale(log, {fetchRpc=fetch, settings=config}={}) {
  try {
    const endpoint=new URL(settings.ingestUrl);
    endpoint.pathname='/rest/v1/rpc/editorial_archive_stale';
    endpoint.search='';
    const headers={'Content-Type':'application/json',apikey:settings.serviceRoleKey};
    if (!settings.serviceRoleKey.startsWith('sb_secret_')) headers.Authorization='Bearer '+settings.serviceRoleKey;
    const response=await fetchRpc(endpoint.href,{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(settings.timeoutMs)});
    if (!response.ok) throw new Error('HTTP '+response.status);
    const result=await response.json();
    const archived=Number.isInteger(result.archived)&&result.archived>=0?result.archived:0;
    log('retention_complete',{archived,retentionDays:7});
    return archived;
  } catch {
    // Listing itself also hides stale news. A failed sweep is retried next run.
    log('retention_error',{message:'Archive sweep unavailable; retry on the next scout run'});
    return null;
  }
}
