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
