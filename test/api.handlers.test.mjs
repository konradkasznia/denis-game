// Testy PRAWDZIWYCH handlerów /api/* na lokalnym pliku libSQL (bez Vercela).
// Pokrywają poprawki z audytu 2026-10-06: walidacja songId (farma monet),
// limit błędnych haseł edytora, haszowane tokeny sesji, zmiana hasła z obecnym
// hasłem, loginy Unicode (Ł/ł), unikalność nicku, limit rankingu.
//
//   node --experimental-strip-types test/api.handlers.test.mjs

import { register } from "node:module";
register("./_ts-resolve.mjs", import.meta.url);

const { createClient } = await import("@libsql/client/node");
const { existsSync, rmSync } = await import("node:fs");
const { createHash } = await import("node:crypto");

const DB = "test/.handlers.db";
for (const f of [DB, DB + "-wal", DB + "-shm"]) if (existsSync(f)) rmSync(f);

let fail = 0;
const ok = (c, m) => {
  if (!c) {
    console.error("  ✗", m);
    fail++;
  } else console.log("  ✓", m);
};

const client = createClient({ url: "file:" + DB });

// --- stara baza: users BEZ login_key + sesja z jawnym tokenem (sprzed poprawki)
await client.execute(`CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL, pw_hash TEXT NOT NULL DEFAULT '',
  nick TEXT NOT NULL DEFAULT '', terms INTEGER NOT NULL DEFAULT 0, terms_at TEXT,
  coins INTEGER NOT NULL DEFAULT 0, unlocked TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`);
await client.execute(
  "INSERT INTO users (login, pw_hash, created_at) VALUES ('Żaneta', 'x', '2026-01-01T00:00:00Z')",
);
await client.execute(`CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
await client.execute({
  sql: "INSERT INTO sessions VALUES ('legacy-raw-token', 1, ?, ?)",
  args: [new Date().toISOString(), new Date(Date.now() + 86400e3).toISOString()],
});

const { __setClientForTests, ensureSchema } = await import("../api/_lib/db.ts");
__setClientForTests(client);
process.env.EDITOR_PASSWORD = "Tajne-Haslo-Edytora-123";
process.env.VERCEL_ENV = "production";

const h = {
  register: (await import("../api/auth/register.ts")).default,
  login: (await import("../api/auth/login.ts")).default,
  check: (await import("../api/auth/check.ts")).default,
  me: (await import("../api/auth/me.ts")).default,
  scores: (await import("../api/scores.ts")).default,
  account: (await import("../api/account.ts")).default,
  chart: (await import("../api/chart.ts")).default,
};

let ipSeq = 1;
async function call(handler, { method = "GET", body, query = {}, token, headers = {}, ip } = {}) {
  const req = {
    method,
    body,
    query,
    headers: {
      "x-real-ip": ip || `10.0.0.${ipSeq++}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
  const res = {
    statusCode: 200,
    headers: {},
    raw: "",
    status(c) {
      this.statusCode = c;
      return this;
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
      return this;
    },
    send(b) {
      this.raw = b;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler(req, res);
  let json = null;
  try {
    json = JSON.parse(res.raw);
  } catch {
    /* nie-JSON */
  }
  return { status: res.statusCode, body: json };
}
const sha = (s) => createHash("sha256").update(s).digest("hex");

console.log("· migracja starej bazy:");
await ensureSchema();
{
  const r = await client.execute("SELECT login_key FROM users WHERE id = 1");
  ok(r.rows[0].login_key === "żaneta", `login_key uzupełniony Unicode (${r.rows[0].login_key})`);
  const m = await call(h.me, { token: "legacy-raw-token" });
  ok(m.status === 200, "stara sesja z jawnym tokenem dalej działa");
  const s = await client.execute("SELECT token FROM sessions WHERE user_id = 1");
  ok(s.rows[0].token === sha("legacy-raw-token"), "...i została przepisana na hash");
}

console.log("· rejestracja / logowanie:");
const reg = await call(h.register, {
  method: "POST",
  body: { login: "Łukasz", password: "Haslo123!", password2: "Haslo123!", terms: true },
});
ok(reg.status === 200 && reg.body.token, "rejestracja Łukasz");
const tokA = reg.body.token;
{
  const s = await client.execute("SELECT token FROM sessions WHERE token = ?", [tokA]);
  ok(s.rows.length === 0, "w bazie NIE ma surowego tokenu");
  const s2 = await client.execute("SELECT token FROM sessions WHERE token = ?", [sha(tokA)]);
  ok(s2.rows.length === 1, "w bazie jest hash tokenu");
}
const dup = await call(h.register, {
  method: "POST",
  body: { login: "łukasz", password: "Haslo123!", password2: "Haslo123!", terms: true },
});
ok(dup.status === 409, `„łukasz" zajęty po „Łukasz" (Unicode) → ${dup.status}`);
const chk = await call(h.check, { query: { login: "ŁUKASZ" } });
ok(chk.body.available === false, "check: ŁUKASZ niedostępny");
const lg = await call(h.login, { method: "POST", body: { login: "ŁUKASZ", password: "Haslo123!" } });
ok(lg.status === 200 && lg.body.token, "logowanie bez rozróżniania wielkości liter (Unicode)");
const tokA2 = lg.body.token;
const bad = await call(h.login, { method: "POST", body: { login: "Łukasz", password: "Zle12345!" } });
ok(bad.status === 401, "złe hasło → 401");
const none = await call(h.login, { method: "POST", body: { login: "NieMaMnie", password: "Zle12345!" } });
ok(none.status === 401, "brak konta → 401 (ten sam komunikat)");

const regB = await call(h.register, {
  method: "POST",
  body: { login: "Basia", password: "Haslo123!", password2: "Haslo123!", terms: true },
});
const tokB = regB.body.token;

console.log("· nick:");
const n1 = await call(h.account, { method: "POST", token: tokB, body: { action: "nick", nick: "łukasz" } });
ok(n1.status === 409, "nick = cudzy login → 409");
const n2 = await call(h.account, { method: "POST", token: tokB, body: { action: "nick", nick: "BasiaB" } });
ok(n2.status === 200, "wolny nick → OK");
const n3 = await call(h.register, {
  method: "POST",
  body: { login: "basiab", password: "Haslo123!", password2: "Haslo123!", terms: true },
});
ok(n3.status === 409, "rejestracja loginu = cudzy nick → 409");

console.log("· wyniki / monety:");
const fake = await call(h.scores, { method: "POST", token: tokA, body: { songId: "a1", score: 2_000_000, stars: 5 } });
ok(fake.status === 400, `wymyślone songId odrzucone (${fake.status})`);
const long = await call(h.scores, {
  method: "POST",
  token: tokA,
  body: { songId: "x".repeat(5000), score: 1, stars: 1 },
});
ok(long.status === 400, "bardzo długie songId odrzucone");
const real = await call(h.scores, { method: "POST", token: tokA, body: { songId: "panna-mloda", score: 250_000, stars: 4 } });
ok(real.status === 200 && real.body.coinsGained === 25, `prawdziwy utwór: 25 monet (${real.body?.coinsGained})`);
const again = await call(h.scores, { method: "POST", token: tokA, body: { songId: "panna-mloda", score: 250_000, stars: 4 } });
ok(again.body.coinsGained === 0, "anty-farm dalej działa (0 monet przed czasem)");
{
  // 250 graczy → ranking zwraca max 200, własne miejsce osobno
  const now = new Date().toISOString();
  const stmts = [];
  for (let i = 0; i < 250; i++) {
    stmts.push({
      sql: "INSERT INTO scores (user_id, song_id, score, stars, updated_at, nick) VALUES (?, 'pogrzebowka', ?, 3, ?, ?)",
      args: [1000 + i, 500_000 + i, now, `bot${i}`],
    });
  }
  await client.batch(stmts, "write");
  await call(h.scores, { method: "POST", token: tokA, body: { songId: "pogrzebowka", score: 10, stars: 1 } });
  const g = await call(h.scores, { query: { songId: "pogrzebowka", period: "all" }, token: tokA });
  ok(g.body.top.length === 200, `ranking ograniczony do 200 (${g.body.top.length})`);
  ok(g.body.me?.rank === 251, `własne miejsce spoza top osobno (#${g.body.me?.rank})`);
  ok(g.body.total === 251, "total liczy wszystkich");
}

console.log("· zmiana hasła:");
const p0 = await call(h.account, { method: "POST", token: tokA, body: { action: "password", newPassword: "NoweHaslo9#" } });
ok(p0.status === 400, "bez obecnego hasła → 400");
const p1 = await call(h.account, {
  method: "POST",
  token: tokA,
  body: { action: "password", currentPassword: "Zle12345!", newPassword: "NoweHaslo9#" },
});
ok(p1.status === 403, "złe obecne hasło → 403");
const p2 = await call(h.account, {
  method: "POST",
  token: tokA,
  body: { action: "password", currentPassword: "Haslo123!", newPassword: "NoweHaslo9#" },
});
ok(p2.status === 200, "poprawne obecne hasło → zmienione");
ok((await call(h.me, { token: tokA })).status === 200, "bieżąca sesja zostaje");
ok((await call(h.me, { token: tokA2 })).status === 401, "inne urządzenie wylogowane");
ok(
  (await call(h.login, { method: "POST", body: { login: "Łukasz", password: "NoweHaslo9#" } })).status === 200,
  "logowanie nowym hasłem",
);

console.log("· edytor (publikacja mapy):");
const chart = { id: "test-mapa", notes: [{ lane: 1, time: 1 }] };
const ipE = "10.9.9.9";
for (let i = 0; i < 10; i++) {
  await call(h.chart, { method: "POST", ip: ipE, headers: { "x-editor-key": "zgaduje" + i }, body: { chart } });
}
const blocked = await call(h.chart, {
  method: "POST",
  ip: ipE,
  headers: { "x-editor-key": process.env.EDITOR_PASSWORD },
  body: { chart },
});
ok(blocked.status === 429, `po 10 błędnych hasłach nawet poprawne → 429 (${blocked.status})`);
const good = await call(h.chart, {
  method: "POST",
  ip: "10.9.9.10",
  headers: { "x-editor-key": process.env.EDITOR_PASSWORD },
  body: { chart },
});
ok(good.status === 200, "poprawne hasło z innego IP publikuje");
const sc = await call(h.scores, { method: "POST", token: tokB, body: { songId: "test-mapa", score: 20_000, stars: 2 } });
ok(sc.status === 200, "wynik na mapę opublikowaną z edytora przyjęty");

console.log("· usunięcie konta:");
const del = await call(h.account, { method: "POST", token: tokB, body: { action: "delete" } });
ok(del.status === 200, "usunięcie konta");
ok((await call(h.me, { token: tokB })).status === 401, "sesja po usunięciu nieważna");

client.close(); // plik bazy zostaje (Windows trzyma blokadę do końca procesu); kasuje go start testu
console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
