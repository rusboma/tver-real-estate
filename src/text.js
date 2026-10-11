import { load } from 'cheerio';

export function plainText(value) {
  if (!value) return '';
  const $ = load(String(value));
  $('script,style,iframe,nav,aside,form').remove();
  $('br').replaceWith('\n');
  $('p,div,li,h2,h3,h4,blockquote').each((_, element) => {
    $(element).append('\n\n');
  });
  return $.root().text().replace(/\r/g, '').replace(/\u00a0/g, ' ')
    .split(/\n+/).map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(line => line && !/^Читайте также:/i.test(line)).join('\n\n');
}

export function publicImageUrl(value, base) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
