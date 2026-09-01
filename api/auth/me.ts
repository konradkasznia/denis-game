import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema } from "../_lib/db.js";
import { allow, json, sessionUser } from "../_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET"])) return;
  try {
    await ensureSchema();
    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });
    return json(res, 200, { ok: true, login: u.login, nick: u.nick, terms: u.terms });
  } catch (e) {
    console.error("me", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
