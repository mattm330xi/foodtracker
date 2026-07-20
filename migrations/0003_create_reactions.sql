CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symptom TEXT NOT NULL,
  severity INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_reactions_created_at ON reactions(created_at DESC);
