// Głosowania w apce.
//   POST /api/vote  { poll, choice }            → { ok }
//   GET  /api/vote?poll=poziom6                 → { ok, counts: {choice: n}, total }
//
// „poll" i „choice" to slugi z whitelisty (bez wolnego tekstu od klienta).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { limitReq, clientIp } from "./_lib/ratelimit.js";
import { allow, body, json, nowIso } from "./_lib/util.js";

// dozwolone głosowania i ich opcje (rozszerzalne)
const POLLS: Record<string, string[]> = {
  poziom6: ["pan-mlody", "pan-mechanik", "wodka-cytrynowka", "skacz-baw-pij", "krol-latino"],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();

    if (req.method === "GET") {
      const poll = String(req.query.poll || "").trim();
      if (!POLLS[poll]) return json(res, 400, { error: "Nieznane głosowanie." });
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
      return json(res, 200, { ok: true, counts, total });
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
    await c.execute({
      sql: "INSERT INTO poll_votes (poll, choice, voter, created_at) VALUES (?, ?, ?, ?)",
      args: [p, ch, clientIp(req).slice(0, 64), nowIso()],
    });
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 500, { error: `Błąd serwera: ${(e as Error).message}` });
  }
}
