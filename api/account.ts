// Operacje na koncie zalogowanego użytkownika.
//   POST { action: "nick", nick }         → zmiana nicku
//   POST { action: "marketing", on }      → zgoda marketingowa + data
//   POST { action: "delete" }             → usunięcie konta i wszystkich danych

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { allow, body, json, nowIso, sessionUser } from "./_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });
    const c = db();
    const b = body<{ action?: string; nick?: string; on?: boolean }>(req);

    if (b.action === "nick") {
      const nick = String(b.nick || "").trim().slice(0, 18);
      await c.execute({ sql: "UPDATE users SET nick = ? WHERE id = ?", args: [nick, u.id] });
      return json(res, 200, { ok: true, nick });
    }

    if (b.action === "marketing") {
      const on = !!b.on;
      await c.execute({
        sql: "UPDATE users SET marketing = ?, marketing_at = ? WHERE id = ?",
        args: [on ? 1 : 0, nowIso(), u.id],
      });
      return json(res, 200, { ok: true, marketing: on });
    }

    if (b.action === "delete") {
      await c.batch(
        [
          { sql: "DELETE FROM scores WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM sessions WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM password_resets WHERE user_id = ?", args: [u.id] },
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
