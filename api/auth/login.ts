import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "../_lib/db.js";
import { limitReq } from "../_lib/ratelimit.js";
import { allow, body, createSession, json, loginKey, validLogin, verifyPassword } from "../_lib/util.js";

// poprawny format scrypt z losowymi wartościami — nie pasuje do żadnego hasła
const DUMMY_HASH = "scrypt$00000000000000000000000000000000$" + "0".repeat(64);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    if (!(await limitReq(req, "login", 20, 600, true)))
      return json(res, 429, { error: "Zbyt wiele prób logowania. Odczekaj chwilę." });
    const b = body<{ login?: string; password?: string }>(req);
    const login = String(b.login || "").trim();
    const password = String(b.password || "");
    if (!validLogin(login)) return json(res, 400, { error: "Podaj poprawny nick." });

    const c = db();
    const u = await c.execute({
      // login_key (Unicode); lower(login) tylko dla kont bez klucza (kolizja przy migracji)
      sql: "SELECT id, pw_hash, login, nick FROM users WHERE login_key = ? OR (login_key IS NULL AND lower(login) = lower(?)) LIMIT 1",
      args: [loginKey(login), login],
    });
    const row = u.rows[0];
    // brak konta też liczy scrypt — czas odpowiedzi nie zdradza, czy login istnieje
    const ok = await verifyPassword(password, row ? String(row.pw_hash) : DUMMY_HASH);
    if (!row || !ok) return json(res, 401, { error: "Nieprawidłowy login lub hasło." });

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
