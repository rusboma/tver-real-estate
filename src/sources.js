// Only enable a source after confirming its official RSS/Atom/API access method.
export const sources = [
  { name: 'Афанасий', url: 'https://www.afanasy.biz/', feedUrl: 'https://www.afanasy.biz/rss/yandex_rss_news.xml', tier: 'B', sourceType: 'media' },
  { name: 'Tverstat', url: 'https://69.rosstat.gov.ru/', feedUrl: null, tier: 'A', sourceType: 'official' },
  { name: 'Тверская городская Дума', url: 'https://duma.tver.ru/', feedUrl: null, tier: 'A', sourceType: 'official' },
  { name: 'НАШ.ДОМ.РФ', url: 'https://наш.дом.рф/', feedUrl: null, tier: 'A', sourceType: 'registry' },
  { name: 'ЦИАН', url: 'https://tver.cian.ru/', feedUrl: null, tier: 'B', sourceType: 'market' },
  { name: 'Яндекс Недвижимость', url: 'https://realty.yandex.ru/tver/', feedUrl: null, tier: 'B', sourceType: 'market' }
];
