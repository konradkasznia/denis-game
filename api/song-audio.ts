// Plik audio utworu wysłany z edytora — dla utworów, które nie mają mp3
// w repo/APK (np. testowe beatmapy). Trzymane w Turso jako BLOB.
//
//   POST /api/song-audio?id=<songId>   (x-editor-key, body = surowe bajty mp3)
//   GET  /api/song-audio?id=<songId>   → audio/mpeg
//
// Limit 4 MB (limit body funkcji Vercela). Większe pliki: niższy bitrate.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { limitReq } from "./_lib/ratelimit.js";
import { allow, json, nowIso } from "./_lib/util.js";

export const config = { api: { bodyParser: false } };

const MAX = 4 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

async function readBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX + 4096) throw new Error("too big");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();
    const id = String(req.query.id || "").trim().toLowerCase();
    if (!ID_RE.test(id)) return json(res, 400, { error: "Złe id utworu." });

    if (req.method === "GET") {
      const r = await c.execute({
        sql: "SELECT bytes FROM song_audio WHERE song_id = ?",
        args: [id],
      });
      const row = r.rows[0];
      if (!row) return json(res, 404, { error: "Brak audio dla tego utworu." });
      const raw = row.bytes as ArrayBuffer | Uint8Array;
      const buf = Buffer.from(raw as ArrayBuffer);
      res.setHeader("content-type", "audio/mpeg");
      res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=600");
      res.setHeader("access-control-allow-origin", "*");
      res.status(200).send(buf);
      return;
    }

    // POST — publikacja z edytora
    const need = process.env.EDITOR_PASSWORD || "";
    if (!need && process.env.VERCEL_ENV !== "development") {
      return json(res, 503, { error: "Publikacja wyłączona (brak konfiguracji hasła)." });
    }
    if (need && String(req.headers["x-editor-key"] || "") !== need) {
      return json(res, 401, { error: "Złe hasło publikacji." });
    }
    if (!(await limitReq(req, "song-audio", 20, 3600))) {
      return json(res, 429, { error: "Zbyt wiele wysyłek. Spróbuj później." });
    }

    let bytes: Buffer;
    try {
      bytes = await readBody(req);
    } catch {
      return json(res, 413, { error: "Plik za duży (limit 4 MB — użyj niższego bitrate)." });
    }
    if (bytes.length < 1000) return json(res, 400, { error: "Pusty / uszkodzony plik." });
    if (bytes.length > MAX) {
      return json(res, 413, { error: "Plik za duży (limit 4 MB — użyj niższego bitrate)." });
    }

    await c.execute({
      sql: `INSERT INTO song_audio (song_id, bytes, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(song_id) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`,
      args: [id, bytes, nowIso()],
    });
    return json(res, 200, { ok: true, bytes: bytes.length });
  } catch (e) {
    return json(res, 500, { error: `Błąd serwera: ${(e as Error).message}` });
  }
}
