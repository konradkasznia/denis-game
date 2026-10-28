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
  invite: (await import("../api/invite.ts")).default,
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

console.log("· cytryny (Wódka Cytrynówka):");
{
  await client.execute({ sql: "UPDATE users SET coins = 2000 WHERE login = 'Basia'", args: [] });
  const buy0 = await call(h.account, { method: "POST", token: tokB, body: { action: "unlock", songId: "wodka-cytrynowka" } });
  ok(buy0.status === 403, `bez cytryn odblokowanie odrzucone (${buy0.status})`);
  const l1 = await call(h.account, {
    method: "POST",
    token: tokB,
    body: { action: "lemons", keys: ["panna-mloda@12.50", "pogrzebowka@40.00", "zle klucze", "x@1"] },
  });
  ok(l1.status === 200 && l1.body.lemons.length === 2, "zapis cytryn, śmieciowe klucze odrzucone");
  const l2 = await call(h.account, {
    method: "POST",
    token: tokB,
    body: { action: "lemons", keys: ["panna-mloda@12.50", "ksiaze-z-bajki@3.10", "pan-strazak@22.00", "pogrzebowka@51.25"] },
  });
  ok(l2.body.lemons.length === 5, "suma zbiorów bez duplikatów (5)");
  const me = await call(h.me, { token: tokB });
  ok(me.body.lemons?.length === 5, "/api/auth/me zwraca cytryny");
  const buy1 = await call(h.account, { method: "POST", token: tokB, body: { action: "unlock", songId: "wodka-cytrynowka" } });
  ok(buy1.status === 200 && buy1.body.coins === 1500 && buy1.body.unlocked.includes("wodka-cytrynowka"), "5 cytryn + 500 monet → odblokowane");
}

console.log("· wesele (zaproszenia, garnitury, koperta):");
{
  const KEY = { "x-editor-key": process.env.EDITOR_PASSWORD };
  const g0 = await call(h.account, { method: "POST", token: tokB, body: { action: "unlock", songId: "garnitur-1" } });
  ok(g0.status === 403, `garnitur bez zaproszenia odrzucony (${g0.status})`);
  const e0 = await call(h.account, { method: "POST", token: tokB, body: { action: "envelope", amount: 100 } });
  ok(e0.status === 403, "koperta bez zaproszenia odrzucona");
  const bad = await call(h.invite, { method: "POST", headers: { "x-editor-key": "zle" }, body: { logins: ["Basia"] } });
  ok(bad.status === 401, "zaproszenie bez hasła edytora → 401");
  const inv = await call(h.invite, { method: "POST", headers: KEY, body: { logins: ["@basia", "nieistnieje", "Basia"], push: true } });
  ok(inv.status === 200 && inv.body.invited.length === 1 && inv.body.notFound.includes("nieistnieje"), "zaproszenie po loginie (bez @, wielkość liter bez znaczenia)");
  ok(!!inv.body.push.error, "bez klucza OneSignal push pominięty z komunikatem");
  const inv2 = await call(h.invite, { method: "POST", headers: KEY, body: { logins: ["basia"] } });
  ok(inv2.body.already.length === 1, "ponowne zaproszenie = już zaproszony");
  const me = await call(h.me, { token: tokB });
  ok(me.body.unlocked.includes("pan-mlody") && /^u\d+$/.test(me.body.pushId), "/me: runda odblokowana + pushId");
  const g1 = await call(h.account, { method: "POST", token: tokB, body: { action: "unlock", songId: "garnitur-1" } });
  ok(g1.status === 200 && g1.body.coins === 500 && g1.body.unlocked.includes("garnitur-1"), "garnitur za 1000 kupiony");
  await client.execute({ sql: "UPDATE users SET coins = 1500 WHERE login = 'Basia'", args: [] });
  const e1 = await call(h.account, { method: "POST", token: tokB, body: { action: "envelope", amount: 999 } });
  ok(e1.status === 200 && e1.body.coins === 501 && !e1.body.unlocked.includes("wesele-trwa"), "koperta 999 → monety zabrane, bez Wesele trwa");
  const e2 = await call(h.account, { method: "POST", token: tokB, body: { action: "envelope", amount: 600 } });
  ok(e2.status === 402, "koperta ponad saldo → 402");
  await client.execute({ sql: "UPDATE users SET coins = 1000 WHERE login = 'Basia'", args: [] });
  const e3 = await call(h.account, { method: "POST", token: tokB, body: { action: "envelope", amount: 1 } });
  ok(e3.status === 200 && e3.body.coins === 999 && e3.body.unlocked.includes("wesele-trwa"), "suma kopert 999 + 1 → Wesele trwa odblokowane");
  const givers = await call(h.scores, { query: { songId: "koperty" }, token: tokB });
  ok(
    givers.status === 200 && givers.body.top[0]?.score === 1000 && givers.body.top[0]?.me && givers.body.me?.rank === 1,
    `ranking kopert sumuje wpłaty (${givers.body.top?.[0]?.score})`,
  );
  const regRes = await call(h.register, {
    method: "POST",
    body: { login: "DenisImpulsywni", password: "Haslo123!", password2: "Haslo123!", terms: true },
  });
  ok(regRes.status !== 200, "zwykła rejestracja zastrzeżonej nazwy zablokowana");
  const off = await call(h.invite, { method: "POST", headers: KEY, body: { action: "official", login: "DenisImpulsywni", password: "Haslo123!" } });
  ok(off.status === 200, `konto oficjalne z panelu (${off.status})`);
  const offLogin = await call(h.login, { method: "POST", body: { login: "denisimpulsywni", password: "Haslo123!" } });
  ok(offLogin.status === 200 && !!offLogin.body.token, "logowanie na konto oficjalne");
  const off2 = await call(h.invite, { method: "POST", headers: KEY, body: { action: "official", login: "DenisImpulsywni", password: "Haslo123!" } });
  ok(off2.status === 409, "drugi raz to samo konto → zajęte");
  const list = await call(h.invite, { headers: KEY });
  ok(list.status === 200 && list.body.users.some((u) => u.login === "Basia" && u.suits === 1 && u.weseleTrwa), "lista zaproszonych z garniturami");
  const noKey = await call(h.invite, { headers: { "x-editor-key": "zle" } });
  ok(noKey.status === 401, "lista bez hasła → 401");
  const rv = await call(h.invite, { method: "POST", headers: KEY, body: { action: "revoke", logins: ["BASIA", "nikt"] } });
  ok(rv.status === 200 && rv.body.revoked.length === 1 && rv.body.notFound.includes("nikt"), "odebranie dostępu");
  const me2 = await call(h.me, { token: tokB });
  ok(!me2.body.unlocked.includes("pan-mlody") && me2.body.unlocked.includes("garnitur-1"), "po odebraniu: bez rundy, garnitur zostaje");
  const list2 = await call(h.invite, { headers: KEY });
  ok(!list2.body.users.some((u) => u.login === "Basia"), "odebrany znika z listy");
}

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
{
  // Pociąg weselny: wynik liczy serwer (długość > flaszki > czas), monety = zebrane w rundzie
  const t1 = await call(h.scores, { method: "POST", token: tokA, body: { songId: "pociag-weselny", stars: 2, train: { len: 12, flasks: 1, timeMs: 41_000, coins: 10 } } });
  ok(t1.status === 200 && t1.body.coinsGained === 10 && t1.body.best === 12 * 1_000_000 + 10_000 + (9999 - 410), `pociąg: wynik i 10 monet (${t1.status} ${t1.body?.best} ${t1.body?.coinsGained})`);
  const t2 = await call(h.scores, { method: "POST", token: tokA, body: { songId: "pociag-weselny", stars: 2, train: { len: 12, flasks: 3, timeMs: 41_000, coins: 10 } } });
  ok(t2.status === 422, "pociąg: więcej flaszek niż możliwe → 422");
  const t3 = await call(h.scores, { method: "POST", token: tokA, body: { songId: "pociag-weselny", stars: 2, train: { len: 12, flasks: 1, timeMs: 41_000, coins: 15 } } });
  ok(t3.status === 422, "pociąg: za dużo monet → 422");
  const t4 = await call(h.scores, { method: "POST", token: tokA, body: { songId: "pociag-weselny", stars: 2, train: { len: 50, flasks: 0, timeMs: 1000, coins: 0 } } });
  ok(t4.status === 422, "pociąg: fizycznie za szybko → 422");
  // 5 darmowych gier, potem po 15 monet
  const regT = await call(h.register, { method: "POST", body: { login: "Pociag1", password: "Haslo123!", password2: "Haslo123!", terms: true } });
  const tokT = regT.body.token;
  for (let i = 1; i <= 5; i++) {
    const p = await call(h.account, { method: "POST", token: tokT, body: { action: "trainPlay" } });
    ok(p.status === 200 && p.body.trainPlays === i && p.body.coins === 0, `pociąg: darmowa gra ${i}`);
  }
  const p4 = await call(h.account, { method: "POST", token: tokT, body: { action: "trainPlay" } });
  ok(p4.status === 402 && p4.body.trainPlays === 5, "pociąg: 6. gra bez monet → 402");
  await client.execute({ sql: "UPDATE users SET coins = 20 WHERE login = 'Pociag1'", args: [] });
  const p5 = await call(h.account, { method: "POST", token: tokT, body: { action: "trainPlay" } });
  ok(p5.status === 200 && p5.body.coins === 5 && p5.body.trainPlays === 6, "pociąg: płatna gra zabiera 15 monet");
  const meT = await call(h.me, { token: tokT });
  ok(meT.body.trainPlays === 6, "/me zwraca liczbę gier w pociąg");

  console.log("· pojedynki (Tort weselny):");
  const D = (q) => ({ duels: "1", ...q });
  const chk = await call(h.scores, { query: D({ duels: "check", nick: "basiab" }), token: tokA });
  ok(chk.status === 200 && chk.body.nick === "BasiaB", "wyzwanie: nick bez względu na wielkość liter");
  const self = await call(h.scores, { query: D({ duels: "check", nick: "Łukasz" }), token: tokA });
  ok(self.status === 400, "wyzwanie: nie można wyzwać siebie");
  const bad = await call(h.scores, { query: D({ duels: "check", nick: "nieistnieje" }), token: tokA });
  ok(bad.status === 400, "wyzwanie: zły nick odrzucony");
  const cr = await call(h.scores, { method: "POST", query: D(), token: tokA, body: { action: "create", nick: "BasiaB", score: 12 } });
  ok(cr.status === 200 && cr.body.id, "wyzwanie rzucone (wynik 12)");
  const cr2 = await call(h.scores, { method: "POST", query: D(), token: tokA, body: { action: "create", nick: "BasiaB", score: 30 } });
  ok(cr2.status === 400, "drugie wyzwanie tej samej osobie zablokowane, dopóki trwa pierwsze");
  const back = await call(h.scores, { query: D({ duels: "check", nick: "Łukasz" }), token: tokB });
  ok(back.status === 400, "wyzwany też nie może wyzwać, dopóki pojedynek trwa");
  const mineB = await call(h.scores, { query: D({ duels: "mine" }), token: tokB });
  ok(mineB.body.incoming.length === 1 && mineB.body.incoming[0].opp === "Łukasz" && mineB.body.incoming[0].myScore === undefined, "wyzwany widzi wyzwanie bez wyniku przeciwnika");
  const ans = await call(h.scores, { method: "POST", query: D(), token: tokB, body: { action: "answer", id: cr.body.id, score: 15 } });
  ok(ans.status === 200 && ans.body.result === "won" && ans.body.oppScore === 12, "wyzwany zagrał: 15 > 12 → wygrana");
  const ans2 = await call(h.scores, { method: "POST", query: D(), token: tokB, body: { action: "answer", id: cr.body.id, score: 99 } });
  ok(ans2.status === 409, "drugie rozegranie tego samego pojedynku odrzucone");
  const mineA = await call(h.scores, { query: D({ duels: "mine" }), token: tokA });
  ok(mineA.body.results[0].result === "lost" && mineA.body.results[0].oppScore === 15, "wyzywający widzi porażkę 12 : 15");
  const dc = await call(h.scores, { method: "POST", query: D(), token: tokT, body: { action: "create", nick: "BasiaB", score: 5 } });
  const dcl = await call(h.scores, { method: "POST", query: D(), token: tokB, body: { action: "decline", id: dc.body.id } });
  ok(dcl.status === 200, "odrzucenie wyzwania");
  const mineT = await call(h.scores, { query: D({ duels: "mine" }), token: tokT });
  ok(mineT.body.results[0].result === "oppDeclined", "wyzywający widzi: przeciwnik odrzucił");
  const mineB2 = await call(h.scores, { query: D({ duels: "mine" }), token: tokB });
  ok(mineB2.body.results.some((r) => r.result === "iDeclined") && mineB2.body.incoming.length === 0, "wyzwany widzi: odrzuciłeś wyzwanie");
  const rk = await call(h.scores, { query: D({ duels: "rank" }) });
  ok(rk.body.rows[0].nick === "BasiaB" && rk.body.rows[0].wins === 1 && rk.body.rows[0].best === 15 && rk.body.rows[1].losses === 1, "ranking pojedynków: bilans, zwycięstwa, najwyższe piętro");
  const big = await call(h.scores, { method: "POST", query: D(), token: tokT, body: { action: "create", nick: "Łukasz", score: 9999 } });
  ok(big.status === 400, "absurdalny wynik odrzucony");
}
{
  // konto deweloperskie: wynik nie trafia do bazy ani do rankingu, monety tak
  const regK = await call(h.register, {
    method: "POST",
    body: { login: "Konrad", password: "Haslo123!", password2: "Haslo123!", terms: true },
  });
  const tokK = regK.body.token;
  const kp = await call(h.scores, { method: "POST", token: tokK, body: { songId: "panna-mloda", score: 290_000, stars: 5 } });
  ok(kp.status === 200 && kp.body.coinsGained === 29, "konrad: monety za przebieg");
  const kRows = await client.execute(
    "SELECT COUNT(*) AS n FROM scores s JOIN users u ON u.id = s.user_id WHERE lower(u.login) = 'konrad'",
  );
  ok(Number(kRows.rows[0].n) === 0, "konrad: wynik nie zapisany w bazie");
  // stary wpis sprzed zmiany — też niewidoczny w rankingu
  const kid = Number((await client.execute("SELECT id FROM users WHERE lower(login) = 'konrad'")).rows[0].id);
  await client.execute({
    sql: "INSERT INTO scores (user_id, song_id, score, stars, updated_at, nick) VALUES (?, 'panna-mloda', 999999, 5, ?, 'Konrad')",
    args: [kid, new Date().toISOString()],
  });
  const board = await call(h.scores, { query: { songId: "panna-mloda", period: "all" } });
  ok(!board.body.top.some((e) => e.nick === "Konrad"), "konrad: niewidoczny w rankingu (też stare wpisy)");
  await client.execute({ sql: "DELETE FROM scores WHERE user_id = ?", args: [kid] });
}
const again = await call(h.scores, { method: "POST", token: tokA, body: { songId: "panna-mloda", score: 250_000, stars: 4 } });
ok(again.body.coinsGained === 0, "anty-farm dalej działa (0 monet przed czasem)");
{
  // 250 graczy → ranking zwraca max 200, własne miejsce osobno
  const now = new Date().toISOString();
  const stmts = [];
  for (let i = 0; i < 250; i++) {
    // ranking pokazuje tylko istniejące konta (JOIN users), więc boty muszą je mieć
    stmts.push({
      sql: "INSERT INTO users (id, login, login_key, pw_hash, created_at) VALUES (?, ?, ?, 'x', ?)",
      args: [1000 + i, `bot${i}`, `bot${i}`, now],
    });
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
const uidB = Number((await client.execute("SELECT id FROM users WHERE login = 'Basia'")).rows[0].id);
const countB = async () =>
  Number(
    (
      await client.execute({
        sql: "SELECT (SELECT COUNT(*) FROM scores WHERE user_id = ?) + (SELECT COUNT(*) FROM scores_monthly WHERE user_id = ?) AS n",
        args: [uidB, uidB],
      })
    ).rows[0].n,
  );
ok((await countB()) === 2, "przed usunięciem: wynik w obu rankingach");
const del = await call(h.account, { method: "POST", token: tokB, body: { action: "delete" } });
ok(del.status === 200, "usunięcie konta");
ok((await call(h.me, { token: tokB })).status === 401, "sesja po usunięciu nieważna");
ok((await countB()) === 0, "wyniki usuniętego konta skasowane z obu rankingów");
{
  // osierocony wiersz (np. sprzed tej zmiany) nie może pojawić się w rankingu
  await client.execute({
    sql: "INSERT INTO scores (user_id, song_id, score, stars, updated_at, nick) VALUES (99999, 'test-mapa', 9999999, 5, ?, 'duch')",
    args: [new Date().toISOString()],
  });
  const g = await call(h.scores, { query: { songId: "test-mapa", period: "all" } });
  ok(!g.body.top.some((e) => e.nick === "duch"), "ranking nie pokazuje wyników bez konta");
}

console.log("· mp3 z edytora w częściach (limit 7 MB):");
{
  const sa = (await import("../api/song-audio.ts")).default;
  const raw = async (method, query, buf, key = process.env.EDITOR_PASSWORD) => {
    const req = {
      method,
      query,
      headers: { "x-real-ip": `10.9.0.${ipSeq++}`, "x-editor-key": key },
      async *[Symbol.asyncIterator]() {
        if (buf) yield buf;
      },
    };
    const res = {
      statusCode: 200,
      raw: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      setHeader() {
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
    await sa(req, res);
    let body = null;
    try {
      body = JSON.parse(res.raw);
    } catch {
      /* binarne */
    }
    return { status: res.statusCode, body, raw: res.raw };
  };
  // ~6,5 MB „mp3" (nagłówek ID3) w 3 częściach po 3 MB
  const full = Buffer.alloc(6.5 * 1024 * 1024, 7);
  full.write("ID3", 0);
  const P = 3 * 1024 * 1024;
  let last;
  for (let i = 0; i < 3; i++) {
    last = await raw("POST", { id: "test-audio", part: String(i), parts: "3" }, full.subarray(i * P, (i + 1) * P));
  }
  ok(last.status === 200 && last.body.done && last.body.bytes === full.length, "6,5 MB wgrane w 3 częściach");
  const info = await raw("GET", { id: "test-audio", info: "1" });
  ok(info.body.parts === 3 && info.body.bytes === full.length, "info: 3 części");
  const p1 = await raw("GET", { id: "test-audio", part: "1" });
  ok(Buffer.compare(Buffer.from(p1.raw), full.subarray(P, 2 * P)) === 0, "część 1 zgodna bajt w bajt");
  const big = Buffer.alloc(3 * 1024 * 1024, 1);
  big.write("ID3", 0);
  for (let i = 0; i < 3; i++) last = await raw("POST", { id: "test-big", part: String(i), parts: "3" }, big);
  ok(last.status === 413, "9 MB → odrzucone (limit 7 MB)");
}

client.close(); // plik bazy zostaje (Windows trzyma blokadę do końca procesu); kasuje go start testu
console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
