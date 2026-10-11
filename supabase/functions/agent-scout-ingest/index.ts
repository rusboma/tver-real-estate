const headers = { 'Content-Type': 'application/json' };

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const suppliedKey = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!serviceKey || suppliedKey !== serviceKey) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers });
  }
  try {
    const payload = await req.json();
    const items = Array.isArray(payload.items) ? payload.items : [payload];
    if (!items.length || items.length > 100) {
      return new Response(JSON.stringify({ error: 'invalid_batch_size' }), { status: 400, headers });
    }
    const base = Deno.env.get('SUPABASE_URL')!;
    const requestHeaders = {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
    };
    const results = [];
    for (const item of items) {
      const response = await fetch(base + '/rest/v1/rpc/scout_ingest_item', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ p_item: item }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        console.error('scout_ingest_item failed:', response.status, failure.code, failure.message);
        const errorCode = typeof failure.code === 'string' ? failure.code : 'unknown';
        return new Response(JSON.stringify({ ok: false, error: 'ingest_failed', code: errorCode, message: String(failure.message || '').slice(0, 200), processed: results.length }), { status: 400, headers });
      }
      results.push(await response.json());
    }
    const logResponse = await fetch(base + '/rest/v1/agent_runs', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        agent_name: 'scout-ingest', status: 'completed',
        input: { count: items.length }, output: { processed: results.length },
      }),
    });
    if (!logResponse.ok) console.warn('scout agent run log failed:', logResponse.status);
    return new Response(JSON.stringify({ ok: true, results }), { headers });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_request' }), { status: 400, headers });
  }
});
