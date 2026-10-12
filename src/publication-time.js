// datetime-local is interpreted explicitly in Moscow, never in the browser timezone.
export function moscowSchedule(value, now = Date.now()) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error('INVALID_PLAN_TIME');
  const [,year,month,day,hour,minute] = match;
  const date = new Date(Date.UTC(+year,+month-1,+day,+hour,+minute));
  if (date.getUTCFullYear()!==+year || date.getUTCMonth()!==+month-1 || date.getUTCDate()!==+day || +hour>23 || +minute>59) throw new Error('INVALID_PLAN_TIME');
  const iso = value + ':00+03:00';
  const stamp = Date.parse(iso);
  if (stamp < now + 60000 || stamp > now + 365*86400000) throw new Error('INVALID_PLAN_TIME');
  return iso;
}
