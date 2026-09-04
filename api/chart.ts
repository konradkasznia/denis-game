// Beatmapy publikowane z edytora.
//   GET  /api/chart?songId=panna-mloda           → { ok, chart }  (dla gry, bez logowania)
//   POST /api/chart  { chart }  (nagłówek x-editor-key)  → { ok }  (publikacja z edytora)
//
// Opublikowana beatmapa ma pierwszeństwo przed plikiem `public/charts/<id>.json`
// — kolega z edytora klika „Wyślij do aplikacji" i zmiana jest widoczna od razu,
// bez pobierania/wgrywania JSON-a i bez deployu.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { limitReq } from "./_lib/ratelimit.js";
import { allow, json, body, nowIso } from "./_lib/util.js";

interface RawNote {
  lane: number;
  time: number;
  dur?: number;
  bomb?: boolean;
  fire?: boolean;
}
interface RawChar {
  at: number;
  sprite: string;
}
interface RawEvent {
  type: string;
  at: number;
  taps?: number;
  dur?: number;
}
interface RawChart {
  id?: string;
  title?: string;
  artist?: string;
  bpm?: number;
  gridOffset?: number;
  duration?: number;
  audioUrl?: string;
  bg?: string;
  characterScale?: number;
  characterY?: number;
  characters?: RawChar[];
  events?: RawEvent[];
  notes?: RawNote[];
}

const SONG_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const UJ_RE = /^ujecie[1-9]\d?$/;
const EVENT_TYPES = new Set(["ice", "spotlight", "drunk"]); // przeszkody na osi czasu (bomby to nuty)
const DUR_EVENTS = new Set(["spotlight", "drunk"]); // param = sekundy

/** Wymusza bezpieczne, względne ścieżki w opublikowanej mapie (blokuje np.
 *  `audioUrl: "https://evil.com/x.mp3"` → apka pobierałaby treść z obcego serwera). */
function sanitizeChart(raw: RawChart, songId: string): RawChart {
  const clean = (uj: string) => (UJ_RE.test(uj) ? uj : "ujecie1");
  const chars = Array.isArray(raw.characters)
    ? raw.characters
        .filter((c) => c && typeof c.at === "number")
        .map((c) => {
          const m = String(c.sprite || "").match(/ujecie\d{1,2}/);
          return { at: +c.at, sprite: `assets/char/${songId}/${clean(m?.[0] || "ujecie1")}` };
        })
    : undefined;
  const notes = (raw.notes || [])
    .filter((n) => n && typeof n.lane === "number" && typeof n.time === "number")
    .map((n) => ({
      lane: Math.max(0, Math.min(3, Math.round(n.lane))),
      time: Math.max(0, +Number(n.time).toFixed(4)),
      dur: n.dur ? Math.max(0, +Number(n.dur).toFixed(4)) : 0,
      ...(n.bomb ? { bomb: true } : n.fire ? { fire: true } : {}),
    }));
  const events = Array.isArray(raw.events)
    ? raw.events
        .filter((e) => e && EVENT_TYPES.has(String(e.type)) && typeof e.at === "number")
        .map((e) => {
          const type = String(e.type);
          const base = { type, at: Math.max(0, +Number(e.at).toFixed(4)) };
          if (DUR_EVENTS.has(type)) {
            return { ...base, dur: Math.max(1, Math.min(30, +Number(e.dur || 6).toFixed(2))) };
          }
          // ice
          return { ...base, taps: Math.max(1, Math.min(99, Math.round(Number(e.taps) || 20))) };
        })
        .slice(0, 200)
    : undefined;
  return {
    id: songId,
    title: String(raw.title || songId).slice(0, 80),
    artist: String(raw.artist || "Denis").slice(0, 60),
    bpm: Math.max(30, Math.min(400, Number(raw.bpm) || 120)),
    gridOffset: Math.max(-2, Math.min(2, Number(raw.gridOffset) || 0)),
    duration: Math.max(0, Math.min(1800, Number(raw.duration) || 0)),
    audioUrl: `assets/songs/${songId}.mp3`, // zawsze lokalny plik, nigdy obcy URL
    characterScale: Math.max(0.2, Math.min(3, Number(raw.characterScale) || 0.95)),
    characterY: Math.max(0, Math.min(2000, Number(raw.characterY) || 704)),
    ...(chars ? { characters: chars } : {}),
    ...(events && events.length ? { events } : {}),
    notes,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();

    if (req.method === "GET") {
      const songId = String(req.query.songId || "").trim();
      if (!songId) return json(res, 400, { error: "Brak songId." });
      const r = await c.execute({
        sql: "SELECT data, updated_at FROM charts WHERE song_id = ?",
        args: [songId],
      });
      if (!r.rows[0]) return json(res, 404, { error: "Brak opublikowanej mapy." });
      let chart: RawChart | null = null;
      try {
        chart = JSON.parse(String(r.rows[0].data)) as RawChart;
      } catch {
        return json(res, 500, { error: "Uszkodzone dane mapy." });
      }
      // sanityzacja przy ODCZYCIE (obejmuje też mapy zapisane starszą wersją)
      const safe = sanitizeChart(chart || {}, songId);
      res.setHeader("cache-control", "public, s-maxage=30, stale-while-revalidate=300");
      return json(res, 200, { ok: true, chart: safe, updatedAt: String(r.rows[0].updated_at) });
    }

    // POST — publikacja z edytora
    const need = process.env.EDITOR_PASSWORD || "";
    if (!need && process.env.VERCEL_ENV !== "development") {
      // fail-closed WSZĘDZIE poza lokalnym devem (także preview) — inaczej na
      // preview-deploymencie każdy publikuje beatmapy bez hasła do wspólnej bazy
      return json(res, 503, { error: "Publikacja wyłączona (brak konfiguracji hasła)." });
    }
    const key = String(req.headers["x-editor-key"] || "");
    if (need && key !== need) return json(res, 401, { error: "Złe hasło publikacji." });

    if (!(await limitReq(req, "chart-publish", 30, 3600))) {
      return json(res, 429, { error: "Zbyt wiele publikacji. Spróbuj później." });
    }

    const bp = body<{ chart?: RawChart }>(req);
    const incoming = (bp.chart ?? (bp as RawChart)) as RawChart;
    const songId = String(incoming?.id || "").trim().toLowerCase();
    if (!SONG_ID_RE.test(songId)) {
      return json(res, 400, { error: "Złe id utworu (a-z, 0-9, myślnik)." });
    }
    if (!Array.isArray(incoming.notes) || !incoming.notes.length) {
      return json(res, 400, { error: "Mapa nie ma nut." });
    }
    if (incoming.notes.length > 5000) {
      return json(res, 400, { error: "Za dużo nut (limit 5000)." });
    }

    const safe = sanitizeChart(incoming, songId);
    await c.execute({
      sql: `INSERT INTO charts (song_id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(song_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      args: [songId, JSON.stringify(safe), nowIso()],
    });
    return json(res, 200, { ok: true, songId, notes: safe.notes?.length ?? 0 });
  } catch (e) {
    console.error("chart", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
