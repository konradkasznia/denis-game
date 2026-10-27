// Operacje na koncie zalogowanego użytkownika.
//   POST { action: "nick", nick }              → zmiana nazwy wyświetlanej (opcjonalna)
//   POST { action: "password", currentPassword, newPassword } → zmiana hasła
//        (wymaga obecnego hasła; wylogowuje pozostałe urządzenia)
//   POST { action: "unlock", songId }          → odblokowanie poziomu za monety
//   POST { action: "lemons", keys }            → dopisanie zebranych cytryn (suma zbiorów)
//   POST { action: "envelope", amount }        → koperta na weselu (Pan Młody): monety
//        przepadają; łącznie min. 1000 (suma wszystkich kopert) odblokowuje „Wesele trwa"
//   POST { action: "delete" }                  → usunięcie konta i wszystkich danych

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { nickAllowed } from "./_lib/nick.js";
import { limitReq } from "./_lib/ratelimit.js";
import {
  allow,
  body,
  hashPassword,
  json,
  loginKey,
  PW_RULE,
  sessionUser,
  validPassword,
  verifyPassword,
} from "./_lib/util.js";

// Ile monet kosztuje odblokowanie danego poziomu. Serwer jest źródłem prawdy.
const TRAIN_FREE = 3; // Pociąg weselny: darmowe gry na konto
const TRAIN_COST = 15; // każda kolejna gra (monety)
const UNLOCK_COST: Record<string, number> = {
  pogrzebowka: 50,
  "wodka-cytrynowka": 500,
  // garnitury na wesele (Pan Młody) — kupowane tak jak poziomy, wymagają zaproszenia
  "garnitur-1": 1000,
  "garnitur-2": 5000,
};
// runda-wesele (tylko z zaproszeniem) i runda odblokowywana kopertą
const WEDDING = "pan-mlody";
const WEDDING_AFTER = "wesele-trwa";
const ENVELOPE_MIN = 1000;
const ENVELOPE_MAX = 1_000_000;
// Poziomy, które poza monetami wymagają zebranych cytryn (musi zgadzać się z src/lemons.ts).
const LEMONS_REQUIRED: Record<string, number> = { "wodka-cytrynowka": 5 };
// klucz cytryny: "<id utworu>@<sekunda z 2 miejscami>", np. "panna-mloda@42.50"
const LEMON_KEY_RE = /^[a-z0-9][a-z0-9-]{1,40}@\d{1,4}\.\d{2}$/;
const MAX_LEMONS = 60;

const csv = (v: unknown) =>
  String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  try {
    await ensureSchema();
    // limit i sesja to niezależne odczyty z bazy — równolegle (jedna podróż mniej)
    const [allowed, u] = await Promise.all([
      limitReq(req, "account", 30, 600),
      sessionUser(req).catch(() => null),
    ]);
    if (!allowed) return json(res, 429, { error: "Zbyt wiele operacji. Spróbuj później." });
    if (!u) return json(res, 401, { error: "Brak sesji." });
    const c = db();
    const b = body<{
      action?: string;
      nick?: string;
      songId?: string;
      newPassword?: string;
      currentPassword?: string;
      keys?: unknown;
      amount?: unknown;
    }>(req);

    if (b.action === "nick") {
      const nick = String(b.nick || "").trim().slice(0, 18);
      const nc = nickAllowed(nick);
      if (!nc.ok) return json(res, 400, { error: nc.error });
      if (nick) {
        // nick nie może być cudzym loginem ani cudzym nickiem — inaczej da się
        // podszyć pod innego gracza w rankingu
        const k = loginKey(nick);
        const taken = await c.execute({
          sql: `SELECT 1 FROM users WHERE id <> ? AND (login_key = ? OR lower(login) = lower(?)
                  OR (nick <> '' AND lower(nick) = ?)) LIMIT 1`,
          args: [u.id, k, nick, k],
        });
        if (taken.rows[0]) return json(res, 409, { error: "Ta nazwa jest już zajęta." });
      }
      await c.execute({ sql: "UPDATE users SET nick = ? WHERE id = ?", args: [nick, u.id] });
      return json(res, 200, { ok: true, nick });
    }

    if (b.action === "password") {
      // wymagamy OBECNEGO hasła: sam token (localStorage, pożyczony telefon)
      // nie może wystarczyć do trwałego przejęcia konta
      const cur = String(b.currentPassword || "");
      if (!cur) return json(res, 400, { error: "Podaj obecne hasło (zaktualizuj aplikację, jeśli nie ma tego pola)." });
      if (!(await limitReq(req, "password-check", 8, 900, true)))
        return json(res, 429, { error: "Zbyt wiele prób. Spróbuj za 15 minut." });
      const pr = await c.execute({ sql: "SELECT pw_hash FROM users WHERE id = ?", args: [u.id] });
      if (!(await verifyPassword(cur, String(pr.rows[0]?.pw_hash ?? ""))))
        return json(res, 403, { error: "Obecne hasło jest nieprawidłowe." });
      const np = String(b.newPassword || "");
      if (!validPassword(np)) return json(res, 400, { error: PW_RULE });
      const hash = await hashPassword(np);
      // ...i wylogowujemy WSZYSTKIE inne urządzenia (zostaje tylko ta sesja)
      await c.batch(
        [
          { sql: "UPDATE users SET pw_hash = ? WHERE id = ?", args: [hash, u.id] },
          { sql: "DELETE FROM sessions WHERE user_id = ? AND token <> ?", args: [u.id, u.tokenHash] },
        ],
        "write",
      );
      return json(res, 200, { ok: true });
    }

    if (b.action === "lemons") {
      // suma zbiorów: cytryn nigdy nie ubywa, więc kolejność/powtórki żądań nie szkodzą
      const incoming = Array.isArray(b.keys) ? b.keys.map(String).filter((k) => LEMON_KEY_RE.test(k)) : [];
      const r = await c.execute({ sql: "SELECT lemons FROM users WHERE id = ?", args: [u.id] });
      const set = new Set(csv(r.rows[0]?.lemons));
      for (const k of incoming) if (set.size < MAX_LEMONS) set.add(k);
      const lemons = [...set];
      await c.execute({ sql: "UPDATE users SET lemons = ? WHERE id = ?", args: [lemons.join(","), u.id] });
      return json(res, 200, { ok: true, lemons });
    }

    if (b.action === "envelope") {
      const amount = Math.floor(Number(b.amount));
      if (!Number.isFinite(amount) || amount < 0 || amount > ENVELOPE_MAX)
        return json(res, 400, { error: "Nieprawidłowa kwota." });
      const st = await c.execute({ sql: "SELECT coins, unlocked FROM users WHERE id = ?", args: [u.id] });
      const unlocked0 = csv(st.rows[0]?.unlocked);
      if (!unlocked0.includes(WEDDING)) return json(res, 403, { error: "Brak zaproszenia na wesele." });
      if (amount === 0) {
        return json(res, 200, { ok: true, coins: Math.max(0, Number(st.rows[0]?.coins ?? 0)), unlocked: unlocked0 });
      }
      // atomowo: zabierz monety (tylko gdy starczy), dolicz do sumy kopert i gdy
      // SUMA (poprzednie koperty + ta) >= ENVELOPE_MIN dopisz „Wesele trwa".
      // W SET SQLite widzi stare wartości kolumn, więc envelope_total = sprzed tej wpłaty.
      const upd = await c.execute({
        sql: `UPDATE users
              SET coins = coins - ?,
                  envelope_total = envelope_total + ?,
                  unlocked = CASE
                    WHEN envelope_total + ? >= ? AND instr(',' || unlocked || ',', ',' || ? || ',') = 0
                    THEN TRIM(unlocked || ',' || ?, ',')
                    ELSE unlocked END
              WHERE id = ? AND coins >= ?
              RETURNING coins, unlocked`,
        args: [amount, amount, amount, ENVELOPE_MIN, WEDDING_AFTER, WEDDING_AFTER, u.id, amount],
      });
      if (!upd.rows[0]) {
        return json(res, 402, {
          error: "Za mało monet.",
          coins: Math.max(0, Number(st.rows[0]?.coins ?? 0)),
          unlocked: unlocked0,
        });
      }
      return json(res, 200, {
        ok: true,
        coins: Math.max(0, Number(upd.rows[0].coins)),
        unlocked: csv(upd.rows[0].unlocked),
      });
    }

    // Pociąg weselny: 3 darmowe gry, każda kolejna 15 monet — atomowo w jednym UPDATE
    if (b.action === "trainPlay") {
      const upd = await c.execute({
        sql: `UPDATE users
              SET coins = coins - CASE WHEN train_plays >= ? THEN ? ELSE 0 END,
                  train_plays = train_plays + 1
              WHERE id = ? AND (train_plays < ? OR coins >= ?)
              RETURNING coins, train_plays`,
        args: [TRAIN_FREE, TRAIN_COST, u.id, TRAIN_FREE, TRAIN_COST],
      });
      if (!upd.rows[0]) {
        const st = await c.execute({ sql: "SELECT coins, train_plays FROM users WHERE id = ?", args: [u.id] });
        return json(res, 402, {
          error: "Za mało monet.",
          coins: Math.max(0, Number(st.rows[0]?.coins ?? 0)),
          trainPlays: Number(st.rows[0]?.train_plays ?? 0),
        });
      }
      return json(res, 200, {
        ok: true,
        coins: Math.max(0, Number(upd.rows[0].coins)),
        trainPlays: Number(upd.rows[0].train_plays),
      });
    }

    if (b.action === "unlock") {
      const songId = String(b.songId || "").trim().toLowerCase();
      const cost = UNLOCK_COST[songId];
      if (!cost) return json(res, 400, { error: "Tego poziomu nie odblokowuje się monetami." });
      if (songId.startsWith("garnitur-")) {
        const wr = await c.execute({ sql: "SELECT unlocked FROM users WHERE id = ?", args: [u.id] });
        if (!csv(wr.rows[0]?.unlocked).includes(WEDDING))
          return json(res, 403, { error: "Brak zaproszenia na wesele." });
      }
      const needLemons = LEMONS_REQUIRED[songId] ?? 0;
      if (needLemons) {
        const lr = await c.execute({ sql: "SELECT lemons FROM users WHERE id = ?", args: [u.id] });
        if (csv(lr.rows[0]?.lemons).length < needLemons)
          return json(res, 403, { error: "Najpierw zbierz wszystkie cytryny." });
      }

      const readState = async () => {
        const r = await c.execute({ sql: "SELECT coins, unlocked FROM users WHERE id = ?", args: [u.id] });
        return {
          coins: Math.max(0, Number(r.rows[0]?.coins ?? 0)),
          unlocked: String(r.rows[0]?.unlocked ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        };
      };

      // atomowo: odejmij monety I dopisz do `unlocked`, ale tylko gdy starczy
      // monet ORAZ poziom nie jest jeszcze odblokowany (chroni przed podwójnym
      // kliknięciem / równoległym żądaniem)
      const upd = await c.execute({
        sql: `UPDATE users
              SET coins = coins - ?,
                  unlocked = TRIM(unlocked || ',' || ?, ',')
              WHERE id = ?
                AND coins >= ?
                AND instr(',' || unlocked || ',', ',' || ? || ',') = 0
              RETURNING coins, unlocked`,
        args: [cost, songId, u.id, cost, songId],
      });

      if (upd.rows[0]) {
        return json(res, 200, {
          ok: true,
          coins: Math.max(0, Number(upd.rows[0].coins)),
          unlocked: String(upd.rows[0].unlocked).split(",").map((s) => s.trim()).filter(Boolean),
        });
      }
      // brak wiersza: albo za mało monet, albo już odblokowane
      const st = await readState();
      if (st.unlocked.includes(songId)) return json(res, 200, { ok: true, ...st }); // idempotentne
      return json(res, 402, { error: "Za mało monet.", ...st });
    }

    if (b.action === "delete") {
      // usuwamy WSZYSTKO, w tym wyniki z obu rankingów — tak obiecują
      // polityka-prywatnosci.html i usun-konto.html (RODO art. 17)
      await c.batch(
        [
          { sql: "DELETE FROM scores WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM scores_monthly WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM sessions WHERE user_id = ?", args: [u.id] },
          { sql: "DELETE FROM users WHERE id = ?", args: [u.id] },
        ],
        "write",
      );
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: "Nieznana operacja." });
  } catch (e) {
    console.error("account", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
