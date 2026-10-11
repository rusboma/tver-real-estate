import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/parse.js';
import { collectSources, fresh } from '../src/collect.js';

const source = { name: 'TVTver', url: 'https://tvtver.ru/', feedUrl: 'https://tvtver.ru/?yandex_feed=news', tier: 'B', sourceType: 'local_media' };
const now = Date.parse('2026-10-11T18:00:00Z');
const config = { maxAgeDays: 14, maxItems: 2, timeoutMs: 1000, userAgent: 'scout-test' };

test('RSS full content and image stay separate from the short description', async () => {
  const full = '<p>В Твери обновили жилой дом. ' + 'Подробности ремонта и работы управляющей компании. '.repeat(4) + '</p><p>Второй абзац.</p>';
  const xml = '<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Новости</title><item><title>Капремонт дома в Твери</title><link>https://tvtver.ru/news/remont/</link><guid>remont</guid><pubDate>Sun, 11 Oct 2026 17:00:00 GMT</pubDate><description>Короткий анонс.</description><content:encoded><![CDATA[' + full + ']]></content:encoded><enclosure url="https://tvtver.ru/photo.jpg" type="image/jpeg"/></item></channel></rss>';
  const [item] = await parseFeed(xml, source);
  assert.equal(item.summary, 'Короткий анонс.');
  assert.ok(item.fullText.includes('Второй абзац.'));
  assert.ok(item.fullText.includes('\n\n'));
  assert.equal(item.body, item.fullText);
  assert.equal(item.imageUrl, 'https://tvtver.ru/photo.jpg');
});

test('undated, very old and far-future stories are not queued', () => {
  assert.equal(fresh({ publishedAt: '2009-12-03T22:52:07Z' }, now, 14), false);
  assert.equal(fresh({ publishedAt: null }, now, 14), false);
  assert.equal(fresh({ publishedAt: 'not-a-date' }, now, 14), false);
  assert.equal(fresh({ publishedAt: '2026-12-01' }, now, 14), false);
  assert.equal(fresh({ publishedAt: '2026-10-08T16:05:27Z' }, now, 14), true);
});

test('filtering happens before the per-source limit and one failed feed does not stop others', async () => {
  const housing = { title: 'В Твери ремонтируют жилой дом', body: '', publishedAt: '2026-10-10T17:00:00Z', url: 'https://tvtver.ru/news/dom/' };
  const items = [
    ...Array.from({ length: 5 }, (_, i) => ({ title: 'В Твери прошёл концерт ' + i, body: '', publishedAt: '2026-10-11T17:00:00Z', url: 'https://tvtver.ru/news/concert-' + i })),
    housing,
    { ...housing, url: 'https://tvtver.ru/news/old/', publishedAt: '2009-12-03' },
  ];
  const logs = [];
  const result = await collectSources([source, { ...source, name: 'Failed', feedUrl: 'failed' }], config,
    (event, data) => logs.push({ event, ...data }), {
      now,
      fetchFeed: async url => { if (url === 'failed') throw new Error('HTTP 502'); return { text: 'valid' }; },
      parse: async () => items,
    });
  assert.deepEqual(result.items, [housing]);
  assert.equal(result.failedSources, 1);
  assert.equal(result.successfulSources, 1);
  assert.ok(logs.some(entry => entry.event === 'source_error'));
});

test('multiple feeds do not duplicate the same original URL', async () => {
  const item = { title: 'В Твери строят многоквартирный дом', publishedAt: '2026-10-10T17:00:00Z', url: 'https://tvtver.ru/news/dom/' };
  const result = await collectSources([source, source], config, () => {}, {
    now, fetchFeed: async () => ({ text: 'valid' }), parse: async () => [item],
  });
  assert.equal(result.collected, 2);
  assert.equal(result.items.length, 1);
});
