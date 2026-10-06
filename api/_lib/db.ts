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

/** Lokalna kopia loginKey z util.ts (util importuje db — bez cyklu). */
const loginKey = (s: string) => String(s || "").trim().normalize("NFC").toLowerCase();

/** Tylko testy (test/api.handlers.test.mjs): podmiana klienta na lokalny plik. */
export function __setClientForTests(c: Client | null) {
  _client = c;
  _schema = null;
}

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
      // waluta „monety" + lista poziomów odblokowanych za monety (CSV)
      if (cols.length && !cols.includes("coins")) {
        await c.execute("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0");
      }
      if (cols.length && !cols.includes("unlocked")) {
        await c.execute("ALTER TABLE users ADD COLUMN unlocked TEXT NOT NULL DEFAULT ''");
      }
      if (cols.length && !cols.includes("login_key")) {
        await c.execute("ALTER TABLE users ADD COLUMN login_key TEXT");
      }
    } catch {
      /* users jeszcze nie istnieje — CREATE TABLE poniżej */
    }
    // anty-farm monet: znacznik ostatniego przyznania monet za ten utwór
    try {
      const si = await c.execute("PRAGMA table_info(scores)");
      const scols = si.rows.map((r) => String(r.name));
      if (scols.length && !scols.includes("coin_at")) {
        await c.execute("ALTER TABLE scores ADD COLUMN coin_at TEXT");
      }
      // migawka nicku w chwili zapisu wyniku — pozwala zostawić wynik w tabeli
      // pod starym nickiem, gdy gracz później skasuje konto (patrz api/account.ts)
      if (scols.length && !scols.includes("nick")) {
        await c.execute("ALTER TABLE scores ADD COLUMN nick TEXT NOT NULL DEFAULT ''");
      }
    } catch {
      /* scores jeszcze nie istnieje — CREATE TABLE poniżej */
    }
    try {
      const smi = await c.execute("PRAGMA table_info(scores_monthly)");
      const smcols = smi.rows.map((r) => String(r.name));
      if (smcols.length && !smcols.includes("nick")) {
        await c.execute("ALTER TABLE scores_monthly ADD COLUMN nick TEXT NOT NULL DEFAULT ''");
      }
    } catch {
      /* scores_monthly jeszcze nie istnieje — CREATE TABLE poniżej */
    }
    for (const sql of MIGRATIONS_SQL) await c.execute(sql);
    await c.batch(SCHEMA_SQL, "write");
    // uzupełnij login_key dla kont sprzed tej kolumny (jednorazowo; potem pusto)
    const missing = await c.execute("SELECT id, login FROM users WHERE login_key IS NULL");
    for (const r of missing.rows) {
      try {
        await c.execute({
          sql: "UPDATE users SET login_key = ? WHERE id = ?",
          args: [loginKey(String(r.login)), Number(r.id)],
        });
      } catch (e) {
        // kolizja (np. „Łukasz" i „łukasz" założone przed poprawką) — to konto
        // zostaje bez klucza i dalej loguje się po starym porównaniu lower()
        console.error("login_key backfill", r.id, e);
      }
    }
  })().catch((e) => {
    // nie zatruwaj całej instancji lambdy odrzuconą obietnicą — kolejne
    // żądanie spróbuje jeszcze raz (audyt A8)
    _schema = null;
    throw e;
  });
  return _schema;
}
