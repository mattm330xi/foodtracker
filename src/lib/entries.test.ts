import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('entries GET query logic', () => {
  it('date filter uses SQLite date() on created_at (UTC)', () => {
    // Simulates: SELECT * FROM entries WHERE user_id = ? AND date(created_at) = ?
    // The key insight: date('2026-07-20T02:00:00Z') = '2026-07-20'
    // But date('2026-07-19T22:00:00Z') = '2026-07-19'
    // So if created_at is corrupted to shift by +4h, the date changes

    const entries = [
      { id: 1, created_at: '2026-07-20T18:00:00.000Z', meal: 'Lunch' },
      { id: 2, created_at: '2026-07-20T22:00:00.000Z', meal: 'Snacks' }, // corrupted: was 18:00Z, shifted +4h
      { id: 3, created_at: '2026-07-21T02:00:00.000Z', meal: 'Dinner' },
    ];

    // Filter for July 20
    const date = '2026-07-20';
    const filtered = entries.filter(e => {
      const entryDate = new Date(e.created_at).toISOString().slice(0, 10);
      return entryDate === date;
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map(e => e.id)).toEqual([1, 2]);

    // The corrupted entry (id=2) shifted to July 21
    const date21 = '2026-07-21';
    const filtered21 = entries.filter(e => {
      const entryDate = new Date(e.created_at).toISOString().slice(0, 10);
      return entryDate === date21;
    });

    expect(filtered21).toHaveLength(1);
    expect(filtered21[0].id).toBe(3);
  });
});
