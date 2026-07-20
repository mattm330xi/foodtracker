CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  image TEXT DEFAULT '',
  meal TEXT DEFAULT 'Snacks',
  use_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_favorites_use_count ON favorites(use_count DESC);

CREATE TABLE IF NOT EXISTS meal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  items TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
