import { config, assertConfig } from './config.js';
import { sources } from './sources.js';
import { ingest } from './ingest.js';
import { archiveStale } from './retention.js';
import { collectSources } from './collect.js';

function log(event, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

async function run() {
  assertConfig();
  await archiveStale(log);
  const result = await collectSources(sources, config, log);
  if (!result.successfulSources) throw new Error('No RSS source could be read');
  if (!result.items.length) {
    log('run_complete', { collected: 0, ingested: 0, failedSources: result.failedSources });
    return;
  }
  const ingestion = await ingest(result.items);
  await archiveStale(log);
  log('run_complete', {
    collected: result.collected, unique: result.items.length,
    failedSources: result.failedSources, ingestResult: ingestion,
  });
}

run().catch(error => {
  log('fatal_error', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
