// Zaproszenia na wesele (runda bonusowa „Pan Młody") — akcja promocyjna z TikToka:
// gracze piszą w komentarzu swój login z apki, a Konrad zarządza dostępami
// w edytorze (przycisk „💌 Zaproszenia").
//
//   nagłówek x-editor-key = EDITOR_PASSWORD
//   GET  /api/invite                                       → lista zaproszonych
//   POST /api/invite { logins: [...], push?: true }        → zaproś
//   POST /api/invite { action: "revoke", logins: [...] }   → odbierz dostęp
//   POST /api/invite { action: "official", login, password } → konto oficjalne
//        z ZASTRZEŻONĄ nazwą (np. DenisImpulsywni) — zwykła rejestracja ją blokuje
//
// Zaproszenie dopisuje "pan-mlody" do `users.unlocked` (to samo pole co
// odblokowania za monety — klient pokaże rundę i modal „Otrzymałeś zaproszenie
// weselne"). Opcjonalnie wysyła push przez OneSignal (external_id = "u<id>",
// ustawiane w apce przez OneSignal.login — patrz src/push.ts). Push wymaga
// zmiennej ONESIGNAL_REST_API_KEY w Vercelu; bez niej zaproszenia i tak działają.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, ensureSchema } from "./_lib/db.js";
import { requireEditor } from "./_lib/editor.js";
import { allow, body, hashPassword, json, loginKey, nowIso, PW_RULE, validLogin, validPassword } from "./_lib/util.js";

const WEDDING = "pan-mlody";
const ONESIGNAL_APP_ID = "45d6db77-411c-4ab6-a9ce-918a7325795d"; // jak DEFAULT_APP_ID w src/push.ts
const MAX_LOGINS = 500;
const HAS_WEDDING = "instr(',' || unlocked || ',', ',' || ? || ',') > 0";

async function sendPush(ids: string[]): Promise<{ sent: number; error?: string }> {
  const key = process.env.ONESIGNAL_REST_API_KEY || "";
  if (!key) return { sent: 0, error: "Brak ONESIGNAL_REST_API_KEY w Vercelu — push pominięty." };
  if (!ids.length) return { sent: 0 };
  let sent = 0;
  // OneSignal: do 2000 aliasów na jedno żądanie
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000);
    const r = await fetch("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Key ${key}` },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID || ONESIGNAL_APP_ID,
        target_channel: "push",
        include_aliases: { external_id: chunk },
        headings: { en: "💌 Otrzymałeś zaproszenie weselne!", pl: "💌 Otrzymałeś zaproszenie weselne!" },
        contents: {
          en: "Denis zaprasza Cię na wesele. Runda Pan Młody czeka w grze!",
          pl: "Denis zaprasza Cię na wesele. Runda Pan Młody czeka w grze!",
        },
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; errors?: unknown };
    if (!r.ok) return { sent, error: `OneSignal ${r.status}: ${JSON.stringify(j.errors ?? j).slice(0, 200)}` };
    sent += chunk.length;
  }
  return { sent };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  if (!(await requireEditor(req, res))) return;
  try {
    await ensureSchema();
    const c = db();

    if (req.method === "GET") {
      const r = await c.execute({
        sql: `SELECT login, nick, unlocked FROM users WHERE ${HAS_WEDDING} ORDER BY lower(login)`,
        args: [WEDDING],
      });
      const users = r.rows.map((row) => {
        const list = String(row.unlocked ?? "").split(",");
        return {
          login: String(row.login),
          nick: String(row.nick ?? ""),
          suits: list.filter((x) => x.startsWith("garnitur-")).length,
          weseleTrwa: list.includes("wesele-trwa"),
        };
      });
      return json(res, 200, { ok: true, users });
    }

    const b = body<{ logins?: unknown; push?: unknown; action?: unknown; login?: unknown; password?: unknown }>(req);

    if (b.action === "official") {
      // tylko z panelu edytora (hasło edytora wyżej) — pomija listę zastrzeżonych
      // nazw, reszta zasad jak przy zwykłej rejestracji
      const login = String(b.login || "").trim();
      const password = String(b.password || "");
      if (!validLogin(login)) return json(res, 400, { error: "Login: 3-18 znaków, litery, cyfry, . _ -" });
      if (!validPassword(password)) return json(res, 400, { error: PW_RULE });
      const taken = await c.execute({
        sql: "SELECT id FROM users WHERE login_key = ? OR lower(login) = lower(?) OR (nick <> '' AND lower(nick) = ?) LIMIT 1",
        args: [loginKey(login), login, loginKey(login)],
      });
      if (taken.rows[0]) return json(res, 409, { error: "Ten login jest już zajęty." });
      const now = nowIso();
      await c.execute({
        sql: "INSERT INTO users (login, pw_hash, nick, terms, terms_at, created_at, login_key) VALUES (?, ?, '', 1, ?, ?, ?)",
        args: [login, await hashPassword(password), now, now, loginKey(login)],
      });
      return json(res, 200, { ok: true, login });
    }

    const raw = Array.isArray(b.logins) ? b.logins : [];
    // loginy z komentarzy: bez @, spacji i duplikatów
    const wanted = [...new Set(raw.map((l) => String(l).trim().replace(/^@+/, "")).filter(Boolean))].slice(
      0,
      MAX_LOGINS,
    );
    if (!wanted.length) return json(res, 400, { error: "Podaj przynajmniej jeden login." });

    if (b.action === "revoke") {
      // odbiera samą rundę; kupione garnitury / Wesele trwa zostają w koncie
      // (bez zaproszenia i tak są niewidoczne, po ponownym zaproszeniu wracają)
      const revoked: string[] = [];
      const notFound: string[] = [];
      for (const login of wanted) {
        const r = await c.execute({
          sql: `UPDATE users SET unlocked = TRIM(REPLACE(',' || unlocked || ',', ',' || ? || ',', ','), ',')
                WHERE (login_key = ? OR lower(login) = lower(?)) AND ${HAS_WEDDING}
                RETURNING login`,
          args: [WEDDING, loginKey(login), login, WEDDING],
        });
        if (r.rows[0]) revoked.push(String(r.rows[0].login));
        else notFound.push(login);
      }
      return json(res, 200, { ok: true, revoked, notFound });
    }

    const invited: string[] = [];
    const already: string[] = [];
    const notFound: string[] = [];
    const pushIds: string[] = [];
    for (const login of wanted) {
      const r = await c.execute({
        sql: "SELECT id, login, unlocked FROM users WHERE login_key = ? OR lower(login) = lower(?) LIMIT 1",
        args: [loginKey(login), login],
      });
      const row = r.rows[0];
      if (!row) {
        notFound.push(login);
        continue;
      }
      const list = String(row.unlocked ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.includes(WEDDING)) {
        already.push(String(row.login));
        continue;
      }
      await c.execute({
        sql: `UPDATE users SET unlocked = TRIM(unlocked || ',' || ?, ',') WHERE id = ? AND NOT ${HAS_WEDDING}`,
        args: [WEDDING, row.id, WEDDING],
      });
      invited.push(String(row.login));
      pushIds.push(`u${row.id}`);
    }

    const push = b.push ? await sendPush(pushIds) : { sent: 0 };
    return json(res, 200, { ok: true, invited, already, notFound, push });
  } catch (e) {
    console.error("invite", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
