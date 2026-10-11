import {collectWebsite} from './website.js';
import { collectTelegram } from './telegram.js';
import { collectProsecutor } from './legal-news.js';
import { fetchText } from './fetch.js';
import { parseFeed } from './parse.js';
import { relevant } from './filter.js';

export function fresh(item, now, maxAgeDays) {
  const published = Date.parse(item.publishedAt || '');
  return Number.isFinite(published) &&
    published >= now - maxAgeDays * 86400000 &&
    published <= now + 86400000;
}

export async function collectSources(sources, config, log, {
  fetchFeed = fetchText, parse = parseFeed, now = Date.now(),
} = {}) {
  const allMaterials = [];
  let successfulSources = 0;
  let failedSources = 0;
  for (const source of sources) {
    if (source.disabledReason) { log('source_skipped',{source:source.name,reason:source.disabledReason}); continue; }
    if (source.adapter === 'website') {
      try { allMaterials.push(...await collectWebsite(source,config,log)); successfulSources++; }
      catch(error) { failedSources++; log('source_error',{source:source.name,error:error.message}); }
      continue;
    }
    if (source.adapter === 'telegram') {
      try { allMaterials.push(...await collectTelegram(source, config, log)); successfulSources++; }
      catch (error) { failedSources++; log('source_error',{source:source.name,error:error.message}); }
      continue;
    }
    if (source.adapter === 'prosecutor') {
      try {
        allMaterials.push(...await collectProsecutor(source, config, log));
        successfulSources++;
      } catch (error) {
        failedSources++;
        log('source_error', {source:source.name,error:error.message});
      }
      continue;
    }
    if (!source.feedUrl) {
      log('source_skipped', { source: source.name, reason: 'feedUrl_not_configured' });
      continue;
    }
    try {
      const result = await fetchFeed(source.feedUrl, config.timeoutMs, config.userAgent);
      const parsed = await parse(result.text, source);
      const recent = parsed.filter(item => fresh(item, now, config.maxAgeDays));
      const items = recent.filter(relevant)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, config.maxItems);
      successfulSources++;
      allMaterials.push(...items);
      log('source_filtered', {
        source: source.name, fetched: parsed.length, recent: recent.length,
        relevant: items.length, staleOrUndated: parsed.length - recent.length,
      });
    } catch (error) {
      failedSources++;
      log('source_error', {
        source: source.name, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const unique = [...new Map(allMaterials.map(item => [item.url || item.externalId, item])).values()];
  return { items: unique, collected: allMaterials.length, successfulSources, failedSources };
}
