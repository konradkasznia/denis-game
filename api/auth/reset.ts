import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.ts";
import { allow, body, hashPassword, json, sha256, validPassword } from "../_lib/util.ts";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    const b = body<{ token?: string; password?: string }>(req);
    const token = String(b.token || "").trim();
    const password = String(b.password || "");
    if (!token) return json(res, 400, { error: "Brak tokenu resetu." });
    if (!validPassword(password))
      return json(res, 400, { error: "Hasło musi mieć co najmniej 8 znaków." });

    const c = db();
    const r = await c.execute({
      sql: "SELECT token_hash, user_id, expires_at, used FROM password_resets WHERE token_hash = ?",
      args: [sha256(token)],
    });
    const row = r.rows[0];
    if (!row || Number(row.used) === 1)
      return json(res, 400, { error: "Link został już użyty lub jest nieprawidłowy." });
    if (new Date(String(row.expires_at)).getTime() < Date.now())
      return json(res, 400, { error: "Link wygasł. Poproś o nowy." });

    const userId = Number(row.user_id);
    const pw = await hashPassword(password);
    await c.batch(
      [
        { sql: "UPDATE users SET pw_hash = ? WHERE id = ?", args: [pw, userId] },
        {
          sql: "UPDATE password_resets SET used = 1 WHERE token_hash = ?",
          args: [String(row.token_hash)],
        },
        // wyloguj wszystkie istniejące sesje po zmianie hasła
        { sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] },
      ],
      "write",
    );
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("reset", e);
    return json(res, 500, { error: "Błąd serwera. Spróbuj ponownie." });
  }
}
