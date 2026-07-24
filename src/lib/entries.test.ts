import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dateRange } from './dateRange';

// ─── Mock D1 database ──────────────────────────────────────
function createMockDB() {
  const store = new Map<number, any>();
  let nextId = 1;

  const bind = vi.fn((...args: any[]) => ({
    run: vi.fn(async () => {
      return { meta: { last_row_id: nextId++ } };
    }),
    all: vi.fn(async () => ({
      results: Array.from(store.values()),
    })),
  }));

  const prepare = vi.fn((sql: string) => ({
    bind: bind,
  }));

  return { db: { prepare, _store: store }, prepare, bind };
}

// ─── Simulate the PATCH handler logic ──────────────────────
// Replicates the server-side PATCH logic for testing without full SvelteKit context
function patchEntry(
  db: any,
  id: number,
  meal?: string,
  created_at?: string,
  userId?: number,
  text?: string,
  allergen_warnings?: string[] | null,
) {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (meal !== undefined) { fields.push('meal = ?'); values.push(meal); }
  if (created_at !== undefined) { fields.push('created_at = ?'); values.push(created_at); }
  if (text !== undefined) { fields.push('text = ?'); values.push(text); }
  if (allergen_warnings !== undefined) {
    fields.push('allergen_warnings = ?');
    values.push(allergen_warnings === null ? null : JSON.stringify(allergen_warnings));
  }

  if (fields.length > 0) {
    db.prepare(`UPDATE entries SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values, id, userId).run();
  }
}

// ─── Tests ─────────────────────────────────────────────────
describe('entries PATCH logic', () => {
  let mockDB: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    mockDB = createMockDB();
  });

  it('updates both meal and created_at in a single statement', () => {
    patchEntry(mockDB.db, 1, 'Snacks', '2026-07-20T18:00:00.000Z', 1);

    expect(mockDB.prepare).toHaveBeenCalledOnce();
    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET meal = ?, created_at = ? WHERE id = ? AND user_id = ?'
    );
    expect(mockDB.bind).toHaveBeenCalledWith('Snacks', '2026-07-20T18:00:00.000Z', 1, 1);
  });

  it('updates only meal when created_at is not provided', () => {
    patchEntry(mockDB.db, 1, 'Dinner', undefined, 1);

    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET meal = ? WHERE id = ? AND user_id = ?'
    );
    expect(mockDB.bind).toHaveBeenCalledWith('Dinner', 1, 1);
  });

  it('updates only created_at when meal is not provided', () => {
    patchEntry(mockDB.db, 1, undefined, '2026-07-20T20:00:00.000Z', 1);

    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET created_at = ? WHERE id = ? AND user_id = ?'
    );
    expect(mockDB.bind).toHaveBeenCalledWith('2026-07-20T20:00:00.000Z', 1, 1);
  });

  it('does nothing when neither meal nor created_at is provided', () => {
    patchEntry(mockDB.db, 1, undefined, undefined, 1);

    expect(mockDB.prepare).not.toHaveBeenCalled();
  });

  it('scoping: updates only the specified user_id', () => {
    patchEntry(mockDB.db, 1, 'Snacks', '2026-07-20T18:00:00.000Z', 42);

    expect(mockDB.bind).toHaveBeenCalledWith('Snacks', '2026-07-20T18:00:00.000Z', 1, 42);
  });

  it('updates only text when meal and created_at are not provided', () => {
    patchEntry(mockDB.db, 1, undefined, undefined, 1, 'Updated note');

    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET text = ? WHERE id = ? AND user_id = ?'
    );
    expect(mockDB.bind).toHaveBeenCalledWith('Updated note', 1, 1);
  });

  it('updates meal, created_at, and text together (full quick-edit save)', () => {
    patchEntry(mockDB.db, 1, 'Dinner', '2026-07-20T18:00:00.000Z', 1, 'Updated note');

    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET meal = ?, created_at = ?, text = ? WHERE id = ? AND user_id = ?'
    );
    expect(mockDB.bind).toHaveBeenCalledWith('Dinner', '2026-07-20T18:00:00.000Z', 'Updated note', 1, 1);
  });

  it('sets allergen_warnings as a JSON-stringified array', () => {
    patchEntry(mockDB.db, 1, undefined, undefined, 1, undefined, ['peanuts', 'dairy']);

    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET allergen_warnings = ? WHERE id = ? AND user_id = ?'
    );
    expect(mockDB.bind).toHaveBeenCalledWith('["peanuts","dairy"]', 1, 1);
  });

  it('clears allergen_warnings when explicitly set to null', () => {
    patchEntry(mockDB.db, 1, undefined, undefined, 1, undefined, null);

    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET allergen_warnings = ? WHERE id = ? AND user_id = ?'
    );
    expect(mockDB.bind).toHaveBeenCalledWith(null, 1, 1);
  });

  it('leaves allergen_warnings untouched when not provided', () => {
    patchEntry(mockDB.db, 1, 'Lunch', undefined, 1);

    expect(mockDB.prepare).toHaveBeenCalledWith(
      'UPDATE entries SET meal = ? WHERE id = ? AND user_id = ?'
    );
  });
});

// Simulates the real GET handler's range filter: WHERE created_at >= start AND created_at < end,
// using the actual dateRange() helper (not a hand-rolled approximation) so this test can't
// silently drift from the real implementation.
function filterByDate(entries: Array<{ id: number; created_at: string }>, date: string, timezone: string) {
  const { start, end } = dateRange(date, timezone);
  return entries.filter(e => e.created_at >= start && e.created_at < end);
}

describe('entries GET query logic', () => {
  it('filters entries within a UTC day using dateRange bounds', () => {
    const entries = [
      { id: 1, created_at: '2026-07-20T18:00:00.000Z', meal: 'Lunch' },
      { id: 2, created_at: '2026-07-20T22:00:00.000Z', meal: 'Snacks' },
      { id: 3, created_at: '2026-07-21T02:00:00.000Z', meal: 'Dinner' },
    ];

    const filtered20 = filterByDate(entries, '2026-07-20', 'UTC');
    expect(filtered20.map(e => e.id)).toEqual([1, 2]);

    const filtered21 = filterByDate(entries, '2026-07-21', 'UTC');
    expect(filtered21.map(e => e.id)).toEqual([3]);
  });

  it('regression: a late-evening entry in America/New_York stays on its local day, not the next UTC day', () => {
    // 8pm America/New_York on July 23 is stored as 2026-07-24T00:00:00.000Z in UTC.
    // With naive UTC-midnight day boundaries this would only show up under "July 24".
    // With timezone-aware boundaries it must show up under "July 23", matching what the
    // user actually experienced when they added the entry.
    const entries = [
      { id: 1, created_at: '2026-07-24T00:00:00.000Z', meal: 'Snacks' }, // "key lime pie"
    ];

    const july23 = filterByDate(entries, '2026-07-23', 'America/New_York');
    expect(july23.map(e => e.id)).toEqual([1]);

    const july24 = filterByDate(entries, '2026-07-24', 'America/New_York');
    expect(july24).toHaveLength(0);
  });
});
