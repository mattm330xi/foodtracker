import { describe, it, expect } from 'vitest';
import { dateRange } from './dateRange';

describe('dateRange', () => {
  it('returns correct bounds for a normal date', () => {
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
});
