import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.js";
import { limitReq } from "../_lib/ratelimit.js";
import { allow, body, createSession, json, validLogin, verifyPassword } from "../_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    if (!(await limitReq(req, "login", 20, 600)))
      return json(res, 429, { error: "Zbyt wiele prób logowania. Odczekaj chwilę." });
    const b = body<{ login?: string; password?: string }>(req);
    const login = String(b.login || "").trim();
    const password = String(b.password || "");
    if (!validLogin(login)) return json(res, 400, { error: "Podaj poprawny nick." });

    const c = db();
    const u = await c.execute({
      sql: "SELECT id, pw_hash, login, nick FROM users WHERE lower(login) = lower(?)",
      args: [login],
    });
    const row = u.rows[0];
    if (!row || !(await verifyPassword(password, String(row.pw_hash))))
      return json(res, 401, { error: "Nieprawidłowy login lub hasło." });

    const token = await createSession(Number(row.id));
    return json(res, 200, {
      ok: true,
      token,
      login: String(row.login),
      nick: String(row.nick || ""),
    });
  } catch (e) {
    console.error("login", e);
    return json(res, 500, { error: "Błąd serwera. Spróbuj ponownie." });
  }
}
