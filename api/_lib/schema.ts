// Definicja schematu bazy — używana przez ensureSchema() oraz testy smoke.

export const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    pw_hash TEXT NOT NULL DEFAULT '',
    nick TEXT NOT NULL DEFAULT '',
    terms INTEGER NOT NULL DEFAULT 0,
    terms_at TEXT,
    marketing INTEGER NOT NULL DEFAULT 0,
    marketing_at TEXT,
    method TEXT NOT NULL DEFAULT 'email',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS scores (
    user_id INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, song_id)
  )`,
  `CREATE INDEX IF NOT EXISTS scores_song_idx ON scores (song_id, score DESC)`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,
];
