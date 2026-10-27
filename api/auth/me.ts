import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, ensureSchema } from "../_lib/db.js";
import { limitReq } from "../_lib/ratelimit.js";
import { allow, json, sessionUser } from "../_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET"])) return;
  try {
    await ensureSchema();
    if (!(await limitReq(req, "me", 120, 60))) return json(res, 429, { error: "Zbyt wiele zapytań." });
    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });

    // postęp gracza (wynik + gwiazdki per utwór) — klient odtwarza z tego
    // odblokowane poziomy, gdy lokalny localStorage zostanie wyczyszczony
    // (nowe urządzenie, wylogowanie, kasowanie danych przeglądarki na iOS)
    const progress: Record<string, { score: number; stars: number }> = {};
    try {
      const sc = await db().execute({
        sql: "SELECT song_id, score, stars FROM scores WHERE user_id = ?",
        args: [u.id],
      });
      for (const r of sc.rows) {
        progress[String(r.song_id)] = { score: Number(r.score), stars: Number(r.stars) };
      }
    } catch {
      /* brak tabeli / błąd odczytu — zwróć sam profil */
    }

    // monety + poziomy odblokowane za monety (autorytatywne — klient nadpisuje cache)
    let coins = 0;
    let unlocked: string[] = [];
    let lemons: string[] = [];
    try {
      const cr = await db().execute({ sql: "SELECT coins, unlocked FROM users WHERE id = ?", args: [u.id] });
      coins = Math.max(0, Number(cr.rows[0]?.coins ?? 0));
      unlocked = String(cr.rows[0]?.unlocked ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      /* stara baza bez kolumn — zero monet */
    }
    // cytryny osobno: brak kolumny nie może wyzerować monet z zapytania wyżej
    try {
      const lr = await db().execute({ sql: "SELECT lemons FROM users WHERE id = ?", args: [u.id] });
      lemons = String(lr.rows[0]?.lemons ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      /* kolumna jeszcze nie istnieje */
    }

    // Pociąg weselny: ile gier już rozegrał (3 darmowe)
    let trainPlays = 0;
    try {
      const tr = await db().execute({ sql: "SELECT train_plays FROM users WHERE id = ?", args: [u.id] });
      trainPlays = Number(tr.rows[0]?.train_plays ?? 0);
    } catch {
      /* kolumna jeszcze nie istnieje */
    }

    return json(res, 200, {
      ok: true,
      trainPlays,
      login: u.login,
      nick: u.nick,
      terms: u.terms,
      progress,
      coins,
      unlocked,
      lemons,
      // identyfikator do OneSignal.login() — push „po loginie" (api/invite.ts)
      pushId: `u${u.id}`,
    });
  } catch (e) {
    console.error("me", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
