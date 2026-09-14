import { config } from './config.js';
export async function ingest(materials) {
  const response = await fetch(config.ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.serviceRoleKey}` },
    body: JSON.stringify({ materials })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Ingest failed: HTTP ${response.status}: ${body.slice(0, 500)}`);
  try { return JSON.parse(body); } catch { return { raw: body }; }
}
