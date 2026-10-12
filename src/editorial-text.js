// Read-time editorial cleanup. The source snapshot stays unchanged for verification.
export function cleanEditorialText(value, options = {}) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let blocks = value.replace(/\r\n?/g, '\n').split(/\n+/).map(s => s.replace(/[\t \u00a0]+/g, ' ').trim()).filter(Boolean);
  const title = String(options.title || '').trim();
  const program = blocks.findIndex(s => /^Программа (?:семинара|вебинара|курса|мероприятия)\s*:?$/i.test(s));
  const course = /(?:webinar\.|\/events\/|\/webinar\/)/i.test(options.url || '') || program >= 0;
  const advertising = blocks.some(s => /^Реклама\s+(?:ООО|АО|ИП)(?=\s|$)/i.test(s));
  if (course && program >= 0) blocks = blocks.slice(program + 1);
  const kept = [];
  let skipSection = false;
  const resume = /^(?:Программа(?:\s|:)|(?:\d+[.)]\s*)?(?:Основания заключения|Условия договора|Порядок заключения|Срок действия|Судебная практика)|Описание(?:\s|:)|О мероприятии|Темы(?:\s|:)|Содержание(?:\s|:))/i;
  const footer = /^(?:Комментарии(?:\s*\(\d+\))?|Другие новости по теме|Читайте также|Похожие (?:статьи|материалы|новости)|Рекомендуем(?: прочитать)?|Вам также может быть интересно|Реклама на сайте|Реклама на сайтах|Как вам (?:эта )?статья|Вам понравилась статья|Понравилась (?:ли вам )?статья|Оцените (?:эту )?статью|Нравится (?:ли вам )?(?:эта )?статья|Вам нравится (?:эта )?статья|Понравился (?:ли вам )?материал|Была ли (?:эта )?статья полезна|Оставьте (?:свой )?комментарий|Что вы думаете об (?:этой статье|этом материале)|Поделиться (?:статьёй|статьей|новостью)|Поделитесь (?:своим )?мнением)(?:\s|$|[?!:])/i;
  const service = /^(?:Главная|Архив семинаров|Список семинаров|Подробнее|Другие отзывы|Ответить|Цитировать|Войти|Подписаться|Оформить заявку|Рассчитать тариф|Дополнительные|скидки|Зарабатывайте на МКД больше.*|Распечатать программу.*|Записаться и скачать запись.*|Чтобы задать вопрос необходимо авторизоваться|Личный кабинет|X)$/i;
  const commercialSection = /^(?:Стоимость (?:участия|обучения|курса|семинара|вебинара)|Цена (?:участия|курса|обучения)|Условия (?:участия|оплаты|регистрации)|Список участников|Списки участников|Категории участников|Для кого (?:этот )?(?:курс|семинар|вебинар)|К участию приглашаются|СКИДКИ|Раздаточные материалы|Каждому участнику семинара выдается|Каждый заявленный участник|Участники семинаров имеют право|Участникам мероприятия.*(?:доступ|предоставлен)|Контакты (?:для регистрации|организатора))/i;
  for (let i = 0; i < blocks.length; i++) {
    let text = blocks[i];
    if (footer.test(text)) break;
    if (/^Полная версия доступна только подписчикам$/i.test(text)) { kept.push('В источнике доступен только фрагмент статьи.'); break; }
    if (course && commercialSection.test(text)) { skipSection = true; continue; }
    if (skipSection) { if (!resume.test(text)) continue; skipSection = false; }
    if (service.test(text) || text === title) continue;
    if (/^(?:Реклама\s+(?:ООО|АО|ИП)|erid\s*:)/i.test(text)) continue;
    if (course && /^(?:\d[\d .,]*\s*(?:руб\.?|₽)(?:\s*.*)?|\d+\s*%|%|Дополнительная скидка.*)$/i.test(text)) continue;
    if (/^(?:Подписывайтесь|Подпишитесь)\s+(?:на наш|на канал|на рассылку|и получайте)/i.test(text)) continue;
    if (/^(?:Купить|Заказать|Записаться|Зарегистрироваться|Скачать запись|Перейти к оплате)(?:\s|$)/i.test(text) && text.length < 140) continue;
    if (/^Вопросы$/i.test(text) && /^Чтобы задать вопрос/.test(blocks[i + 1] || '')) break;
    // Remove only an explicit commercial call to action inside a substantive paragraph.
    text = text.replace(/(?:^|\s)(?:Попробуйте|Попробовать)\s+(?:платформу|сервис|приложение)[^!?\n]{0,120}бесплатно[.!]?/gi, '').trim();
    if (text) kept.push(text);
  }
  const result = kept.join('\n\n');
  return advertising && result ? 'Рекламный материал источника.\n\n' + result : result;
}
