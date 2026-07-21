-- Drop redundant index: sessions.token UNIQUE constraint already creates an implicit index
DROP INDEX IF EXISTS idx_sessions_token;

-- Critical: session validation runs on every authenticated request
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Favorites dedup lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_user_text ON favorites(user_id, text);

-- Templates sort
CREATE INDEX IF NOT EXISTS idx_templates_user_created ON meal_templates(user_id, created_at DESC);

-- Credentials sort (profile page)
CREATE INDEX IF NOT EXISTS idx_credentials_user_created ON credentials(user_id, created_at DESC);
