CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

ALTER TABLE entries ADD COLUMN user_id INTEGER DEFAULT NULL;
ALTER TABLE reactions ADD COLUMN user_id INTEGER DEFAULT NULL;
ALTER TABLE favorites ADD COLUMN user_id INTEGER DEFAULT NULL;
ALTER TABLE meal_templates ADD COLUMN user_id INTEGER DEFAULT NULL;

CREATE INDEX idx_entries_user ON entries(user_id, created_at DESC);
CREATE INDEX idx_reactions_user ON reactions(user_id, created_at DESC);
CREATE INDEX idx_favorites_user ON favorites(user_id, use_count DESC);
CREATE INDEX idx_templates_user ON meal_templates(user_id);
