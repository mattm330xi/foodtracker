/**
 * Convert a user's local date + edited time to a UTC ISO string.
 *
 * The key invariant: the browser's `new Date("YYYY-MM-DDThh:mm")` (no timezone
 * suffix) is parsed as LOCAL time. Calling `.toISOString()` on that Date gives
 * the correct UTC representation — no manual offset math needed.
 */
export function localToUTCiso(
  originalCreatedAt: string,
  editedTime: string,       // "HH:MM"
  timezone: string
): string {
  const d = new Date(originalCreatedAt);
  const localDateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
  const tzDate = new Date(`${localDateStr}T${editedTime}:00`);
  return tzDate.toISOString();
}
