export const NATIONAL_STREAM_NAME = 'Новости ЖКХ. Интересное для Твери';
const web = (name,url,options={}) => ({name,url,adapter:'website',tier:'B',sourceType:'national_media',editorialStream:'national',national:true,maxPages:5,disabledReason:'Проверка доступа к новостной ленте',...options});
export const nationalSources = [
 web('РосКвартал','https://roskvartal.ru/',{listUrl:'https://roskvartal.ru/news'}),
 web('Бурмистр.ру','https://burmistr.ru/'),
 web('АКАТО','https://acato.ru/',{listUrl:'https://acato.ru/articles',sourceType:'national_training'}),
 web('НАСОУН','https://nasoun.ru/',{sourceType:'national_association'}),
 web('Ассоциация Новое качество','https://www.neo-q.ru/',{sourceType:'national_association'}),
 web('Квартплата 24','https://www.kvp24.ru/',{sourceType:'national_vendor'}),
 web('Doma.ai — Блог Домов','https://doma.ai/',{listUrl:'https://doma.ai/blog',sourceType:'national_vendor'}),
 web('Домиленд','https://domyland.ru/',{listUrl:'https://domyland.ru/news-and-events',sourceType:'national_vendor'}),
 web('ЕРЗ.РФ — практики управления','https://erzrf.ru/',{listUrl:'https://erzrf.ru/news'}),
 web('CleanNow','https://www.cleannow.ru/'),
 web('АРУК','https://arukrus.ru/',{sourceType:'national_association'}),
 web('Национальный лифтовый союз','https://www.lift.ru/',{listUrl:'https://www.lift.ru/index.php/ru/news.html',sourceType:'national_association'}),
 web('Болид — новости и обучение','https://bolid.ru/',{listUrl:'https://bolid.ru/about/news/',sourceType:'national_vendor'}),
 web('RUБЕЖ — технологии ЖКХ','https://ru-bezh.ru/',{listUrl:'https://ru-bezh.ru/bezopasnost-v-sfere-zhkh/novinki/'}),
 web('СОК — инженерные системы','https://www.c-o-k.ru/',{listUrl:'https://www.c-o-k.ru/market_news'}),
 web('АВОК — вебинары','https://webinar.abok.ru/',{sourceType:'national_training'}),
 web('BEWARD — домофония','https://www.beward.ru/',{listUrl:'https://www.beward.ru/news/',sourceType:'national_vendor'}),
 web('DoorHan — доступ и шлагбаумы','https://doorhan.ru/',{listUrl:'https://doorhan.ru/news/2026/',sourceType:'national_vendor'}),
 web('UtiliCon','https://utilicon.ru/',{sourceType:'national_events'}),
 web('CleanExpo Moscow','https://www.cleanexpo-moscow.ru/',{listUrl:'https://www.cleanexpo-moscow.ru/ru-RU',sourceType:'national_events'}),
 web('Securika Moscow','https://securika-moscow.ru/',{sourceType:'national_events'}),
 web('Heat&Power','https://www.heatpower-expo.ru/',{listUrl:'https://www.heatpower-expo.ru/ru-RU',sourceType:'national_events'})
];
