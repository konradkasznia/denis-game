import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.js";
import { allow, body, createSession, json, validEmail, verifyPassword } from "../_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    const b = body<{ email?: string; password?: string }>(req);
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");
    if (!validEmail(email)) return json(res, 400, { error: "Podaj poprawny adres e-mail." });

    const c = db();
    const u = await c.execute({
      sql: "SELECT id, pw_hash, nick FROM users WHERE email = ?",
      args: [email],
    });
    const row = u.rows[0];
    // Ta sama odpowiedź niezależnie od tego, czy konto istnieje.
    if (!row || !(await verifyPassword(password, String(row.pw_hash))))
      return json(res, 401, { error: "Nieprawidłowy e-mail lub hasło." });

    const token = await createSession(Number(row.id));
    return json(res, 200, { ok: true, token, email, nick: String(row.nick || "") });
  } catch (e) {
    console.error("login", e);
    return json(res, 500, { error: "Błąd serwera. Spróbuj ponownie." });
  }
}
