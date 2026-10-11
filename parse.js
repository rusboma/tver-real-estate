import Parser from 'rss-parser';
const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'tver-real-estate-scout/0.1' } });

export async function parseFeed(xml, source) {
  const feed = await parser.parseString(xml);
  return (feed.items || []).map((item) => ({
    sourceName: source.name,
    sourceUrl: source.url,
    externalId: item.guid || item.id || item.link || item.title,
    title: item.title?.trim() || 'Без заголовка',
    url: item.link || source.url,
    publishedAt: item.isoDate || item.pubDate || null,
    body: item.contentSnippet || item.content || item.summary || '',
    contentType: 'news',
    confidence: source.tier === 'A' ? 0.95 : source.tier === 'B' ? 0.8 : 0.5
  }));
}
