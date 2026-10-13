// Zerowanie tablicy wyników przed startem gry na produkcji.
//
// Usuwa wyniki z tabel `scores` (ranking ogólny + gwiazdki/postęp na serwerze)
// i `scores_monthly` (ranking miesięczny). KONTA GRACZY ZOSTAJĄ (login, nick,
// monety, odblokowane poziomy w `users`). Postęp testerów zostaje też na ich
// telefonach (gra przy logowaniu bierze wyższą wartość: telefon albo serwer).
//
// Bez --confirm tylko POKAZUJE, co jest w bazie (nic nie kasuje):
//   node tools/reset-leaderboard.mjs
// Kasowanie (nieodwracalne):
//   node tools/reset-leaderboard.mjs --confirm
//
// Dane dostępowe: TURSO_DATABASE_URL i TURSO_AUTH_TOKEN ze zmiennych
// środowiskowych albo z pliku .env.local (np. po `vercel env pull .env.local`).

import fs from "node:fs";
import { createClient } from "@libsql/client";

function loadEnvLocal() {
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* brak pliku — zostają zmienne środowiskowe */
  }
}

loadEnvLocal();
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("Brak TURSO_DATABASE_URL (zmienna środowiskowa albo .env.local).");
  process.exit(1);
}

const confirm = process.argv.includes("--confirm");
const c = createClient({ url, authToken });

const count = async (sql) => Number((await c.execute(sql)).rows[0]?.n ?? 0);

console.log(`Baza: ${url.replace(/\/\/([^.]+)/, "//$1")}`);
console.log(`Konta graczy (zostają):      ${await count("SELECT COUNT(*) AS n FROM users")}`);
console.log(`Wyniki – ranking ogólny:     ${await count("SELECT COUNT(*) AS n FROM scores")}`);
console.log(`Wyniki – ranking miesięczny: ${await count("SELECT COUNT(*) AS n FROM scores_monthly")}`);
const per = await c.execute(
  "SELECT s.song_id, COUNT(*) AS n, MAX(s.score) AS top FROM scores s GROUP BY s.song_id ORDER BY s.song_id",
);
for (const r of per.rows) console.log(`   ${String(r.song_id).padEnd(26)} ${r.n} wyników, najlepszy ${r.top}`);

if (!confirm) {
  console.log("\nNic nie skasowano. Żeby wyzerować tablicę wyników, uruchom ponownie z --confirm.");
  process.exit(0);
}

await c.batch(["DELETE FROM scores_monthly", "DELETE FROM scores"], "write");
console.log("\n✓ Wyzerowano: ranking ogólny i miesięczny są puste.");
console.log(`  Pozostało: scores=${await count("SELECT COUNT(*) AS n FROM scores")}, scores_monthly=${await count("SELECT COUNT(*) AS n FROM scores_monthly")}`);
