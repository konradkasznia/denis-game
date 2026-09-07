// Smoke test warstwy bazodanowej backendu — na lokalnym pliku libSQL.
// Model: login + hasło (bez e-maila, bez resetu). Sprawdza schemat, unikalność
// loginu (case-insensitive), logowanie, ranking i kaskadę usunięcia konta.
//
//   node --experimental-strip-types test/api.smoke.mjs

import { createClient } from "@libsql/client/node";
import { existsSync, rmSync } from "node:fs";
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { SCHEMA_SQL } from "../api/_lib/schema.ts";

const scrypt = (pw, salt) =>
  new Promise((res, rej) => _scrypt(pw, salt, 32, (e, dk) => (e ? rej(e) : res(dk))));
async function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await scrypt(pw, salt)).toString("hex")}`;
}
async function verifyPassword(pw, stored) {
  const [tag, salt, hex] = String(stored).split("$");
  if (tag !== "scrypt") return false;
  const dk = await scrypt(pw, salt);
  const a = Buffer.from(hex, "hex");
  return a.length === dk.length && timingSafeEqual(a, dk);
}
const randomToken = (n = 32) => randomBytes(n).toString("hex");

const DB = "test/.smoke.db";
for (const f of [DB, DB + "-wal", DB + "-shm"]) if (existsSync(f)) rmSync(f);

let fail = 0;
const ok = (c, m) => {
  if (!c) {
    console.error("  ✗", m);
    fail++;
  } else console.log("  ✓", m);
};

const c = createClient({ url: "file:" + DB });
await c.batch(SCHEMA_SQL, "write");
ok(true, "schemat utworzony");

const now = new Date().toISOString();

// --- rejestracja ---
const pw = await hashPassword("Haslo123!");
const ins = await c.execute({
  sql: `INSERT INTO users (login, pw_hash, nick, terms, terms_at, created_at)
        VALUES (?, ?, '', 1, ?, ?)`,
  args: ["WeselnyKrol", pw, now, now],
});
const uid = Number(ins.lastInsertRowid);
ok(uid > 0, "użytkownik zapisany (id " + uid + ")");

// unikalność loginu — case-insensitive (indeks na lower(login))
let dupBlocked = false;
try {
  await c.execute({
    sql: "INSERT INTO users (login, pw_hash, created_at) VALUES (?, 'x', ?)",
    args: ["weselnykrol", now],
  });
} catch {
  dupBlocked = true;
}
ok(dupBlocked, "login zajęty niezależnie od wielkości liter");

const lookup = await c.execute({
  sql: "SELECT id, pw_hash FROM users WHERE lower(login) = lower(?)",
  args: ["WESELNYKROL"],
});
ok(lookup.rows.length === 1, "wyszukanie po loginie bez rozróżniania wielkości liter");

// --- logowanie ---
ok(await verifyPassword("Haslo123!", String(lookup.rows[0].pw_hash)), "poprawne hasło przechodzi");
ok(!(await verifyPassword("zle", String(lookup.rows[0].pw_hash))), "złe hasło odrzucone");

// --- sesja ---
const token = randomToken(32);
await c.execute({
  sql: "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  args: [token, uid, now, new Date(Date.now() + 1e9).toISOString()],
});
const sess = (await c.execute({ sql: "SELECT user_id FROM sessions WHERE token = ?", args: [token] })).rows[0];
ok(Number(sess.user_id) === uid, "sesja odczytana po tokenie");

// --- ranking: upsert MAX + ranga + nazwa (nick albo login) ---
async function submit(userId, songId, score, stars) {
  await c.execute({
    sql: `INSERT INTO scores (user_id, song_id, score, stars, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, song_id) DO UPDATE SET
            score = MAX(scores.score, excluded.score),
            stars = MAX(scores.stars, excluded.stars),
            updated_at = excluded.updated_at`,
    args: [userId, songId, score, stars, new Date().toISOString()],
  });
}
const u2 = Number((await c.execute({ sql: "INSERT INTO users (login, pw_hash, nick, created_at) VALUES ('Ola','x','OleczkaXO',?)", args: [now] })).lastInsertRowid);

await submit(uid, "panna-mloda", 500000, 3);
await submit(uid, "panna-mloda", 300000, 2); // niższy — nie nadpisuje
await submit(u2, "panna-mloda", 900000, 5);

const mine = (await c.execute({ sql: "SELECT score, stars FROM scores WHERE user_id = ? AND song_id = 'panna-mloda'", args: [uid] })).rows[0];
ok(Number(mine.score) === 500000, "upsert trzyma najwyższy wynik");
ok(Number(mine.stars) === 3, "upsert trzyma najwięcej gwiazdek");

const rank = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = 'panna-mloda' AND score > ?", args: [500000] })).rows[0].n) + 1;
ok(rank === 2, "ranga liczona poprawnie (#" + rank + " z 2)");

const top = await c.execute({
  sql: `SELECT COALESCE(NULLIF(u.nick,''), u.login) AS nick, s.score
        FROM scores s JOIN users u ON u.id = s.user_id
        WHERE s.song_id = 'panna-mloda' ORDER BY s.score DESC LIMIT 50`,
});
ok(String(top.rows[0].nick) === "OleczkaXO", "nick użyty, gdy ustawiony");
ok(String(top.rows[1].nick) === "WeselnyKrol", "login użyty, gdy nick pusty");

// --- ranking miesięczny: osobna tabela per (user, song, ym) ---
async function submitM(userId, songId, m, score) {
  await c.execute({
    sql: `INSERT INTO scores_monthly (user_id, song_id, ym, score, stars, updated_at)
          VALUES (?, ?, ?, ?, 0, ?)
          ON CONFLICT(user_id, song_id, ym) DO UPDATE SET
            score = MAX(scores_monthly.score, excluded.score),
            updated_at = excluded.updated_at`,
    args: [userId, songId, m, score, new Date().toISOString()],
  });
}
await submitM(uid, "panna-mloda", "2026-09", 400000);
await submitM(uid, "panna-mloda", "2026-09", 200000); // niższy — nie nadpisuje
await submitM(uid, "panna-mloda", "2026-10", 999000); // inny miesiąc — osobno
await submitM(u2, "panna-mloda", "2026-09", 700000);
const mSep = await c.execute({
  sql: "SELECT user_id, score FROM scores_monthly WHERE song_id='panna-mloda' AND ym='2026-09' ORDER BY score DESC",
});
ok(mSep.rows.length === 2 && Number(mSep.rows[0].score) === 700000, "ranking miesięczny filtruje po ym");
ok(
  Number((await c.execute({ sql: "SELECT score FROM scores_monthly WHERE user_id=? AND song_id='panna-mloda' AND ym='2026-09'", args: [uid] })).rows[0].score) === 400000,
  "upsert miesięczny trzyma najwyższy wynik w danym miesiącu",
);

// --- /api/auth/me: postęp gracza (per utwór) do odtworzenia progresji ---
await submit(uid, "ksiaze-z-bajki", 620000, 4);
const prog = await c.execute({
  sql: "SELECT song_id, score, stars FROM scores WHERE user_id = ?",
  args: [uid],
});
const pmap = Object.fromEntries(prog.rows.map((r) => [String(r.song_id), Number(r.stars)]));
ok(
  pmap["panna-mloda"] === 3 && pmap["ksiaze-z-bajki"] === 4,
  "me: zwraca gwiazdki per utwór (klient odtwarza odblokowane poziomy)",
);

// --- sesja przesuwana: użycie przy niskim zapasie przedłuża expires_at ---
const soon = randomToken(32);
const near = new Date(Date.now() + 10 * 86400_000).toISOString(); // wygasa za 10 dni
await c.execute({
  sql: "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  args: [soon, uid, now, near],
});
await c.execute({
  sql: "UPDATE sessions SET expires_at = ? WHERE token = ?",
  args: [new Date(Date.now() + 730 * 86400_000).toISOString(), soon],
});
const renewed = (await c.execute({ sql: "SELECT expires_at FROM sessions WHERE token = ?", args: [soon] })).rows[0];
ok(
  new Date(String(renewed.expires_at)).getTime() - Date.now() > 700 * 86400_000,
  "sesja przesuwana: przedłużona przy użyciu (aktywny gracz nie zostaje wylogowany)",
);

// --- monety: dopisywanie za wynik + atomowe odblokowanie za monety ---
const cu = Number(
  (await c.execute({ sql: "INSERT INTO users (login, pw_hash, created_at) VALUES ('Monetnik','x',?)", args: [now] }))
    .lastInsertRowid,
);
// dopisz monety jak scores.ts (1 / 10 000 pkt)
for (const s of [254321, 30000]) {
  await c.execute({ sql: "UPDATE users SET coins = coins + ? WHERE id = ?", args: [Math.floor(s / 10000), cu] });
}
ok(
  Number((await c.execute({ sql: "SELECT coins FROM users WHERE id = ?", args: [cu] })).rows[0].coins) === 28,
  "monety: 25 + 3 za dwa przebiegi",
);
// odblokowanie: atomowy UPDATE (odejmij + dopisz do unlocked, tylko gdy starczy i nieodblokowane)
const UNLOCK_SQL = `UPDATE users SET coins = coins - ?, unlocked = TRIM(unlocked || ',' || ?, ',')
  WHERE id = ? AND coins >= ? AND instr(',' || unlocked || ',', ',' || ? || ',') = 0
  RETURNING coins, unlocked`;
const tooPoor = await c.execute({ sql: UNLOCK_SQL, args: [1000, "pogrzebowka", cu, 1000, "pogrzebowka"] });
ok(tooPoor.rows.length === 0, "odblokowanie: 28 monet < 1000 → brak zmiany");
await c.execute({ sql: "UPDATE users SET coins = 1200 WHERE id = ?", args: [cu] });
const bought = await c.execute({ sql: UNLOCK_SQL, args: [1000, "pogrzebowka", cu, 1000, "pogrzebowka"] });
ok(
  bought.rows.length === 1 &&
    Number(bought.rows[0].coins) === 200 &&
    String(bought.rows[0].unlocked) === "pogrzebowka",
  "odblokowanie: 1200 → 200 monet, unlocked = pogrzebowka",
);
const again = await c.execute({ sql: UNLOCK_SQL, args: [1000, "pogrzebowka", cu, 1000, "pogrzebowka"] });
ok(again.rows.length === 0, "odblokowanie: drugie kliknięcie nie pobiera ponownie");
await c.execute({ sql: "DELETE FROM users WHERE id = ?", args: [cu] });

// --- kaskada usunięcia konta ---
await c.batch(
  [
    { sql: "DELETE FROM scores WHERE user_id = ?", args: [uid] },
    { sql: "DELETE FROM scores_monthly WHERE user_id = ?", args: [uid] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", args: [uid] },
    { sql: "DELETE FROM users WHERE id = ?", args: [uid] },
  ],
  "write",
);
ok(
  Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM users WHERE id = ?", args: [uid] })).rows[0].n) === 0 &&
    Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM scores WHERE user_id = ?", args: [uid] })).rows[0].n) === 0 &&
    Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM scores_monthly WHERE user_id = ?", args: [uid] })).rows[0].n) === 0,
  "usunięcie konta czyści powiązane dane (w tym ranking miesięczny)",
);

try {
  c.close();
} catch {
  /* ignore */
}
for (const f of [DB, DB + "-wal", DB + "-shm"]) {
  try {
    if (existsSync(f)) rmSync(f);
  } catch {
    /* plik zablokowany na Windows — nieistotne */
  }
}

console.log(fail ? `\n${fail} FAIL` : "\nOK");
process.exit(fail ? 1 : 0);
