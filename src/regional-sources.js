// Every requested source is catalogued. Paused sources need a verified accessible news interface.
const web=(name,url,options={})=>({name,url,adapter:'website',tier:'B',sourceType:'local_media',...options});
export const regionalSources=[
 {name:'Telegram — Иллидиум',url:'https://t.me/illidium',channel:'illidium',adapter:'telegram',tier:'B',sourceType:'telegram',localChannel:true,developer:true},
 {name:'Telegram — Жилищный инспектор',url:'https://t.me/zhilinspektor',channel:'zhilinspektor',adapter:'telegram',tier:'B',sourceType:'telegram',localChannel:false},
 web('Иллидиум','https://illidium.com/',{listUrl:'https://illidium.com/novosti/',articlePattern:'/novosti/',sourceType:'developer',developer:true}),
 web('Тверской ДСК','https://dsktver.com/',{disabledReason:'На официальном сайте не найдена датированная новостная лента',sourceType:'developer'}),
 web('Тверь Водоканал','https://www.tvervodokanal.ru/',{feedUrl:'https://www.tvervodokanal.ru/index.php?format=feed&type=rss',tier:'A',sourceType:'utility'}),
 web('ОЭС Тверской области','https://www.oes-tver.ru/',{disabledReason:'robots.txt запрещает автоматический сбор для сторонних роботов',listUrl:'https://www.oes-tver.ru/news',articlePattern:'/news/',tier:'A',sourceType:'utility'}),
 web('УК Звезда Тверь','https://uk-zvezda.ru/',{disabledReason:'Страница новостей не содержит доступных датированных публикаций',sourceType:'management_company'}),
 web('ТСЖ 1-й переулок Красной Слободы, 3','https://tsjtver.kvado.ru/',{articlePattern:'/news/[0-9]+',sourceType:'homeowners_association'}),
 web('Администрация Твери — ЖКХ','https://www.tver.ru/',{listUrl:'https://www.tver.ru/about/info/news/',articlePattern:'/about/info/news/',tier:'A',sourceType:'municipal'}),
 web('Тверские ведомости','https://vedtver.ru/'),
 web('Кимрский вестник','https://kimvestnik.ru/',{feedUrl:'https://kimvestnik.ru/feed'}),
 web('Бежецкая жизнь','https://bzgazeta.ru/',{feedUrl:'https://bzgazeta.ru/feed'}),
 web('Селигер','https://seliger-news.ru/',{maxPages:2}),
 web('Конаковская народная газета','https://gazeta-konakovo.ru/'),
 web('Администрация Кашинского округа — ЖКХ','https://www.kashin.info/',{feedUrl:'https://www.kashin.info/materialy/zhkkh?format=feed&type=rss',tier:'A',sourceType:'municipal'}),
 web('Администрация Вышневолоцкого округа','https://v-volok.ru/',{listUrl:'https://v-volok.ru/about/info/news/',articlePattern:'/about/info/news/[0-9]+',maxPages:3,tier:'A',sourceType:'municipal'}),
 web('Администрация Лихославльского округа','https://lihoslavl69.ru/',{feedUrl:'https://lihoslavl69.ru/feed',tier:'A',sourceType:'municipal'}),
 web('Администрация Торопецкого округа','https://toropecadm.ru/',{listUrl:'https://toropecadm.ru/news.html',articlePattern:'\\.html$',maxPages:4,tier:'A',sourceType:'municipal'}),
 web('МУП ЖКУ Осташков','https://xn----8sbgnuc0acykh9d.xn--p1ai/',{tier:'A',sourceType:'utility'}),
 web('Ржевская правда','https://presska.ru/',{disabledReason:'Сайт содержит стартовую запись WordPress вместо новостной ленты'}),
 web('MAX — Тверь Водоканал','https://max.ru/id6901093516_gos',{disabledReason:'Публичный адаптер MAX не подключён; новости собираются с сайта Водоканала',sourceType:'messenger'})
];
