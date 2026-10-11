import {housingNews,region} from './region.js';
export function relevant(item) {
  const text = `${item.title} ${item.body || ''}`;
  return housingNews(item) && region.test(text);
}
