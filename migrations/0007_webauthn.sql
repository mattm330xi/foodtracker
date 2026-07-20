-- Remove pin_hash from users (SQLite 3.35+ supports DROP COLUMN)
ALTER TABLE users DROP COLUMN pin_hash;

-- WebAuthn credentials table
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER DEFAULT 0,
  transports TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_credentials_user ON credentials(user_id);
CREATE INDEX idx_credentials_cred_id ON credentials(credential_id);

-- Create the default user and assign all existing data to them
INSERT OR IGNORE INTO users (username, timezone) VALUES ('mattm330xi@gmail.com', 'America/New_York');

UPDATE entries SET user_id = (SELECT id FROM users WHERE username = 'mattm330xi@gmail.com') WHERE user_id IS NULL;
UPDATE reactions SET user_id = (SELECT id FROM users WHERE username = 'mattm330xi@gmail.com') WHERE user_id IS NULL;
UPDATE favorites SET user_id = (SELECT id FROM users WHERE username = 'mattm330xi@gmail.com') WHERE user_id IS NULL;
UPDATE meal_templates SET user_id = (SELECT id FROM users WHERE username = 'mattm330xi@gmail.com') WHERE user_id IS NULL;
