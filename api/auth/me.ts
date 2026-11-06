import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, ensureSchema } from "../_lib/db.js";
import { limitReq } from "../_lib/ratelimit.js";
import { createHmac } from "node:crypto";
import { allow, hashToken, json, safeEqual, sessionUser } from "../_lib/util.js";
import { PROTO_FOTOGRAF_JS } from "../_lib/protoFotograf.js";

const PROTO_LOGINS = ["konrad", "denisimpulsywni"];
const PROTO_TICKET_MS = 60_000;
// klucz bilecików wyprowadzony z sekretu bazy; sam sekret nigdy nie opuszcza serwera
const protoKey = () => hashToken("proto-fotograf|" + (process.env.TURSO_AUTH_TOKEN || ""));
function protoTicket(userId: number): string {
  const payload = `${userId}.${Date.now() + PROTO_TICKET_MS}`;
  return `${payload}.${createHmac("sha256", protoKey()).update(payload).digest("hex")}`;
}
function protoTicketOk(ticket: string): boolean {
  const m = /^(\d+)\.(\d+)\.([0-9a-f]{64})$/.exec(ticket);
  if (!m || Number(m[2]) < Date.now()) return false;
  return safeEqual(m[3], createHmac("sha256", protoKey()).update(`${m[1]}.${m[2]}`).digest("hex"));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET"])) return;
  try {
    await ensureSchema();
    if (!(await limitReq(req, "me", 120, 60))) return json(res, 429, { error: "Zbyt wiele zapytań." });

    // prototyp rundy „Fotograf weselny" (public/proto/fotograf.html), krok 2:
    // <script src> nie wyśle nagłówka z tokenem, więc wpuszczamy go po bilecie
    if (req.query.proto === "fotograf") {
      if (!protoTicketOk(String(req.query.ticket || ""))) return json(res, 403, { error: "Brak dostępu." });
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).send(PROTO_FOTOGRAF_JS);
    }

    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });

    // krok 1: zalogowany gracz z listy dostaje bilet ważny minutę
    if (req.query.proto === "fotograf-ticket") {
      if (!PROTO_LOGINS.includes(String(u.login || "").trim().toLowerCase())) return json(res, 403, { error: "Brak dostępu." });
      res.setHeader("Cache-Control", "private, no-store");
      return json(res, 200, { ticket: protoTicket(u.id) });
    }

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
