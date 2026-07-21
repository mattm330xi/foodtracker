CREATE TABLE IF NOT EXISTS user_allergens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ingredient TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_allergens_user ON user_allergens(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_allergens_user_ingredient ON user_allergens(user_id, ingredient);
