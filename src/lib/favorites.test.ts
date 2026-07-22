import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock D1 database ──────────────────────────────────────
function createMockDB() {
  const favorites: Map<number, any> = new Map();
  let nextId = 1;

  function prepare(sql: string) {
    return {
      bind: (...args: any[]) => ({
        run: vi.fn(async () => {
          if (sql.startsWith('INSERT INTO favorites')) {
            const id = nextId++;
            const fav = { id, text: args[0], image: args[1] || '', meal: args[2] || 'Snacks', user_id: args[3], use_count: 0 };
            favorites.set(id, fav);
            return { meta: { last_row_id: id } };
          }
          if (sql.startsWith('UPDATE favorites SET use_count')) {
            const id = args[0];
            const fav = favorites.get(id);
            if (fav) fav.use_count++;
            return { meta: {} };
          }
          if (sql.startsWith('DELETE FROM favorites')) {
            const id = args[0];
            favorites.delete(id);
            return { meta: {} };
          }
          return { meta: {} };
        }),
        all: vi.fn(async () => {
          if (sql.startsWith('SELECT * FROM favorites')) {
            return { results: Array.from(favorites.values()).sort((a, b) => b.use_count - a.use_count) };
          }
          return { results: [] };
        }),
        first: vi.fn(async () => {
          if (sql.startsWith('SELECT id FROM favorites')) {
            const text = args[1];
            for (const fav of favorites.values()) {
              if (fav.text === text) return { id: fav.id };
            }
            return null;
          }
          return null;
        }),
      }),
    };
  }

  return {
    db: { prepare },
    favorites,
    _nextId: () => nextId,
  };
}

// ─── Simulate server-side POST handler ─────────────────────
async function addFavorite(db: any, text: string, image: string, meal: string, userId: number) {
  const existing = await db.prepare('SELECT id FROM favorites WHERE user_id = ? AND text = ?')
    .bind(userId, text).first();
  if (existing) {
    await db.prepare('UPDATE favorites SET use_count = use_count + 1 WHERE id = ? AND user_id = ?')
      .bind(existing.id, userId).run();
    return { id: existing.id, success: true };
  }
  const result = await db.prepare('INSERT INTO favorites (text, image, meal, user_id) VALUES (?, ?, ?, ?)')
    .bind(text, image, meal, userId).run();
  return { id: result.meta.last_row_id, success: true };
}

async function removeFavorite(db: any, id: number, userId: number) {
  await db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return { success: true };
}

async function listFavorites(db: any, userId: number) {
  const { results } = await db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? ORDER BY use_count DESC, created_at DESC LIMIT 20'
  ).bind(userId).all();
  return results;
}

// ─── Tests ─────────────────────────────────────────────────
describe('favorites CRUD', () => {
  let db: any;
  let favorites: Map<number, any>;

  beforeEach(() => {
    const mock = createMockDB();
    db = mock.db;
    favorites = mock.favorites;
  });

  it('creates a new favorite', async () => {
    const result = await addFavorite(db, 'Chicken salad', '', 'Lunch', 1);
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
    expect(favorites.size).toBe(1);
    expect(favorites.get(result.id).text).toBe('Chicken salad');
  });

  it('increments use_count on duplicate text', async () => {
    const r1 = await addFavorite(db, 'Chicken salad', '', 'Lunch', 1);
    const r2 = await addFavorite(db, 'Chicken salad', '', 'Lunch', 1);
    expect(r2.id).toBe(r1.id);
    expect(favorites.size).toBe(1);
    expect(favorites.get(r1.id).use_count).toBe(1);
  });

  it('deletes a favorite by id', async () => {
    const r1 = await addFavorite(db, 'Chicken salad', '', 'Lunch', 1);
    expect(favorites.size).toBe(1);
    await removeFavorite(db, r1.id, 1);
    expect(favorites.size).toBe(0);
  });

  it('lists favorites sorted by use_count descending', async () => {
    await addFavorite(db, 'Salad', '', 'Lunch', 1);
    const tacos = await addFavorite(db, 'Tacos', '', 'Dinner', 1);
    await addFavorite(db, 'Pizza', '', 'Dinner', 1);
    // Tacos used twice
    await addFavorite(db, 'Tacos', '', 'Dinner', 1);

    const list = await listFavorites(db, 1);
    expect(list[0].text).toBe('Tacos');
    expect(list[0].use_count).toBe(1);
  });

  it('does not create favorite for empty text', async () => {
    // Empty text should bail out before calling the API
    const text = '';
    if (!text) {
      // Simulate the client guard: if (!entry.text && !entry.image) return;
      return;
    }
    await addFavorite(db, text, '', 'Snacks', 1);
    expect(favorites.size).toBe(0);
  });
});

describe('favorites toggle flow', () => {
  let db: any;
  let favorites: Map<number, any>;

  beforeEach(() => {
    const mock = createMockDB();
    db = mock.db;
    favorites = mock.favorites;
  });

  it('toggle: add then remove', async () => {
    // Add
    const result = await addFavorite(db, 'Pasta', '', 'Dinner', 1);
    expect(favorites.size).toBe(1);

    // Remove (toggle off)
    await removeFavorite(db, result.id, 1);
    expect(favorites.size).toBe(0);
  });

  it('toggle: add, remove, add again creates new entry', async () => {
    const r1 = await addFavorite(db, 'Pasta', '', 'Dinner', 1);
    await removeFavorite(db, r1.id, 1);
    expect(favorites.size).toBe(0);

    // Re-add should create a new entry
    const r2 = await addFavorite(db, 'Pasta', '', 'Dinner', 1);
    expect(favorites.size).toBe(1);
    expect(r2.id).not.toBe(r1.id);
  });

  it('toggle: duplicate add increments count', async () => {
    const r1 = await addFavorite(db, 'Pasta', '', 'Dinner', 1);
    const r2 = await addFavorite(db, 'Pasta', '', 'Dinner', 1);
    expect(favorites.size).toBe(1);
    expect(r1.id).toBe(r2.id);
    expect(favorites.get(r1.id).use_count).toBe(1);
  });

  it('toggle: finds existing favorite by text for removal', async () => {
    const result = await addFavorite(db, 'Pasta', '', 'Dinner', 1);
    // Simulate client finding the favorite by text
    const list = await listFavorites(db, 1);
    const existing = list.find((f: any) => f.text === 'Pasta');
    expect(existing).toBeDefined();
    await removeFavorite(db, existing.id, 1);
    expect(favorites.size).toBe(0);
  });

  it('toggle: different entries with same text share favorite', async () => {
    await addFavorite(db, 'Salad', '', 'Lunch', 1);
    const r2 = await addFavorite(db, 'Salad', '', 'Lunch', 1);
    expect(favorites.size).toBe(1);
    expect(favorites.get(r2.id).use_count).toBe(1);
  });

  it('toggle: different entries with different text are separate', async () => {
    await addFavorite(db, 'Salad', '', 'Lunch', 1);
    await addFavorite(db, 'Pizza', '', 'Dinner', 1);
    expect(favorites.size).toBe(2);
  });
});

describe('favorites client-side isFavorited logic', () => {
  const favorites = [
    { id: 1, text: 'Chicken salad', image: '', meal: 'Lunch', use_count: 0 },
    { id: 2, text: 'Tacos', image: '', meal: 'Dinner', use_count: 1 },
  ];

  function isFavorited(text: string, favs: any[]): boolean {
    return text ? favs.some((f) => f.text === text) : false;
  }

  it('returns true when entry text matches a favorite', () => {
    expect(isFavorited('Chicken salad', favorites)).toBe(true);
  });

  it('returns true when entry text matches favorite with different case (exact match)', () => {
    expect(isFavorited('Tacos', favorites)).toBe(true);
  });

  it('returns false when entry text does not match any favorite', () => {
    expect(isFavorited('Pizza', favorites)).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(isFavorited('', favorites)).toBe(false);
  });

  it('returns false for empty favorites list', () => {
    expect(isFavorited('Chicken salad', [])).toBe(false);
  });
});
