import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.ts";
import { allow, body, json, nowIso, plusHoursIso, randomToken, sha256, validEmail } from "../_lib/util.ts";
import { sendResetEmail } from "../_lib/email.ts";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  // Zawsze ta sama odpowiedź — nie ujawniamy, czy adres jest w bazie.
  const generic = {
    ok: true,
    info: "Jeśli konto istnieje, wysłaliśmy na ten adres link do zmiany hasła.",
  };
  try {
    await ensureSchema();
    const b = body<{ email?: string }>(req);
    const email = String(b.email || "").trim().toLowerCase();
    if (!validEmail(email)) return json(res, 400, { error: "Podaj poprawny adres e-mail." });

    const c = db();
    const u = await c.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
    const row = u.rows[0];
    if (row) {
      const userId = Number(row.id);
      const token = randomToken(32);
      await c.execute({
        sql: `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used)
              VALUES (?, ?, ?, ?, 0)`,
        args: [sha256(token), userId, nowIso(), plusHoursIso(1)],
      });
      try {
        await sendResetEmail(email, token);
      } catch (e) {
        console.error("sendResetEmail", e);
        // nie zdradzamy błędu użytkownikowi — zwracamy generic
      }
    }
    return json(res, 200, generic);
  } catch (e) {
    console.error("forgot", e);
    return json(res, 200, generic);
  }
}
