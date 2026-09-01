import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.js";
import { limitReq } from "../_lib/ratelimit.js";
import {
  allow,
  body,
  createSession,
  hashPassword,
  json,
  nowIso,
  PW_RULE,
  validLogin,
  validPassword,
} from "../_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    if (!(await limitReq(req, "register", 6, 3600)))
      return json(res, 429, { error: "Zbyt wiele prób. Spróbuj ponownie za jakiś czas." });
    const b = body<{
      login?: string;
      password?: string;
      password2?: string;
      terms?: boolean;
    }>(req);
    const login = String(b.login || "").trim();
    const password = String(b.password || "");

    if (!validLogin(login))
      return json(res, 400, { error: "Login: 3–18 znaków (litery, cyfry, . _ -)." });
    if (!validPassword(password)) return json(res, 400, { error: PW_RULE });
    if (b.password2 != null && password !== String(b.password2))
      return json(res, 400, { error: "Hasła nie są takie same." });
    if (!b.terms)
      return json(res, 400, { error: "Zaznacz akceptację Regulaminu i Polityki prywatności." });

    const c = db();
    const exists = await c.execute({
      sql: "SELECT id FROM users WHERE lower(login) = lower(?)",
      args: [login],
    });
    if (exists.rows[0])
      return json(res, 409, { error: "Ten login jest już zajęty. Wybierz inny." });

    const now = nowIso();
    const pw = await hashPassword(password);
    const ins = await c.execute({
      sql: `INSERT INTO users (login, pw_hash, nick, terms, terms_at, created_at)
            VALUES (?, ?, '', 1, ?, ?)`,
      args: [login, pw, now, now],
    });
    const token = await createSession(Number(ins.lastInsertRowid));
    return json(res, 200, { ok: true, token, login, nick: "" });
  } catch (e) {
    console.error("register", e);
    return json(res, 500, { error: "Błąd serwera. Spróbuj ponownie." });
  }
}
