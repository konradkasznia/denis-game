// Definicja schematu bazy — używana przez ensureSchema() oraz testy smoke.
//
// Model: login + hasło (bez e-maila, bez odzyskiwania hasła). `login` jest
// zarazem nazwą widoczną w rankingu; `nick` to opcjonalna nazwa wyświetlana
// (na razie nieużywana w UI — zostaje na przyszłość).

export const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    pw_hash TEXT NOT NULL DEFAULT '',
    nick TEXT NOT NULL DEFAULT '',
    terms INTEGER NOT NULL DEFAULT 0,
    terms_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_login_lc ON users (lower(login))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS scores (
    user_id INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, song_id)
  )`,
  `CREATE INDEX IF NOT EXISTS scores_song_idx ON scores (song_id, score DESC)`,
  `CREATE TABLE IF NOT EXISTS scores_monthly (
    user_id INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    ym TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, song_id, ym)
  )`,
  `CREATE INDEX IF NOT EXISTS scores_monthly_idx ON scores_monthly (song_id, ym, score DESC)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    k TEXT NOT NULL,
    ts INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rate_limits_k_idx ON rate_limits (k, ts)`,
  // Beatmapy publikowane z edytora — nadpisują pliki `public/charts/<id>.json`.
  `CREATE TABLE IF NOT EXISTS charts (
    song_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Głosowania w apce (np. „jaki poziom 6?"). Jeden wiersz = jeden głos.
  `CREATE TABLE IF NOT EXISTS poll_votes (
    poll TEXT NOT NULL,
    choice TEXT NOT NULL,
    voter TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS poll_votes_idx ON poll_votes (poll, choice)`,
];

/**
 * Migracje z wcześniejszego modelu (e-mail + reset hasła). Baza jest sprzed
 * startu, więc wystarczy delikatne dostosowanie zamiast wersjonowania.
 */
export const MIGRATIONS_SQL: string[] = [
  `DROP TABLE IF EXISTS password_resets`,
];
