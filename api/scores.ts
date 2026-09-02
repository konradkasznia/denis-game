// Ranking wyników — per piosenka, dwie zakładki: „ten miesiąc" i „wszystkie".
//   GET  /api/scores?songId=panna-mloda&period=month|all  → { top, me, total }
//   POST /api/scores  { songId, score, stars }  (Bearer)  → { ok, best, stars, rank }

import type { Client } from "@libsql/client/web";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { limitReq } from "./_lib/ratelimit.js";
import { allow, body, json, nowIso, sessionUser } from "./_lib/util.js";

const TOP_N = 50;
const ym = () => new Date().toISOString().slice(0, 7); // "2026-09"

// Anti-cheat (wstępne): górny limit wyniku per utwór. Realny maks. „perfekcyjnego
// przebiegu" to ~2200 pkt/nutę (300 × mnożnik x5 × kick), plus przytrzymania —
// limit ~1,7× tego, żeby nie odrzucać uczciwych wyników, ale blokować absurdy.
const KNOWN_NOTES: Record<string, number> = { "panna-mloda": 310 };

async function songNoteCount(c: Client, songId: string): Promise<number> {
  try {
    const r = await c.execute({ sql: "SELECT data FROM charts WHERE song_id = ?", args: [songId] });
    const n = r.rows[0] ? JSON.parse(String(r.rows[0].data))?.notes : null;
    if (Array.isArray(n) && n.length) return n.length;
  } catch {
    /* brak tabeli / uszkodzone dane — lecimy na wartość znaną / domyślną */
  }
  return KNOWN_NOTES[songId] ?? 600;
}

const maxScoreFor = (notes: number) => Math.round(notes * 3800 + 150000);

async function rankAll(songId: string, score: number): Promise<number> {
  const r = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = ? AND score > ?",
    args: [songId, score],
  });
  return Number(r.rows[0]?.n ?? 0) + 1;
}
async function rankMonth(songId: string, m: string, score: number): Promise<number> {
  const r = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM scores_monthly WHERE song_id = ? AND ym = ? AND score > ?",
    args: [songId, m, score],
  });
  return Number(r.rows[0]?.n ?? 0) + 1;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();

    if (req.method === "GET") {
      if (!(await limitReq(req, "scores-get", 150, 60))) {
        return json(res, 429, { error: "Zbyt wiele zapytań." });
      }
      const songId = String(req.query.songId || "").trim();
      if (!songId) return json(res, 400, { error: "Brak songId." });
      const monthly = String(req.query.period || "all") === "month";
      const m = ym();

      const rows = await c.execute(
        monthly
          ? {
              sql: `SELECT COALESCE(NULLIF(u.nick,''), u.login) AS nick, s.score AS score, s.user_id AS uid
                    FROM scores_monthly s JOIN users u ON u.id = s.user_id
                    WHERE s.song_id = ? AND s.ym = ?
                    ORDER BY s.score DESC, s.updated_at ASC LIMIT ?`,
              args: [songId, m, TOP_N],
            }
          : {
              sql: `SELECT COALESCE(NULLIF(u.nick,''), u.login) AS nick, s.score AS score, s.user_id AS uid
                    FROM scores s JOIN users u ON u.id = s.user_id
                    WHERE s.song_id = ?
                    ORDER BY s.score DESC, s.updated_at ASC LIMIT ?`,
              args: [songId, TOP_N],
            },
      );
      const total = await c.execute(
        monthly
          ? { sql: "SELECT COUNT(*) AS n FROM scores_monthly WHERE song_id = ? AND ym = ?", args: [songId, m] }
          : { sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = ?", args: [songId] },
      );

      const me = await sessionUser(req).catch(() => null);
      const top = rows.rows.map((r, i) => ({
        rank: i + 1,
        nick: String(r.nick || "Gracz"),
        score: Number(r.score),
        me: me ? Number(r.uid) === me.id : false,
      }));

      let mine: { rank: number; score: number } | null = null;
      if (me) {
        const ms = await c.execute(
          monthly
            ? { sql: "SELECT score FROM scores_monthly WHERE song_id = ? AND ym = ? AND user_id = ?", args: [songId, m, me.id] }
            : { sql: "SELECT score FROM scores WHERE song_id = ? AND user_id = ?", args: [songId, me.id] },
        );
        if (ms.rows[0]) {
          const sc = Number(ms.rows[0].score);
          mine = { rank: monthly ? await rankMonth(songId, m, sc) : await rankAll(songId, sc), score: sc };
        }
      }
      return json(res, 200, { ok: true, top, me: mine, total: Number(total.rows[0]?.n ?? 0) });
    }

    // POST — zapis wyniku do rankingu ogólnego i miesięcznego
    if (!(await limitReq(req, "scores-post", 40, 600))) {
      return json(res, 429, { error: "Zbyt wiele zapisów wyniku." });
    }
    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });
    const b = body<{ songId?: string; score?: number; stars?: number }>(req);
    const songId = String(b.songId || "").trim();
    const score = Math.max(0, Math.floor(Number(b.score) || 0));
    const stars = Math.max(0, Math.min(5, Math.floor(Number(b.stars) || 0)));
    if (!songId) return json(res, 400, { error: "Brak songId." });

    // anti-cheat: wynik poza rozsądnym zakresem dla tego utworu → odrzuć
    const cap = maxScoreFor(await songNoteCount(c, songId));
    if (score > cap) {
      console.warn(`scores: odrzucony wynik ${score} (cap ${cap}) user ${u.id} song ${songId}`);
      return json(res, 422, { error: "Wynik poza dopuszczalnym zakresem." });
    }

    const prev = await c.execute({
      sql: "SELECT score, stars FROM scores WHERE song_id = ? AND user_id = ?",
      args: [songId, u.id],
    });
    const best = Math.max(Number(prev.rows[0]?.score ?? 0), score);
    const bestStars = Math.max(Number(prev.rows[0]?.stars ?? 0), stars);
    const now = nowIso();
    const m = ym();
    await c.batch(
      [
        {
          sql: `INSERT INTO scores (user_id, song_id, score, stars, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, song_id) DO UPDATE SET
                  score = MAX(scores.score, excluded.score),
                  stars = MAX(scores.stars, excluded.stars),
                  updated_at = excluded.updated_at`,
          args: [u.id, songId, score, stars, now],
        },
        {
          sql: `INSERT INTO scores_monthly (user_id, song_id, ym, score, stars, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, song_id, ym) DO UPDATE SET
                  score = MAX(scores_monthly.score, excluded.score),
                  stars = MAX(scores_monthly.stars, excluded.stars),
                  updated_at = excluded.updated_at`,
          args: [u.id, songId, m, score, stars, now],
        },
      ],
      "write",
    );
    return json(res, 200, { ok: true, best, stars: bestStars, rank: await rankAll(songId, best) });
  } catch (e) {
    console.error("scores", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
