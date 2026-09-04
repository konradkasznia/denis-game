// Klient bazy (Turso / libSQL) + jednorazowe utworzenie schematu.
//
// Zmienne środowiskowe (ustawiane w panelu Vercel / `vercel env add`):
//   TURSO_DATABASE_URL   np. libsql://denis-game-impulsywni.turso.io
//   TURSO_AUTH_TOKEN     token wygenerowany przez `turso db tokens create`
//
// Lokalnie: te same zmienne w `.env.local` (plik jest w .gitignore).

import { createClient, type Client } from "@libsql/client/web";
import { SCHEMA_SQL, MIGRATIONS_SQL } from "./schema.js";

let _client: Client | null = null;
let _schema: Promise<void> | null = null;

export function db(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("Brak TURSO_DATABASE_URL w środowisku.");
  _client = createClient({ url, authToken });
  return _client;
}

/** Tworzy tabele przy pierwszym wywołaniu w danym cold-starcie (idempotentne). */
export function ensureSchema(): Promise<void> {
  if (_schema) return _schema;
  _schema = (async () => {
    const c = db();
    // migracja ze starego modelu (email -> login), zanim powstaną indeksy
    try {
      const info = await c.execute("PRAGMA table_info(users)");
      const cols = info.rows.map((r) => String(r.name));
      if (cols.includes("email") && !cols.includes("login")) {
        await c.execute("ALTER TABLE users RENAME COLUMN email TO login");
      }
    } catch {
      /* users jeszcze nie istnieje — CREATE TABLE poniżej */
    }
    for (const sql of MIGRATIONS_SQL) await c.execute(sql);
    await c.batch(SCHEMA_SQL, "write");
  })().catch((e) => {
    // nie zatruwaj całej instancji lambdy odrzuconą obietnicą — kolejne
    // żądanie spróbuje jeszcze raz (audyt A8)
    _schema = null;
    throw e;
  });
  return _schema;
}
