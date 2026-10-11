import { load } from 'cheerio';
if (process.env.RENDER === 'true') {
  for (const channel of ['prokuraturatverskoioblasti','telega_tver','ngtver','gkhnewsru']) {
    try {
      const response = await fetch('https://t.me/s/' + channel, {signal:AbortSignal.timeout(12000)});
      const html = await response.text();
      const $ = load(html);
      const posts = $('.tgme_widget_message');
      console.log(JSON.stringify({event:'telegram_access_probe',channel,httpStatus:response.status,pageTitle:$('title').text().slice(0,100),posts:posts.length,textPosts:posts.filter((_,el)=>$(el).find('.tgme_widget_message_text').text().trim().length>0).length,latestDate:posts.last().find('time').attr('datetime')||null}));
    } catch (cause) {
      console.log(JSON.stringify({event:'telegram_access_probe',channel,error:cause instanceof Error ? cause.message : 'fetch_failed'}));
    }
  }
}
