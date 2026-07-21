/**
 * Convert a YYYY-MM-DD date string to ISO range bounds for index-friendly queries.
 * Target range: [YYYY-MM-DDT00:00:00.000Z, (YYYY-MM-DD + 1 day)T00:00:00.000Z)
 */
export function dateRange(dateStr: string): { start: string; end: string } {
  const start = `${dateStr}T00:00:00.000Z`;

  const [year, month, day] = dateStr.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const end = nextDate.toISOString();

  return { start, end };
}
