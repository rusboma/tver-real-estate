// Only enable a source after confirming its official RSS/Atom/API access method.
export const sources = [
  { name: 'Афанасий', url: 'https://www.afanasy.biz/', feedUrl: 'https://www.afanasy.biz/rss/yandex_rss_news.xml', tier: 'B', sourceType: 'media' },
  { name: 'TVTver', url: 'https://tvtver.ru/', feedUrl: 'https://tvtver.ru/?yandex_feed=news', tier: 'B', sourceType: 'local_media' },
  { name: 'Тверская городская Дума', url: 'https://www.tverduma.ru/', feedUrl: 'https://www.tverduma.ru/news/rss.php', tier: 'A', sourceType: 'municipal' },
  { name: 'МЧС России по Тверской области', url: 'https://69.mchs.gov.ru/', feedUrl: 'https://69.mchs.gov.ru/deyatelnost/press-centr/vse_novosti/rss', tier: 'A', sourceType: 'official_news' },
  { name: 'Tverstat', url: 'https://69.rosstat.gov.ru/', feedUrl: null, tier: 'A', sourceType: 'official' },
  { name: 'НАШ.ДОМ.РФ', url: 'https://наш.дом.рф/', feedUrl: null, tier: 'A', sourceType: 'registry' },
  { name: 'ЦИАН', url: 'https://tver.cian.ru/', feedUrl: null, tier: 'B', sourceType: 'market' },
  { name: 'Яндекс Недвижимость', url: 'https://realty.yandex.ru/tver/', feedUrl: null, tier: 'B', sourceType: 'market' }
];
