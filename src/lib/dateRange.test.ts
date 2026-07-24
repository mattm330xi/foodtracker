import { describe, it, expect } from 'vitest';
import { dateRange, zonedTimeToUtc, shiftDateStr, isoToLocalDateStr } from './dateRange';

describe('dateRange', () => {
  it('returns correct bounds for a normal date (UTC default)', () => {
    const { start, end } = dateRange('2026-07-21');
    expect(start).toBe('2026-07-21T00:00:00.000Z');
    expect(end).toBe('2026-07-22T00:00:00.000Z');
  });

  it('returns correct bounds for month boundary', () => {
    const { start, end } = dateRange('2026-01-31');
    expect(start).toBe('2026-01-31T00:00:00.000Z');
    expect(end).toBe('2026-02-01T00:00:00.000Z');
  });

  it('returns correct bounds for year boundary', () => {
    const { start, end } = dateRange('2026-12-31');
    expect(start).toBe('2026-12-31T00:00:00.000Z');
    expect(end).toBe('2027-01-01T00:00:00.000Z');
  });

  it('returns correct bounds for leap year', () => {
    const { start, end } = dateRange('2028-02-28');
    expect(start).toBe('2028-02-28T00:00:00.000Z');
    expect(end).toBe('2028-02-29T00:00:00.000Z');
  });

  it('end is exactly 24 hours after start', () => {
    const { start, end } = dateRange('2026-07-21');
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000);
  });

  it('offsets bounds to local midnight for a UTC-negative timezone (EDT, summer)', () => {
    // America/New_York is UTC-4 in July (EDT) -> local midnight is 04:00 UTC.
    const { start, end } = dateRange('2026-07-21', 'America/New_York');
    expect(start).toBe('2026-07-21T04:00:00.000Z');
    expect(end).toBe('2026-07-22T04:00:00.000Z');
  });

  it('offsets bounds to local midnight for a UTC-negative timezone (EST, winter)', () => {
    // America/New_York is UTC-5 in January (EST, no DST) -> local midnight is 05:00 UTC.
    const { start, end } = dateRange('2026-01-15', 'America/New_York');
    expect(start).toBe('2026-01-15T05:00:00.000Z');
    expect(end).toBe('2026-01-16T05:00:00.000Z');
  });

  it('a late-evening entry falls within its own local day, not the next (regression for key lime pie bug)', () => {
    // 8:00pm America/New_York on July 23 is 00:00 UTC on July 24 -- past UTC midnight,
    // but still "July 23" to the user. The dateRange for July 23 in that timezone must
    // contain this instant; the July 24 range must not.
    const entryInstant = zonedTimeToUtc('2026-07-23', '20:00:00', 'America/New_York');
    const entryMs = entryInstant.getTime();

    const july23 = dateRange('2026-07-23', 'America/New_York');
    expect(entryMs).toBeGreaterThanOrEqual(new Date(july23.start).getTime());
    expect(entryMs).toBeLessThan(new Date(july23.end).getTime());

    const july24 = dateRange('2026-07-24', 'America/New_York');
    expect(entryMs).toBeLessThan(new Date(july24.start).getTime());
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a local wall-clock time to the correct UTC instant (EDT)', () => {
    const instant = zonedTimeToUtc('2026-07-23', '20:00:00', 'America/New_York');
    expect(instant.toISOString()).toBe('2026-07-24T00:00:00.000Z');
  });

  it('converts a local wall-clock time to the correct UTC instant (EST)', () => {
    const instant = zonedTimeToUtc('2026-01-15', '20:00:00', 'America/New_York');
    expect(instant.toISOString()).toBe('2026-01-16T01:00:00.000Z');
  });

  it('handles the spring-forward DST transition (America/New_York, 2026-03-08)', () => {
    // 2026-03-08 02:00 local doesn't exist (clocks jump 2:00 -> 3:00 EDT); before the
    // transition (01:30 EST, UTC-5) and after (03:30 EDT, UTC-4) must resolve correctly.
    const before = zonedTimeToUtc('2026-03-08', '01:30:00', 'America/New_York');
    expect(before.toISOString()).toBe('2026-03-08T06:30:00.000Z');
    const after = zonedTimeToUtc('2026-03-08', '03:30:00', 'America/New_York');
    expect(after.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('handles the fall-back DST transition (America/New_York, 2026-11-01)', () => {
    // Clocks fall back 2:00 EDT -> 1:00 EST; time just before midnight local resolves
    // using the now-in-effect EST offset (UTC-5).
    const instant = zonedTimeToUtc('2026-11-01', '23:30:00', 'America/New_York');
    expect(instant.toISOString()).toBe('2026-11-02T04:30:00.000Z');
  });

  it('is a no-op offset for UTC', () => {
    const instant = zonedTimeToUtc('2026-07-21', '12:00:00', 'UTC');
    expect(instant.toISOString()).toBe('2026-07-21T12:00:00.000Z');
  });
});

describe('shiftDateStr', () => {
  it('shifts forward within a month', () => {
    expect(shiftDateStr('2026-07-21', 1)).toBe('2026-07-22');
  });

  it('shifts backward across a month boundary', () => {
    expect(shiftDateStr('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('shifts forward across a year boundary', () => {
    expect(shiftDateStr('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('shifts backward across a leap-year February boundary', () => {
    expect(shiftDateStr('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('supports multi-day shifts', () => {
    expect(shiftDateStr('2026-07-21', -7)).toBe('2026-07-14');
  });

  it('is a no-op for a zero shift', () => {
    expect(shiftDateStr('2026-07-21', 0)).toBe('2026-07-21');
  });
});

describe('isoToLocalDateStr', () => {
  it('returns the same UTC date when timezone is UTC', () => {
    expect(isoToLocalDateStr('2026-07-21T15:00:00.000Z', 'UTC')).toBe('2026-07-21');
  });

  it('rolls back to the previous local day for a late-UTC instant (EDT)', () => {
    // 2026-07-24T00:00:00Z is still July 23 at 8pm in America/New_York.
    expect(isoToLocalDateStr('2026-07-24T00:00:00.000Z', 'America/New_York')).toBe('2026-07-23');
  });

  it('rolls forward to the next local day for a UTC-positive timezone', () => {
    // 2026-07-21T23:00:00Z is already July 22 at 08:00 in Asia/Tokyo (UTC+9).
    expect(isoToLocalDateStr('2026-07-21T23:00:00.000Z', 'Asia/Tokyo')).toBe('2026-07-22');
  });
});
