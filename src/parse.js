import Parser from 'rss-parser';
import { plainText, publicImageUrl } from './text.js';

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'tver-real-estate-scout/0.3' },
  customFields: { item: ['yandex:full-text', 'media:content', 'media:thumbnail'] },
});

export async function parseFeed(xml, source) {
  const feed = await parser.parseString(xml);
  return (feed.items || []).map(item => {
    const url = item.link || source.url;
    const fullText = plainText(item['content:encoded'] || item['yandex:full-text']);
    const summary = plainText(item.contentSnippet || item.content || item.summary || '');
    const image = item.enclosure?.url || item['media:content']?.$?.url ||
      item['media:thumbnail']?.$?.url;
    return {
      sourceName: source.name,
      sourceUrl: source.url,
      sourceTier: source.tier,
      sourceType: source.sourceType,
      externalId: item.guid || item.id || item.link || item.title,
      title: item.title?.trim() || 'Без заголовка',
      url,
      publishedAt: item.isoDate || item.pubDate || null,
      summary: summary || null,
      body: fullText || summary,
      fullText: fullText.length >= 100 ? fullText : null,
      imageUrl: publicImageUrl(image, url),
      contentType: 'news',
      confidence: source.tier === 'A' ? 0.95 : source.tier === 'B' ? 0.8 : 0.5,
    };
  });
}
