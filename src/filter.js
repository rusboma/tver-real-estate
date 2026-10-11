import {housing,region} from './region.js';
export function relevant(item) {
  const text = `${item.title} ${item.body || ''}`;
  return housing.test(text) && region.test(text);
}
