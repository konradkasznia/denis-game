// Sprawdzenie dostępności loginu (podpowiedź „na żywo" przy rejestracji).
//   GET /api/auth/check?login=xxx  →  { ok, available, reason? }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.js";
import { allow, json, validLogin } from "../_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET"])) return;
  try {
    await ensureSchema();
    const login = String(req.query.login || "").trim();
    if (!validLogin(login))
      return json(res, 200, { ok: true, available: false, reason: "format" });
    const c = db();
    const r = await c.execute({
      sql: "SELECT 1 FROM users WHERE lower(login) = lower(?) LIMIT 1",
      args: [login],
    });
    return json(res, 200, { ok: true, available: r.rows.length === 0 });
  } catch (e) {
    console.error("check", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
