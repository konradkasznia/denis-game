// Operacje na koncie zalogowanego użytkownika.
//   POST { action: "nick", nick }       → zmiana nazwy wyświetlanej (opcjonalna)
//   POST { action: "unlock", songId }   → odblokowanie poziomu za monety
//   POST { action: "delete" }           → usunięcie konta i wszystkich danych

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { nickAllowed } from "./_lib/nick.js";
import { limitReq } from "./_lib/ratelimit.js";
import { allow, body, json, sessionUser } from "./_lib/util.js";

// Ile monet kosztuje odblokowanie danego poziomu. Serwer jest źródłem prawdy.
const UNLOCK_COST: Record<string, number> = { pogrzebowka: 200 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    if (!(await limitReq(req, "account", 30, 600))) {
      return json(res, 429, { error: "Zbyt wiele operacji. Spróbuj później." });
    }
    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });
    const c = db();
    const b = body<{ action?: string; nick?: string; songId?: string }>(req);

    if (b.action === "nick") {
      const nick = String(b.nick || "").trim().slice(0, 18);
      const nc = nickAllowed(nick);
      if (!nc.ok) return json(res, 400, { error: nc.error });
      await c.execute({ sql: "UPDATE users SET nick = ? WHERE id = ?", args: [nick, u.id] });
      return json(res, 200, { ok: true, nick });
    }

    if (b.action === "unlock") {
      const songId = String(b.songId || "").trim().toLowerCase();
      const cost = UNLOCK_COST[songId];
      if (!cost) return json(res, 400, { error: "Tego poziomu nie odblokowuje się monetami." });

      const readState = async () => {
        const r = await c.execute({ sql: "SELECT coins, unlocked FROM users WHERE id = ?", args: [u.id] });
        return {
          coins: Math.max(0, Number(r.rows[0]?.coins ?? 0)),
          unlocked: String(r.rows[0]?.unlocked ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        };
      };

      // atomowo: odejmij monety I dopisz do `unlocked`, ale tylko gdy starczy
      // monet ORAZ poziom nie jest jeszcze odblokowany (chroni przed podwójnym
      // kliknięciem / równoległym żądaniem)
      const upd = await c.execute({
        sql: `UPDATE users
              SET coins = coins - ?,
                  unlocked = TRIM(unlocked || ',' || ?, ',')
              WHERE id = ?
                AND coins >= ?
                AND instr(',' || unlocked || ',', ',' || ? || ',') = 0
              RETURNING coins, unlocked`,
        args: [cost, songId, u.id, cost, songId],
      });

      if (upd.rows[0]) {
        return json(res, 200, {
          ok: true,
          coins: Math.max(0, Number(upd.rows[0].coins)),
          unlocked: String(upd.rows[0].unlocked).split(",").map((s) => s.trim()).filter(Boolean),
        });
      }
      // brak wiersza: albo za mało monet, albo już odblokowane
      const st = await readState();
      if (st.unlocked.includes(songId)) return json(res, 200, { ok: true, ...st }); // idempotentne
      return json(res, 402, { error: "Za mało monet.", ...st });
    }

    if (b.action === "delete") {
      await c.batch(
        [
          { sql: "DELETE FROM scores WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM scores_monthly WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM sessions WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM users WHERE id = ?", args: [u.id] },
        ],
        "write",
      );
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: "Nieznana operacja." });
  } catch (e) {
    console.error("account", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
