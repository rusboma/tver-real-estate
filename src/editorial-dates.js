export function dateRange(from = '', to = '') {
  function parse(value) {
    if (!value) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('INVALID_DATE_RANGE');
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('INVALID_DATE_RANGE');
    return value;
  }
  const start=parse(from),end=parse(to);
  if (start && end && start>end) throw new Error('INVALID_DATE_RANGE');
  return {from:start,to:end};
}
