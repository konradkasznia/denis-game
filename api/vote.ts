// Głosowania w apce.
//   POST /api/vote  { poll, choice }   (auth)  → { ok, already? }
//   GET  /api/vote?poll=poziom6        (auth)  → { ok, voted, choice, counts, total }
//
// Jeden głos na użytkownika (UNIQUE(poll, voter) w schemacie). „voter" to
// "u:<id>" dla zalogowanych, "ip:<addr>" w ostateczności.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { limitReq, clientIp } from "./_lib/ratelimit.js";
import { allow, body, json, nowIso, sessionUser } from "./_lib/util.js";

// dozwolone głosowania i ich opcje (rozszerzalne)
const POLLS: Record<string, string[]> = {
  poziom6: ["pan-mlody", "pan-mechanik", "wodka-cytrynowka", "skacz-baw-pij", "krol-latino"],
};

async function voterId(req: VercelRequest): Promise<string> {
  try {
    const u = await sessionUser(req);
    if (u) return `u:${u.id}`;
  } catch {
    /* brak sesji — lecimy na IP */
  }
  return `ip:${clientIp(req).slice(0, 60)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();

    if (req.method === "GET") {
      const poll = String(req.query.poll || "").trim();
      if (!POLLS[poll]) return json(res, 400, { error: "Nieznane głosowanie." });

      const voter = await voterId(req);
      const mine = await c.execute({
        sql: "SELECT choice FROM poll_votes WHERE poll = ? AND voter = ? LIMIT 1",
        args: [poll, voter],
      });
      const myChoice = mine.rows[0] ? String(mine.rows[0].choice) : null;

      const r = await c.execute({
        sql: "SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll = ? GROUP BY choice",
        args: [poll],
      });
      const counts: Record<string, number> = {};
      for (const opt of POLLS[poll]) counts[opt] = 0;
      let total = 0;
      for (const row of r.rows) {
        const ch = String(row.choice);
        const n = Number(row.n) || 0;
        if (ch in counts) counts[ch] = n;
        total += n;
      }
      return json(res, 200, { ok: true, voted: myChoice != null, choice: myChoice, counts, total });
    }

    // POST
    if (!(await limitReq(req, "vote", 10, 3600))) {
      return json(res, 429, { error: "Za dużo głosów z tego adresu." });
    }
    const { poll, choice } = body<{ poll?: string; choice?: string }>(req);
    const p = String(poll || "").trim();
    const ch = String(choice || "").trim();
    if (!POLLS[p] || !POLLS[p].includes(ch)) {
      return json(res, 400, { error: "Nieprawidłowy głos." });
    }
    const voter = await voterId(req);
    // jednorazowość: jeśli już głosował, nie zmieniamy wyboru
    const existing = await c.execute({
      sql: "SELECT 1 FROM poll_votes WHERE poll = ? AND voter = ? LIMIT 1",
      args: [p, voter],
    });
    if (existing.rows[0]) return json(res, 200, { ok: true, already: true });

    try {
      await c.execute({
        sql: "INSERT INTO poll_votes (poll, choice, voter, created_at) VALUES (?, ?, ?, ?)",
        args: [p, ch, voter, nowIso()],
      });
    } catch {
      // wyścig: równoległy INSERT zdążył pierwszy (UNIQUE) — i tak jest głos
      return json(res, 200, { ok: true, already: true });
    }
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 500, { error: `Błąd serwera: ${(e as Error).message}` });
  }
}
