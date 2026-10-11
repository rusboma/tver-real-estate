import { config, assertConfig } from './config.js';
import { sources } from './sources.js';
import { fetchText } from './fetch.js';
import { parseFeed } from './parse.js';
import { ingest } from './ingest.js';
import { relevant } from './filter.js';

function log(event, data = {}) { console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data })); }

async function run() {
  assertConfig();
  const allMaterials = [];
  for (const source of sources) {
    if (!source.feedUrl) {
      log('source_skipped', { source: source.name, reason: 'feedUrl_not_configured' });
      continue;
    }
    try {
      const result = await fetchText(source.feedUrl, config.timeoutMs, config.userAgent);
      const parsed = (await parseFeed(result.text, source)).slice(0, config.maxItems);
      const items = parsed.filter(relevant);
      log('source_filtered', { source: source.name, fetched: parsed.length, relevant: items.length });
      allMaterials.push(...items);
      log('source_collected', { source: source.name, count: items.length });
    } catch (error) {
      log('source_error', { source: source.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!allMaterials.length) { log('run_complete', { collected: 0, ingested: 0 }); return; }
  const unique = [...new Map(allMaterials.map((item) => [item.url || item.externalId, item])).values()];
  const result = await ingest(unique);
  log('run_complete', { collected: allMaterials.length, unique: unique.length, ingestResult: result });
}

run().catch((error) => { log('fatal_error', { error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; });
