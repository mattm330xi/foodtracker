/**
 * Timezone-aware date/time conversion for turning a "local calendar day" (as the
 * user sees it in their configured timezone) into correct UTC instants.
 *
 * Bug this fixes: entries created late in the evening in a UTC-negative timezone
 * (e.g. 8pm America/New_York = past midnight UTC) were stored with a correct UTC
 * `created_at`, but queried back with naive UTC-midnight-aligned day boundaries —
 * so they landed on "tomorrow" instead of "today" as the user experienced it.
 */

/**
 * Returns the offset (in ms) such that `localWallClockMillis = instant.getTime() + offset`,
 * where `localWallClockMillis` is the instant's date/time fields *as rendered in `timeZone`*,
 * reinterpreted as if they were UTC. Positive for timezones ahead of UTC, negative for behind.
 */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - instant.getTime();
}

/**
 * Converts a local calendar date + time-of-day in `timezone` to the true UTC instant
 * it represents. Handles DST via a two-pass offset lookup (refines using the first
 * pass's result, so a transition near the target time doesn't throw it off).
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute, second] = timeStr.split(':').map(Number);
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  let offsetMs = getTimeZoneOffsetMs(new Date(naiveUTC), timezone);
  let instantMs = naiveUTC - offsetMs;

  // Refine once more using the actual candidate instant, in case the first guess
  // landed on the wrong side of a DST transition.
  offsetMs = getTimeZoneOffsetMs(new Date(instantMs), timezone);
  instantMs = naiveUTC - offsetMs;

  return new Date(instantMs);
}

/**
 * Convert a YYYY-MM-DD date string, interpreted as a local calendar day in `timezone`,
 * to UTC ISO range bounds for index-friendly queries.
 * Target range: [local midnight of dateStr, local midnight of dateStr + 1 day), in UTC.
 *
 * `timezone` defaults to 'UTC' only as a defensive fallback — every real caller should
 * pass the user's actual configured timezone (`locals.timezone`).
 */
export function dateRange(dateStr: string, timezone: string = 'UTC'): { start: string; end: string } {
  const startDate = zonedTimeToUtc(dateStr, '00:00:00', timezone);
  const start = startDate.toISOString();
  const end = new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

  return { start, end };
}

/** Shift a YYYY-MM-DD date string by `deltaDays` (may be negative), pure calendar math. */
export function shiftDateStr(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

/** The local calendar date (YYYY-MM-DD) that a UTC ISO timestamp falls on in `timezone`. */
export function isoToLocalDateStr(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone });
}
