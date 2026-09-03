// Jednorazówka: ustawia postęp (gwiazdki) dla wskazanego konta w bazie Turso,
// tak żeby wszystkie poziomy były zaliczone/odblokowane.
//
//   TURSO_DATABASE_URL=libsql://...  TURSO_AUTH_TOKEN=...  \
//     node tools/grant-progress.mjs <login> [gwiazdki]
//
//   node tools/grant-progress.mjs konraddd        # 5 gwiazdek na każdym
//   node tools/grant-progress.mjs konraddd 4      # dokładnie 4 (próg odblokowania)
//
// Po zalogowaniu tym kontem w aplikacji postęp odtworzy się z serwera
// (/api/auth/me -> mergeServerStars).

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("Brak TURSO_DATABASE_URL w środowisku.");
  process.exit(1);
}

const login = (process.argv[2] || "konraddd").trim();
const stars = Math.max(0, Math.min(5, Number(process.argv[3] ?? 5)));
const SONGS = ["panna-mloda", "ksiaze-z-bajki", "pogrzebowka"];
const now = new Date().toISOString();
const ym = now.slice(0, 7);

const c = createClient({ url, authToken });

const u = await c.execute({
  sql: "SELECT id, login FROM users WHERE lower(login) = lower(?)",
  args: [login],
});
if (!u.rows[0]) {
  console.error(`Nie znaleziono konta o loginie "${login}".`);
  const all = await c.execute("SELECT login FROM users ORDER BY created_at");
  console.error("Dostępne loginy:", all.rows.map((r) => r.login).join(", ") || "(brak)");
  process.exit(1);
}
const uid = Number(u.rows[0].id);
console.log(`Konto: ${u.rows[0].login} (id ${uid}) -> ${stars} gwiazdek na: ${SONGS.join(", ")}`);

for (const songId of SONGS) {
  await c.batch(
    [
      {
        sql: `INSERT INTO scores (user_id, song_id, score, stars, updated_at)
              VALUES (?, ?, 0, ?, ?)
              ON CONFLICT(user_id, song_id) DO UPDATE SET
                stars = MAX(scores.stars, excluded.stars),
                updated_at = excluded.updated_at`,
        args: [uid, songId, stars, now],
      },
      {
        sql: `INSERT INTO scores_monthly (user_id, song_id, ym, score, stars, updated_at)
              VALUES (?, ?, ?, 0, ?, ?)
              ON CONFLICT(user_id, song_id, ym) DO UPDATE SET
                stars = MAX(scores_monthly.stars, excluded.stars),
                updated_at = excluded.updated_at`,
        args: [uid, songId, ym, stars, now],
      },
    ],
    "write",
  );
}

const check = await c.execute({
  sql: "SELECT song_id, stars FROM scores WHERE user_id = ? ORDER BY song_id",
  args: [uid],
});
console.log("Gotowe. Stan w bazie:");
for (const r of check.rows) console.log(`  ${r.song_id}: ${r.stars}★`);
console.log("\nZaloguj się tym kontem w aplikacji — poziomy będą odblokowane.");
