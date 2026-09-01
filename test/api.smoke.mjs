// Smoke test warstwy bazodanowej backendu — na lokalnym pliku libSQL.
// Sprawdza schemat, kluczowe zapytania (rejestracja, logowanie, reset, ranking)
// oraz funkcje kryptograficzne. Nie wymaga Turso ani sieci.
//
//   node --experimental-strip-types test/api.smoke.mjs

import { createClient } from "@libsql/client/node";
import { existsSync, rmSync } from "node:fs";
import { SCHEMA_SQL } from "../api/_lib/schema.ts";
import { hashPassword, verifyPassword, sha256, randomToken } from "../api/_lib/util.ts";

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
const pw = await hashPassword("haslo12345");
const ins = await c.execute({
  sql: `INSERT INTO users (email, pw_hash, nick, terms, terms_at, marketing, marketing_at, method, created_at)
        VALUES (?, ?, '', 1, ?, 0, NULL, 'email', ?)`,
  args: ["test@example.com", pw, now, now],
});
const uid = Number(ins.lastInsertRowid);
ok(uid > 0, "użytkownik zapisany (id " + uid + ")");

const dup = await c.execute({ sql: "SELECT id FROM users WHERE email = ?", args: ["test@example.com"] });
ok(dup.rows.length === 1, "email jest unikalny (lookup działa)");

// --- logowanie ---
const row = (await c.execute({ sql: "SELECT pw_hash FROM users WHERE email = ?", args: ["test@example.com"] })).rows[0];
ok(await verifyPassword("haslo12345", String(row.pw_hash)), "poprawne hasło przechodzi weryfikację");
ok(!(await verifyPassword("zlehaslo", String(row.pw_hash))), "złe hasło odrzucone");

// --- sesja ---
const token = randomToken(32);
await c.execute({
  sql: "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  args: [token, uid, now, new Date(Date.now() + 1e9).toISOString()],
});
const sess = (await c.execute({ sql: "SELECT user_id FROM sessions WHERE token = ?", args: [token] })).rows[0];
ok(Number(sess.user_id) === uid, "sesja odczytana po tokenie");

// --- reset hasła ---
const rt = randomToken(32);
await c.execute({
  sql: "INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)",
  args: [sha256(rt), uid, now, new Date(Date.now() + 3600e3).toISOString()],
});
const pr = (await c.execute({ sql: "SELECT user_id, used FROM password_resets WHERE token_hash = ?", args: [sha256(rt)] })).rows[0];
ok(pr && Number(pr.used) === 0, "token resetu zapisany jako hash");
const pw2 = await hashPassword("noweHaslo999");
await c.batch(
  [
    { sql: "UPDATE users SET pw_hash = ? WHERE id = ?", args: [pw2, uid] },
    { sql: "UPDATE password_resets SET used = 1 WHERE token_hash = ?", args: [sha256(rt)] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", args: [uid] },
  ],
  "write",
);
const after = (await c.execute({ sql: "SELECT pw_hash FROM users WHERE id = ?", args: [uid] })).rows[0];
ok(await verifyPassword("noweHaslo999", String(after.pw_hash)), "hasło zmienione po resecie");
ok(
  (await c.execute({ sql: "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", args: [uid] })).rows[0].n === 0n ||
    Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", args: [uid] })).rows[0].n) === 0,
  "sesje wylogowane po zmianie hasła",
);

// --- ranking: upsert MAX + ranga ---
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
// dołóż drugiego i trzeciego gracza
const u2 = Number((await c.execute({ sql: "INSERT INTO users (email, pw_hash, created_at) VALUES ('b@e.pl','x',?)", args: [now] })).lastInsertRowid);
const u3 = Number((await c.execute({ sql: "INSERT INTO users (email, pw_hash, created_at) VALUES ('c@e.pl','x',?)", args: [now] })).lastInsertRowid);

await submit(uid, "panna-mloda", 500000, 3);
await submit(uid, "panna-mloda", 300000, 2); // niższy — nie powinien nadpisać
await submit(u2, "panna-mloda", 900000, 5);
await submit(u3, "panna-mloda", 100000, 1);

const mine = (await c.execute({ sql: "SELECT score, stars FROM scores WHERE user_id = ? AND song_id = 'panna-mloda'", args: [uid] })).rows[0];
ok(Number(mine.score) === 500000, "upsert trzyma najwyższy wynik");
ok(Number(mine.stars) === 3, "upsert trzyma najwięcej gwiazdek");

const rank = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = 'panna-mloda' AND score > ?", args: [500000] })).rows[0].n) + 1;
ok(rank === 2, "ranga liczona poprawnie (#" + rank + " z 3)");

const top = await c.execute({
  sql: `SELECT u.email, s.score FROM scores s JOIN users u ON u.id = s.user_id
        WHERE s.song_id = 'panna-mloda' ORDER BY s.score DESC LIMIT 50`,
});
ok(top.rows.length === 3 && Number(top.rows[0].score) === 900000, "top posortowany malejąco");

// --- kaskada usunięcia konta ---
await c.batch(
  [
    { sql: "DELETE FROM scores WHERE user_id = ?", args: [uid] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", args: [uid] },
    { sql: "DELETE FROM password_resets WHERE user_id = ?", args: [uid] },
    { sql: "DELETE FROM users WHERE id = ?", args: [uid] },
  ],
  "write",
);
ok(
  (await c.execute({ sql: "SELECT COUNT(*) AS n FROM users WHERE id = ?", args: [uid] })).rows[0].n == 0 &&
    (await c.execute({ sql: "SELECT COUNT(*) AS n FROM scores WHERE user_id = ?", args: [uid] })).rows[0].n == 0,
  "usunięcie konta czyści powiązane dane",
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
    /* plik zablokowany na Windows — nieistotne dla wyniku testu */
  }
}

console.log(fail ? `\n${fail} FAIL` : "\nOK");
process.exit(fail ? 1 : 0);
