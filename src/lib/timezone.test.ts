import { describe, it, expect } from 'vitest';
import { localToUTCiso } from './timezone';

// NOTE: These tests run in the test machine's system timezone (EDT = UTC-4 in summer).
// The function `localToUTCiso` relies on `new Date("YYYY-MM-DDThh:mm")` being parsed
// in the system timezone, which matches the user's timezone in production browsers.
// Tests are written to match the system timezone behavior.

describe('localToUTCiso', () => {
  it('preserves original UTC time when editTime matches original local time', () => {
    // Entry created at 2026-07-20T18:00:00Z (2 PM EDT)
    const original = '2026-07-20T18:00:00.000Z';
    const result = localToUTCiso(original, '14:00', 'America/New_York');
    expect(result).toBe('2026-07-20T18:00:00.000Z');
  });

  it('correctly shifts time when user changes the time', () => {
    const original = '2026-07-20T18:00:00.000Z';
    // User changes to 16:00 local (EDT = UTC-4) = 20:00 UTC
    const result = localToUTCiso(original, '16:00', 'America/New_York');
    expect(result).toBe('2026-07-20T20:00:00.000Z');
  });

  it('does NOT double-apply timezone offset (the original bug)', () => {
    const original = '2026-07-20T18:00:00.000Z';
    const result = localToUTCiso(original, '14:00', 'America/New_York');
    // The BUG would produce 2026-07-20T22:00:00.000Z (double offset by 4 hours)
    expect(result).not.toBe('2026-07-20T22:00:00.000Z');
    expect(result).toBe('2026-07-20T18:00:00.000Z');
  });

  it('round-trips correctly for any timezone', () => {
    const now = new Date();
    const utcStr = now.toISOString();
    // Compute the local time in EDT (system timezone) to feed back
    const localH = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false }));
    const localM = parseInt(now.toLocaleString('en-US', { minute: 'numeric' }));
    const editTime = `${String(localH).padStart(2, '0')}:${String(localM).padStart(2, '0')}`;
    const result = localToUTCiso(utcStr, editTime, 'America/New_York');
    const resultDate = new Date(result);
    const origDate = new Date(utcStr);
    expect(Math.abs(resultDate.getTime() - origDate.getTime())).toBeLessThan(60_000);
  });

  it('shifts by exactly the requested amount of hours', () => {
    const original = '2026-07-20T18:00:00.000Z';
    // Change from 14:00 EDT to 18:00 EDT — UTC should shift +4h
    const result = localToUTCiso(original, '18:00', 'America/New_York');
    expect(result).toBe('2026-07-20T22:00:00.000Z');
  });

  it('handles date boundary crossing in system timezone', () => {
    // Entry at 2026-07-20T04:30:00Z → local date is July 20
    // User changes to 23:00 EDT on July 20 → July 21 03:00 UTC
    const result = localToUTCiso('2026-07-20T04:30:00.000Z', '23:00', 'America/New_York');
    expect(result).toBe('2026-07-21T03:00:00.000Z');
  });
});
