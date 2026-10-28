// Pojedynki 1 na 1 („Rzuć wyzwanie znajomym"), na razie jedna gra: Tort weselny.
// Obsługiwane przez api/scores.ts (?duels=1) — osobna funkcja przekroczyłaby
// limit 12 funkcji Vercela w planie Hobby.
//
//   GET  /api/scores?duels=mine            → { incoming, outgoing, results }   (Bearer)
//   GET  /api/scores?duels=rank            → { rows, me }                       (Bearer opcjonalnie)
//   GET  /api/scores?duels=check&nick=X    → { ok, nick } albo { error }        (Bearer)
//   POST /api/scores?duels=1 { action: "create", nick, score }   — wyzywający już zagrał
//   POST /api/scores?duels=1 { action: "answer", id, score }     — wyzwany zagrał
//   POST /api/scores?duels=1 { action: "decline", id }
//
// Zasady: wyzwany NIE widzi wyniku wyzywającego, dopóki sam nie zagra. Między
// dwiema osobami może trwać tylko jeden pojedynek naraz (w dowolną stronę).
// Pojedynek nierozegrany przez 14 dni wygasa (liczy się jak odrzucony).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "./db.js";
import { limitReq } from "./ratelimit.js";
import { body, json, nowIso, sessionUser } from "./util.js";

const GAME = "tort";
const MAX_SCORE = 500; // piętra — realnie kilkadziesiąt; wyższe = oszustwo
const EXPIRE_DAYS = 14;
const ONESIGNAL_APP_ID = "45d6db77-411c-4ab6-a9ce-918a7325795d"; // jak w api/invite.ts

const NAME = "COALESCE(NULLIF(nick,''), login)";

async function push(userId: number, heading: string, content: string) {
  const key = process.env.ONESIGNAL_REST_API_KEY || "";
  if (!key) return;
  try {
    await fetch("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Key ${key}` },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID || ONESIGNAL_APP_ID,
        target_channel: "push",
        include_aliases: { external_id: [`u${userId}`] },
        headings: { en: heading, pl: heading },
        contents: { en: content, pl: content },
      }),
    });
  } catch {
    /* push to dodatek — pojedynek działa bez niego */
  }
}

/** Wygaszenie starych, nierozegranych pojedynków (tanie — po indeksie statusu). */
async function expireOld() {
  const cutoff = new Date(Date.now() - EXPIRE_DAYS * 86400_000).toISOString();
  await db().execute({
    sql: "UPDATE duels SET status = 'expired', finished_at = ? WHERE status = 'pending' AND created_at < ?",
    args: [nowIso(), cutoff],
  });
}

async function findOpponent(nick: string) {
  const n = String(nick || "").trim();
  if (!n) return null;
  const r = await db().execute({
    sql: `SELECT id, ${NAME} AS name FROM users WHERE lower(${NAME}) = lower(?) LIMIT 1`,
    args: [n],
  });
  return r.rows[0] ? { id: Number(r.rows[0].id), name: String(r.rows[0].name) } : null;
}

async function activeBetween(a: number, b: number): Promise<boolean> {
  const r = await db().execute({
    sql: `SELECT 1 FROM duels WHERE status = 'pending' AND game = ?
          AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)) LIMIT 1`,
    args: [GAME, a, b, b, a],
  });
  return !!r.rows[0];
}

/** Sprawdza, czy można wyzwać gracza o tym nicku. */
async function checkTarget(me: number, nick: string): Promise<{ ok: true; id: number; name: string } | { ok: false; error: string }> {
  const opp = await findOpponent(nick);
  if (!opp) return { ok: false, error: "Nie ma gracza o takim nicku. Sprawdź pisownię." };
  if (opp.id === me) return { ok: false, error: "Nie możesz wyzwać samego siebie." };
  if (await activeBetween(me, opp.id)) {
    return { ok: false, error: "Z tym graczem trwa już pojedynek. Poczekaj, aż się rozstrzygnie." };
  }
  return { ok: true, id: opp.id, name: opp.name };
}

const validScore = (v: unknown) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= MAX_SCORE ? n : null;
};

export async function duelsHandler(req: VercelRequest, res: VercelResponse) {
  const c = db();
  const view = String(req.query.duels || "");

  if (req.method === "GET" && view === "rank") {
    if (!(await limitReq(req, "duels-rank", 60, 60))) return json(res, 429, { error: "Zbyt wiele zapytań." });
    // bilans = zwycięstwa − porażki; remis nie liczy się do żadnego
    const r = await c.execute({
      sql: `WITH s AS (
              SELECT a_id AS uid, (a_score > b_score) AS w, (a_score < b_score) AS l, a_score AS sc FROM duels WHERE status = 'done' AND game = ?
              UNION ALL
              SELECT b_id, (b_score > a_score), (b_score < a_score), b_score FROM duels WHERE status = 'done' AND game = ?
            )
            SELECT s.uid, ${NAME.replace(/nick|login/g, (m) => "u." + m)} AS name, SUM(s.w) AS wins, SUM(s.l) AS losses, MAX(s.sc) AS best
            FROM s JOIN users u ON u.id = s.uid
            GROUP BY s.uid
            ORDER BY (SUM(s.w) - SUM(s.l)) DESC, SUM(s.w) DESC, MAX(s.sc) DESC, s.uid ASC
            LIMIT 200`,
      args: [GAME, GAME],
    });
    const me = await sessionUser(req).catch(() => null);
    const rows = r.rows.map((row, i) => ({
      rank: i + 1,
      nick: String(row.name || "Gracz"),
      wins: Number(row.wins),
      losses: Number(row.losses),
      best: Number(row.best),
      me: me ? Number(row.uid) === me.id : false,
    }));
    return json(res, 200, { ok: true, rows });
  }

  const u = await sessionUser(req);
  if (!u) return json(res, 401, { error: "Zaloguj się, żeby grać w pojedynki." });

  if (req.method === "GET" && view === "check") {
    if (!(await limitReq(req, "duels-check", 60, 600))) return json(res, 429, { error: "Zbyt wiele prób. Odczekaj chwilę." });
    await expireOld();
    const t = await checkTarget(u.id, String(req.query.nick || ""));
    return t.ok ? json(res, 200, { ok: true, nick: t.name }) : json(res, 400, { error: t.error });
  }

  if (req.method === "GET") {
    if (!(await limitReq(req, "duels-mine", 120, 60))) return json(res, 429, { error: "Zbyt wiele zapytań." });
    await expireOld();
    const r = await c.execute({
      sql: `SELECT d.id, d.a_id, d.b_id, d.a_score, d.b_score, d.status, d.created_at, d.finished_at,
                   ${NAME.replace(/nick|login/g, (m) => "ua." + m)} AS a_name,
                   ${NAME.replace(/nick|login/g, (m) => "ub." + m)} AS b_name
            FROM duels d JOIN users ua ON ua.id = d.a_id JOIN users ub ON ub.id = d.b_id
            WHERE d.game = ? AND (d.a_id = ? OR d.b_id = ?)
            ORDER BY COALESCE(d.finished_at, d.created_at) DESC LIMIT 150`,
      args: [GAME, u.id, u.id],
    });
    const incoming: unknown[] = [];
    const results: unknown[] = [];
    for (const row of r.rows) {
      const mine = Number(row.a_id) === u.id; // ja wyzwałem
      const status = String(row.status);
      const opp = String(mine ? row.b_name : row.a_name);
      const myScore = mine ? Number(row.a_score) : row.b_score == null ? null : Number(row.b_score);
      // wynik przeciwnika widać dopiero po rozegraniu (wyzwany nie zna wyniku wyzywającego)
      const oppScore = status === "done" ? Number(mine ? row.b_score : row.a_score) : null;
      if (status === "pending" && !mine) {
        incoming.push({ id: Number(row.id), opp, createdAt: String(row.created_at) });
        continue;
      }
      let result: string;
      if (status === "pending") result = "waiting";
      else if (status === "declined") result = mine ? "oppDeclined" : "iDeclined";
      else if (status === "expired") result = mine ? "oppExpired" : "iExpired";
      else result = myScore! > oppScore! ? "won" : myScore! < oppScore! ? "lost" : "draw";
      results.push({ id: Number(row.id), opp, myScore, oppScore, result, at: String(row.finished_at || row.created_at) });
    }
    return json(res, 200, { ok: true, incoming, results });
  }

  // ---- POST ----
  const b = body<{ action?: string; nick?: string; score?: unknown; id?: unknown }>(req);

  if (b.action === "create") {
    if (!(await limitReq(req, "duels-create", 40, 3600))) return json(res, 429, { error: "Za dużo wyzwań naraz. Spróbuj za godzinę." });
    const score = validScore(b.score);
    if (score == null) return json(res, 400, { error: "Nieprawidłowy wynik." });
    await expireOld();
    const t = await checkTarget(u.id, String(b.nick || ""));
    if (!t.ok) return json(res, 400, { error: t.error });
    const ins = await c.execute({
      sql: "INSERT INTO duels (game, a_id, b_id, a_score, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id",
      args: [GAME, u.id, t.id, score, nowIso()],
    });
    const me = u.nick || u.login;
    await push(t.id, "🎂 Nowe wyzwanie!", `Użytkownik ${me} rzucił Ci wyzwanie w Tort Weselny`);
    return json(res, 200, { ok: true, id: Number(ins.rows[0]?.id), nick: t.name });
  }

  const id = Math.floor(Number(b.id));
  if (!Number.isFinite(id)) return json(res, 400, { error: "Brak pojedynku." });

  if (b.action === "answer") {
    if (!(await limitReq(req, "duels-answer", 60, 3600))) return json(res, 429, { error: "Zbyt wiele zapytań." });
    const score = validScore(b.score);
    if (score == null) return json(res, 400, { error: "Nieprawidłowy wynik." });
    const upd = await c.execute({
      sql: `UPDATE duels SET b_score = ?, status = 'done', finished_at = ?
            WHERE id = ? AND b_id = ? AND status = 'pending' RETURNING a_id, a_score`,
      args: [score, nowIso(), id, u.id],
    });
    const row = upd.rows[0];
    if (!row) return json(res, 409, { error: "Ten pojedynek jest już nieaktualny." });
    const oppScore = Number(row.a_score);
    const result = score > oppScore ? "won" : score < oppScore ? "lost" : "draw";
    const me = u.nick || u.login;
    const forA = result === "won" ? "przegrałeś" : result === "lost" ? "wygrałeś" : "jest remis";
    await push(Number(row.a_id), "🎂 Pojedynek rozstrzygnięty", `${me} ułożył(a) ${score} pięter, Ty ${oppScore}: ${forA}!`);
    return json(res, 200, { ok: true, myScore: score, oppScore, result });
  }

  if (b.action === "decline") {
    const upd = await c.execute({
      sql: "UPDATE duels SET status = 'declined', finished_at = ? WHERE id = ? AND b_id = ? AND status = 'pending' RETURNING id",
      args: [nowIso(), id, u.id],
    });
    if (!upd.rows[0]) return json(res, 409, { error: "Ten pojedynek jest już nieaktualny." });
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Nieznana akcja." });
}
