// Ranking wyników — per piosenka.
//   GET  /api/scores?songId=panna-mloda   → { top: [...], me, total }
//   POST /api/scores  { songId, score, stars }  (Bearer)  → { ok, best, stars, rank }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.ts";
import { allow, body, json, nowIso, sessionUser } from "./_lib/util.ts";

const TOP_N = 50;

async function rankFor(songId: string, score: number): Promise<number> {
  const c = db();
  const r = await c.execute({
    sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = ? AND score > ?",
    args: [songId, score],
  });
  return Number(r.rows[0]?.n ?? 0) + 1;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();

    if (req.method === "GET") {
      const songId = String(req.query.songId || "").trim();
      if (!songId) return json(res, 400, { error: "Brak songId." });
      const rows = await c.execute({
        sql: `SELECT u.nick AS nick, s.score AS score, s.user_id AS uid
              FROM scores s JOIN users u ON u.id = s.user_id
              WHERE s.song_id = ? ORDER BY s.score DESC, s.updated_at ASC LIMIT ?`,
        args: [songId, TOP_N],
      });
      const total = await c.execute({
        sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = ?",
        args: [songId],
      });
      const me = await sessionUser(req).catch(() => null);
      const top = rows.rows.map((r, i) => ({
        rank: i + 1,
        nick: String(r.nick || "Gracz"),
        score: Number(r.score),
        me: me ? Number(r.uid) === me.id : false,
      }));
      let mine: { rank: number; score: number } | null = null;
      if (me) {
        const ms = await c.execute({
          sql: "SELECT score FROM scores WHERE song_id = ? AND user_id = ?",
          args: [songId, me.id],
        });
        if (ms.rows[0]) {
          const sc = Number(ms.rows[0].score);
          mine = { rank: await rankFor(songId, sc), score: sc };
        }
      }
      return json(res, 200, { ok: true, top, me: mine, total: Number(total.rows[0]?.n ?? 0) });
    }

    // POST
    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });
    const b = body<{ songId?: string; score?: number; stars?: number }>(req);
    const songId = String(b.songId || "").trim();
    const score = Math.max(0, Math.floor(Number(b.score) || 0));
    const stars = Math.max(0, Math.min(5, Math.floor(Number(b.stars) || 0)));
    if (!songId) return json(res, 400, { error: "Brak songId." });

    const prev = await c.execute({
      sql: "SELECT score, stars FROM scores WHERE song_id = ? AND user_id = ?",
      args: [songId, u.id],
    });
    const prevScore = Number(prev.rows[0]?.score ?? 0);
    const prevStars = Number(prev.rows[0]?.stars ?? 0);
    const best = Math.max(prevScore, score);
    const bestStars = Math.max(prevStars, stars);
    await c.execute({
      sql: `INSERT INTO scores (user_id, song_id, score, stars, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, song_id) DO UPDATE SET
              score = MAX(scores.score, excluded.score),
              stars = MAX(scores.stars, excluded.stars),
              updated_at = excluded.updated_at`,
      args: [u.id, songId, score, stars, nowIso()],
    });
    return json(res, 200, { ok: true, best, stars: bestStars, rank: await rankFor(songId, best) });
  } catch (e) {
    console.error("scores", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
