// Ranking wyników — per piosenka, dwie zakładki: „ten miesiąc" i „wszystkie".
//   GET  /api/scores?songId=panna-mloda&period=month|all  → { top, me, total }
//   POST /api/scores  { songId, score, stars }  (Bearer)  → { ok, best, stars, rank }

import type { Client } from "@libsql/client/web";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { limitReq } from "./_lib/ratelimit.js";
import { allow, body, json, nowIso, sessionUser } from "./_lib/util.js";

// Bez limitu: tabela deduplikuje po graczu (PRIMARY KEY user_id+song_id w schema),
// więc wierszy jest tyle co graczy którzy zagrali dany utwór — nie rośnie per wynik.
const ym = () => new Date().toISOString().slice(0, 7); // "2026-09"

// Anti-cheat (wstępne): górny limit wyniku per utwór. Realny maks. „perfekcyjnego
// przebiegu" to ~2200 pkt/nutę (300 × mnożnik x5 × kick), plus przytrzymania —
// limit ~1,7× tego, żeby nie odrzucać uczciwych wyników, ale blokować absurdy.
const KNOWN_NOTES: Record<string, number> = { "panna-mloda": 310 };
// Długość utworu w sekundach (fallback, gdy chart nie ma pola `duration`).
// Używane przez bramkę anty-farm: monety za dany utwór można dostać najwyżej
// raz na ~pełną długość utworu (bo tyle realnie trwa jego zagranie).
const SONG_SECONDS: Record<string, number> = {
  "panna-mloda": 186,
  "ksiaze-z-bajki": 178,
  pogrzebowka: 188,
};
const DEFAULT_SONG_SECONDS = 150;

// Utwory, na które wolno zapisać wynik: rejestr z src/songs.ts (+ wyłączony
// „Pan Młody", którego chart leży w repo) ORAZ wszystko, co opublikowano
// z edytora (tabela `charts`). Wcześniej dowolne `songId` przechodziło — każde
// nowe id miało pustą bramkę anty-farm i domyślny cap 600 nut, czyli skrypt
// dostawał ~243 monety za każdy POST z wymyślonym id (+ śmieci w rankingu).
const SONG_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const STATIC_SONGS = new Set([
  "panna-mloda",
  "ksiaze-z-bajki",
  "pogrzebowka",
  "pani-policjantko",
  "byleby-nie-byla-ciepla",
  "pan-strazak",
  "pan-mlody",
]);

/** Metadane utworu albo null, gdy takiego utworu nie ma. */
async function songMeta(c: Client, songId: string): Promise<{ notes: number; seconds: number } | null> {
  if (!SONG_ID_RE.test(songId)) return null;
  let known = STATIC_SONGS.has(songId);
  let notes = KNOWN_NOTES[songId] ?? 600;
  let seconds = SONG_SECONDS[songId] ?? DEFAULT_SONG_SECONDS;
  try {
    const r = await c.execute({ sql: "SELECT data FROM charts WHERE song_id = ?", args: [songId] });
    if (r.rows[0]) {
      known = true;
      const d = JSON.parse(String(r.rows[0].data));
      if (Array.isArray(d?.notes) && d.notes.length) notes = d.notes.length;
      const dur = Number(d?.duration);
      if (Number.isFinite(dur) && dur > 20) seconds = dur;
    }
  } catch {
    /* brak tabeli / uszkodzone dane — lecimy na wartości znane / domyślne */
  }
  // klamra na wypadek literówki w opublikowanym charcie (np. duration 6000) —
  // bramka anty-farm nie może przez błąd danych zablokować uczciwego gracza
  if (!known) return null;
  return { notes, seconds: Math.max(60, Math.min(seconds, 420)) };
}

// Ile wierszy rankingu zwracamy. Wcześniej leciała CAŁA tabela (pełny skan
// i coraz większy JSON przy każdym wejściu w ranking). Własne miejsce gracza
// spoza top przychodzi osobno w polu `me`.
const TOP_LIMIT = 200;

const maxScoreFor =(notes: number) => Math.round(notes * 3800 + 150000);

async function rankAll(songId: string, score: number): Promise<number> {
  const r = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = ? AND score > ?",
    args: [songId, score],
  });
  return Number(r.rows[0]?.n ?? 0) + 1;
}
async function rankMonth(songId: string, m: string, score: number): Promise<number> {
  const r = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM scores_monthly WHERE song_id = ? AND ym = ? AND score > ?",
    args: [songId, m, score],
  });
  return Number(r.rows[0]?.n ?? 0) + 1;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();

    if (req.method === "GET") {
      if (!(await limitReq(req, "scores-get", 150, 60))) {
        return json(res, 429, { error: "Zbyt wiele zapytań." });
      }
      const songId = String(req.query.songId || "").trim();
      if (!SONG_ID_RE.test(songId)) return json(res, 400, { error: "Brak songId." });
      const monthly = String(req.query.period || "all") === "month";
      const m = ym();

      // LEFT JOIN, nie JOIN: gracz mógł skasować konto — wynik zostaje w tabeli
      // pod migawką nicku zapisaną w chwili gry (s.nick), patrz api/account.ts
      const rows = await c.execute(
        monthly
          ? {
              sql: `SELECT COALESCE(NULLIF(u.nick,''), u.login, NULLIF(s.nick,''), 'Gracz') AS nick, s.score AS score, s.user_id AS uid
                    FROM scores_monthly s LEFT JOIN users u ON u.id = s.user_id
                    WHERE s.song_id = ? AND s.ym = ?
                    ORDER BY s.score DESC, s.updated_at ASC
                    LIMIT ?`,
              args: [songId, m, TOP_LIMIT],
            }
          : {
              sql: `SELECT COALESCE(NULLIF(u.nick,''), u.login, NULLIF(s.nick,''), 'Gracz') AS nick, s.score AS score, s.user_id AS uid
                    FROM scores s LEFT JOIN users u ON u.id = s.user_id
                    WHERE s.song_id = ?
                    ORDER BY s.score DESC, s.updated_at ASC
                    LIMIT ?`,
              args: [songId, TOP_LIMIT],
            },
      );
      const total = await c.execute(
        monthly
          ? { sql: "SELECT COUNT(*) AS n FROM scores_monthly WHERE song_id = ? AND ym = ?", args: [songId, m] }
          : { sql: "SELECT COUNT(*) AS n FROM scores WHERE song_id = ?", args: [songId] },
      );

      const me = await sessionUser(req).catch(() => null);
      const top = rows.rows.map((r, i) => ({
        rank: i + 1,
        nick: String(r.nick || "Gracz"),
        score: Number(r.score),
        me: me ? Number(r.uid) === me.id : false,
      }));

      let mine: { rank: number; score: number } | null = null;
      if (me) {
        const ms = await c.execute(
          monthly
            ? { sql: "SELECT score FROM scores_monthly WHERE song_id = ? AND ym = ? AND user_id = ?", args: [songId, m, me.id] }
            : { sql: "SELECT score FROM scores WHERE song_id = ? AND user_id = ?", args: [songId, me.id] },
        );
        if (ms.rows[0]) {
          const sc = Number(ms.rows[0].score);
          mine = { rank: monthly ? await rankMonth(songId, m, sc) : await rankAll(songId, sc), score: sc };
        }
      }
      return json(res, 200, { ok: true, top, me: mine, total: Number(total.rows[0]?.n ?? 0) });
    }

    // POST — zapis wyniku do rankingu ogólnego i miesięcznego
    if (!(await limitReq(req, "scores-post", 40, 600))) {
      return json(res, 429, { error: "Zbyt wiele zapisów wyniku." });
    }
    const u = await sessionUser(req);
    if (!u) return json(res, 401, { error: "Brak sesji." });
    const b = body<{ songId?: string; score?: number; stars?: number }>(req);
    const songId = String(b.songId || "").trim();
    const score = Math.max(0, Math.floor(Number(b.score) || 0));
    const stars = Math.max(0, Math.min(5, Math.floor(Number(b.stars) || 0)));
    if (!songId) return json(res, 400, { error: "Brak songId." });

    // anti-cheat: wynik poza rozsądnym zakresem dla tego utworu → odrzuć
    const meta = await songMeta(c, songId);
    if (!meta) return json(res, 400, { error: "Nieznany utwór." });
    const cap = maxScoreFor(meta.notes);
    if (score > cap) {
      console.warn(`scores: odrzucony wynik ${score} (cap ${cap}) user ${u.id} song ${songId}`);
      return json(res, 422, { error: "Wynik poza dopuszczalnym zakresem." });
    }

    const prev = await c.execute({
      sql: "SELECT score, stars, coin_at FROM scores WHERE song_id = ? AND user_id = ?",
      args: [songId, u.id],
    });
    const best = Math.max(Number(prev.rows[0]?.score ?? 0), score);
    const bestStars = Math.max(Number(prev.rows[0]?.stars ?? 0), stars);
    const now = nowIso();
    const m = ym();

    // --- anty-farm monet ---
    // Monety za dany utwór przyznajemy najwyżej raz na 0,85 × długość utworu.
    // Mierzymy WYŁĄCZNIE czas serwera między dwiema wypłatami monet (`coin_at`
    // przy poprzednim przyznaniu vs `Date.now()` teraz). Klient nie przysyła
    // żadnego czasu — tylko songId + score + stars.
    //   • Uczciwy gracz i tak spędza całą długość utworu grając (plus ekran
    //     wyników i odliczanie), więc nigdy w tę bramkę nie wpada.
    //   • PAUZA nie pomaga farmić: wydłuża realny czas przebiegu, czyli tylko
    //     ZWIĘKSZA odstęp `Date.now() - prevCoinMs`. Nie da się nią skrócić
    //     drogi do kolejnej wypłaty ani zwiększyć liczby monet (te = floor(
    //     score/10000), a score nie rośnie w pauzie).
    //   • Skrypt POST-ujący wynik co kilka sekund dostaje 0 monet aż do upływu
    //     czasu, w którym REALNIE dałoby się utwór zagrać jeszcze raz.
    const prevCoinMs = Date.parse(String(prev.rows[0]?.coin_at ?? "")) || 0;
    const gateMs = meta.seconds * 1000 * 0.85;
    const coinEligible = Date.now() - prevCoinMs >= gateMs;
    // 1 moneta za każde pełne 10 000 pkt TEGO przebiegu (wynik po capie anty-cheat)
    const coinsGained = coinEligible ? Math.floor(score / 10_000) : 0;
    // migawka aktualnego nicku — zostaje w tabeli nawet po skasowaniu konta (LEFT JOIN w GET wyżej)
    const displayName = u.nick || u.login;
    await c.batch(
      [
        {
          sql: `INSERT INTO scores (user_id, song_id, score, stars, updated_at, coin_at, nick)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, song_id) DO UPDATE SET
                  score = MAX(scores.score, excluded.score),
                  stars = MAX(scores.stars, excluded.stars),
                  updated_at = excluded.updated_at,
                  coin_at = COALESCE(excluded.coin_at, scores.coin_at),
                  nick = excluded.nick`,
          args: [u.id, songId, score, stars, now, coinsGained > 0 ? now : null, displayName],
        },
        {
          sql: `INSERT INTO scores_monthly (user_id, song_id, ym, score, stars, updated_at, nick)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, song_id, ym) DO UPDATE SET
                  score = MAX(scores_monthly.score, excluded.score),
                  stars = MAX(scores_monthly.stars, excluded.stars),
                  updated_at = excluded.updated_at,
                  nick = excluded.nick`,
          args: [u.id, songId, m, score, stars, now, displayName],
        },
        { sql: "UPDATE users SET coins = coins + ? WHERE id = ?", args: [coinsGained, u.id] },
      ],
      "write",
    );
    let coins = 0;
    try {
      const cr = await c.execute({ sql: "SELECT coins FROM users WHERE id = ?", args: [u.id] });
      coins = Math.max(0, Number(cr.rows[0]?.coins ?? 0));
    } catch {
      /* stara baza — brak kolumny coins */
    }
    return json(res, 200, {
      ok: true,
      best,
      stars: bestStars,
      rank: await rankAll(songId, best),
      coins,
      coinsGained,
    });
  } catch (e) {
    console.error("scores", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
