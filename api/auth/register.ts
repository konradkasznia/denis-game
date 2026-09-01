import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.ts";
import {
  allow,
  body,
  createSession,
  hashPassword,
  json,
  nowIso,
  validEmail,
  validPassword,
} from "../_lib/util.ts";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    const b = body<{
      email?: string;
      password?: string;
      password2?: string;
      terms?: boolean;
      marketing?: boolean;
    }>(req);
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");

    if (!validEmail(email)) return json(res, 400, { error: "Podaj poprawny adres e-mail." });
    if (!validPassword(password))
      return json(res, 400, { error: "Hasło musi mieć co najmniej 8 znaków." });
    if (b.password2 != null && password !== String(b.password2))
      return json(res, 400, { error: "Hasła nie są takie same." });
    if (!b.terms)
      return json(res, 400, { error: "Zaznacz akceptację Regulaminu i Polityki prywatności." });

    const c = db();
    const exists = await c.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
    if (exists.rows[0])
      return json(res, 409, { error: "Konto z tym adresem już istnieje. Zaloguj się." });

    const now = nowIso();
    const pw = await hashPassword(password);
    const ins = await c.execute({
      sql: `INSERT INTO users (email, pw_hash, nick, terms, terms_at, marketing, marketing_at, method, created_at)
            VALUES (?, ?, '', 1, ?, ?, ?, 'email', ?)`,
      args: [email, pw, now, b.marketing ? 1 : 0, b.marketing ? now : null, now],
    });
    const userId = Number(ins.lastInsertRowid);
    const token = await createSession(userId);
    return json(res, 200, { ok: true, token, email, nick: "" });
  } catch (e) {
    console.error("register", e);
    return json(res, 500, { error: "Błąd serwera. Spróbuj ponownie." });
  }
}
