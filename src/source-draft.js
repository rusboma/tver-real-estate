// Extractive fallback: no invented facts and no dependency on AI quota.
export function buildSourceDraft(article, text, eventOnly = false) {
  const title = String(article.title || '').trim().slice(0,240);
  const paragraphs = String(text || '').split(/\n+/).map(value => value.trim()).filter(value =>
    value.length >= 20 && value !== title &&
    !/^Рекламный материал источника\.?$/i.test(value) &&
    !/^В источнике доступен только фрагмент статьи\.?$/i.test(value));
  if (!paragraphs.length || paragraphs.join(' ').length < 80) throw new Error('SOURCE_DRAFT_INSUFFICIENT');
  const clip = (value, limit) => {
    if (value.length <= limit) return value;
    const head = value.slice(0,limit-1);
    const space = head.lastIndexOf(' ');
    return head.slice(0,space>limit/2?space:head.length).trimEnd()+'…';
  };
  const lead = eventOnly
    ? 'В источнике опубликована программа мероприятия «'+title+'». Это анонс, а не отчёт о его проведении.'
    : paragraphs.length > 1 ? clip(paragraphs[0],500) : 'Источник сообщает: «'+title+'».';
  let selected = paragraphs.length > 1 && !eventOnly ? paragraphs.slice(1) : paragraphs;
  if (selected.join(' ').length < 80) selected = paragraphs;
  const body = clip(selected.join('\n\n'),1800);
  const quote = paragraphs[0].slice(0,Math.min(paragraphs[0].length,400)).trim();
  return {
    title,lead,body,
    verification_notes:'Резервный черновик без AI: составлен из сокращённых фрагментов источника из-за ограничения сервиса. Перед одобрением отредактируйте текст, проверьте полноту, даты и факты.'+
      (/Рекламный материал источника/i.test(text)?' Источник содержит рекламную маркировку.':''),
    content_kind:eventOnly?'event_announcement':'news',
    facts:[{claim:clip(quote,180),quote}],
  };
}
