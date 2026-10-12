import {nationalSources} from './national-sources.js';
import {regionalSources} from './regional-sources.js';
// Active sources have a verified public feed, Telegram page or dated news page.
export const sources = [
  ...nationalSources,
  ...regionalSources,
  {name:'Telegram — Прокуратура Тверской области',url:'https://t.me/prokuraturatverskoioblasti',channel:'prokuraturatverskoioblasti',adapter:'telegram',tier:'A',sourceType:'telegram',localChannel:true},
  {name:'Telegram — Тверская Телега',url:'https://t.me/telega_tver',channel:'telega_tver',adapter:'telegram',tier:'B',sourceType:'telegram',localChannel:true},
  {name:'Telegram — Новый Город',url:'https://t.me/ngtver',channel:'ngtver',adapter:'telegram',tier:'B',sourceType:'telegram',localChannel:true,developer:true},
  {name:'Telegram — ЖКХ Ньюс',url:'https://t.me/gkhnewsru',channel:'gkhnewsru',adapter:'telegram',tier:'B',sourceType:'telegram',localChannel:false},
  { name: 'Прокуратура Тверской области', url: 'https://epp.genproc.gov.ru/ru/proc_69/', adapter: 'prosecutor', listUrls: ['https://epp.genproc.gov.ru/ru/proc_69/mass-media/news/main/', 'https://epp.genproc.gov.ru/ru/proc_69/mass-media/news/regional/'], tier: 'A', sourceType: 'official_news' },
  { name: 'Афанасий', url: 'https://www.afanasy.biz/', feedUrl: 'https://www.afanasy.biz/rss/yandex_rss_news.xml', tier: 'B', sourceType: 'media' },
  { name: 'TVTver', url: 'https://tvtver.ru/', feedUrl: 'https://tvtver.ru/?yandex_feed=news', tier: 'B', sourceType: 'local_media' },
  { name: 'Тверская городская Дума', url: 'https://www.tverduma.ru/', feedUrl: 'https://www.tverduma.ru/news/rss.php', tier: 'A', sourceType: 'municipal' },
  { name: 'МЧС России по Тверской области', url: 'https://69.mchs.gov.ru/', feedUrl: 'https://69.mchs.gov.ru/deyatelnost/press-centr/vse_novosti/rss', tier: 'A', sourceType: 'official_news' },
  { name: 'Tverstat', url: 'https://69.rosstat.gov.ru/', feedUrl: null, tier: 'A', sourceType: 'official' },
  { name: 'НАШ.ДОМ.РФ', url: 'https://наш.дом.рф/', feedUrl: null, tier: 'A', sourceType: 'registry' },
  { name: 'ЦИАН', url: 'https://tver.cian.ru/', feedUrl: null, tier: 'B', sourceType: 'market' },
  { name: 'Яндекс Недвижимость', url: 'https://realty.yandex.ru/tver/', feedUrl: null, tier: 'B', sourceType: 'market' }
];
