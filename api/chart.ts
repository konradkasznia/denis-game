// Beatmapy publikowane z edytora.
//   GET  /api/chart?songId=panna-mloda           → { ok, chart }  (dla gry, bez logowania)
//   POST /api/chart  { chart }  (nagłówek x-editor-key)  → { ok }  (publikacja z edytora)
//
// Opublikowana beatmapa ma pierwszeństwo przed plikiem `public/charts/<id>.json`
// — kolega z edytora klika „Wyślij do aplikacji" i zmiana jest widoczna od razu,
// bez pobierania/wgrywania JSON-a i bez deployu.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { allow, json, body, nowIso } from "./_lib/util.js";

interface RawChart {
  id?: string;
  title?: string;
  bpm?: number;
  notes?: unknown;
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
      let chart: unknown = null;
      try {
        chart = JSON.parse(String(r.rows[0].data));
      } catch {
        return json(res, 500, { error: "Uszkodzone dane mapy." });
      }
      return json(res, 200, { ok: true, chart, updatedAt: String(r.rows[0].updated_at) });
    }

    // POST — publikacja z edytora
    const need = process.env.EDITOR_PASSWORD || "";
    const key = String(req.headers["x-editor-key"] || "");
    if (need && key !== need) return json(res, 401, { error: "Złe hasło publikacji." });

    const b = body<{ chart?: RawChart }>(req);
    const chart = (b.chart ?? (b as RawChart)) as RawChart;
    if (!chart || typeof chart !== "object" || !chart.id || !Array.isArray(chart.notes)) {
      return json(res, 400, { error: "Zły format mapy (brak id lub notes)." });
    }
    if (!chart.notes.length) return json(res, 400, { error: "Mapa nie ma nut." });

    await c.execute({
      sql: `INSERT INTO charts (song_id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(song_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      args: [String(chart.id), JSON.stringify(chart), nowIso()],
    });
    return json(res, 200, { ok: true, songId: String(chart.id), notes: chart.notes.length });
  } catch (e) {
    console.error("chart", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
