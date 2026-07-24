import { describe, it, expect } from 'vitest';
import { dateRange, shiftDateStr, isoToLocalDateStr } from './dateRange';

// Simulates the day-bucketing logic in src/routes/api/stats/+server.ts (dailyCounts /
// per-day food & reaction grouping), using the real dateRange.ts helpers it depends on.
// This can't run the actual RequestHandler (needs a live D1 binding), so it exercises the
// same bucketing algorithm against an in-memory row set instead.
function bucketByLocalDate(rows: Array<{ created_at: string }>, timezone: string) {
  const byDate: Record<string, number> = {};
  for (const row of rows) {
    const date = isoToLocalDateStr(row.created_at, timezone);
    byDate[date] = (byDate[date] || 0) + 1;
  }
  return byDate;
}

describe('stats day-bucketing', () => {
  it('buckets a late-evening America/New_York entry into its local day, not the next UTC day', () => {
    // Same "key lime pie" scenario: 8pm July 23 America/New_York = 00:00 UTC July 24.
    const rows = [{ created_at: '2026-07-24T00:00:00.000Z' }];
    const buckets = bucketByLocalDate(rows, 'America/New_York');

    expect(buckets['2026-07-23']).toBe(1);
    expect(buckets['2026-07-24']).toBeUndefined();
  });

  it('window start (sinceIso) is anchored to local midnight, including a full trailing day', () => {
    const todayLocal = '2026-07-24';
    const days = 7;
    const sinceDateStr = shiftDateStr(todayLocal, -(days - 1));
    expect(sinceDateStr).toBe('2026-07-18');

    const sinceIso = dateRange(sinceDateStr, 'America/New_York').start;
    // Local midnight of 2026-07-18 in EDT (UTC-4) is 04:00 UTC.
    expect(sinceIso).toBe('2026-07-18T04:00:00.000Z');

    // An entry from 8pm local on the first day of the window must be included.
    const firstDayEntryIso = '2026-07-18T23:59:00.000Z'; // 7:59pm EDT July 18
    expect(firstDayEntryIso >= sinceIso).toBe(true);
  });

  it('dailyCounts date labels walk backward from local today using pure calendar math', () => {
    const todayLocal = '2026-07-24';
    const days = 3;
    const labels: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      labels.push(shiftDateStr(todayLocal, -i));
    }
    expect(labels).toEqual(['2026-07-22', '2026-07-23', '2026-07-24']);
  });

  it('groups entries and reactions from the same local day for correlation matching', () => {
    const foods = [{ created_at: '2026-07-24T02:00:00.000Z' }]; // 10pm July 23 EDT
    const reactions = [{ created_at: '2026-07-23T15:00:00.000Z' }]; // 11am July 23 EDT

    const foodDates = bucketByLocalDate(foods, 'America/New_York');
    const reactionDates = bucketByLocalDate(reactions, 'America/New_York');

    expect(Object.keys(foodDates)).toEqual(['2026-07-23']);
    expect(Object.keys(reactionDates)).toEqual(['2026-07-23']);
  });
});
