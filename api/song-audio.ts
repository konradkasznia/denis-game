// Plik audio utworu wysłany z edytora — dla utworów, które nie mają mp3
// w repo/APK (np. testowe beatmapy). Trzymane w Turso jako BLOB-y.
//
// Limit całego pliku: 7 MB. Funkcja Vercela przyjmuje/oddaje najwyżej ~4,5 MB
// w jednym żądaniu, więc większe pliki idą w CZĘŚCIACH (≤ 3 MB każda):
//
//   POST /api/song-audio?id=<songId>&part=<n>&parts=<N>  (x-editor-key, body = bajty części)
//        part=0 kasuje poprzednią wersję; po ostatniej części plik jest kompletny
//   GET  /api/song-audio?id=<songId>&info=1   → { parts, bytes }
//   GET  /api/song-audio?id=<songId>&part=<n> → bajty części n (audio/mpeg)
//   GET  /api/song-audio?id=<songId>          → cały plik, gdy mieści się w 1 żądaniu
//
// Stare klienty (POST bez part / GET bez part) działają jak dawniej dla plików ≤ 4 MB.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema, db } from "./_lib/db.js";
import { requireEditor } from "./_lib/editor.js";
import { limitReq } from "./_lib/ratelimit.js";
import { allow, json, nowIso } from "./_lib/util.js";

export const config = { api: { bodyParser: false } };

const MAX_TOTAL = 7 * 1024 * 1024; // cały plik
const MAX_PART = 4 * 1024 * 1024; // jedna część (body funkcji ~4,5 MB)
const MAX_PARTS = 8;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** MP3: nagłówek ID3 albo ramka MPEG (11 bitów synchronizacji). */
function looksLikeMp3(b: Buffer): boolean {
  if (b.length < 4) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true; // "ID3"
  return b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
}

async function readBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_PART + 4096) throw new Error("too big");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const TOO_BIG = "Plik za duży (limit 7 MB — użyj niższego bitrate).";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET", "POST"])) return;
  try {
    await ensureSchema();
    const c = db();
    const id = String(req.query.id || "").trim().toLowerCase();
    if (!ID_RE.test(id)) return json(res, 400, { error: "Złe id utworu." });

    if (req.method === "GET") {
      // limit: dopisanie śmieciowego parametru omija cache CDN, a każde takie
      // żądanie czytało BLOB z Turso (koszt transferu)
      if (!(await limitReq(req, "song-audio-get", 40, 60))) {
        return json(res, 429, { error: "Zbyt wiele zapytań." });
      }
      const parts = await c.execute({
        sql: "SELECT part, length(bytes) AS n FROM song_audio_parts WHERE song_id = ? ORDER BY part",
        args: [id],
      });
      const send = (raw: unknown) => {
        const buf = Buffer.from(raw as ArrayBuffer);
        res.setHeader("content-type", "audio/mpeg");
        res.setHeader("cache-control", "public, s-maxage=600, stale-while-revalidate=3600");
        res.setHeader("access-control-allow-origin", "*");
        res.status(200).send(buf);
      };

      if (parts.rows.length) {
        const total = parts.rows.reduce((a, r) => a + Number(r.n), 0);
        if (req.query.info) return json(res, 200, { ok: true, parts: parts.rows.length, bytes: total });
        const want = req.query.part !== undefined ? Number(req.query.part) : parts.rows.length === 1 ? 0 : -1;
        if (want < 0) {
          return json(res, 413, { error: "Plik w częściach — pobierz ?info=1, potem ?part=n.", parts: parts.rows.length });
        }
        const r = await c.execute({
          sql: "SELECT bytes FROM song_audio_parts WHERE song_id = ? AND part = ?",
          args: [id, want],
        });
        if (!r.rows[0]) return json(res, 404, { error: "Brak tej części." });
        return send(r.rows[0].bytes);
      }

      // starszy zapis: cały plik w jednej tabeli
      const r = await c.execute({ sql: "SELECT bytes FROM song_audio WHERE song_id = ?", args: [id] });
      const row = r.rows[0];
      if (!row) return json(res, 404, { error: "Brak audio dla tego utworu." });
      if (req.query.info) {
        return json(res, 200, { ok: true, parts: 1, bytes: Buffer.from(row.bytes as ArrayBuffer).length });
      }
      return send(row.bytes);
    }

    // POST — publikacja z edytora (limit błędnych haseł PRZED porównaniem)
    if (!(await requireEditor(req, res))) return;
    if (!(await limitReq(req, "song-audio", 60, 3600))) {
      return json(res, 429, { error: "Zbyt wiele wysyłek. Spróbuj później." });
    }
    const part = req.query.part !== undefined ? Math.floor(Number(req.query.part)) : 0;
    const partsN = req.query.parts !== undefined ? Math.floor(Number(req.query.parts)) : 1;
    if (!(partsN >= 1 && partsN <= MAX_PARTS && part >= 0 && part < partsN)) {
      return json(res, 400, { error: "Złe numery części." });
    }

    let bytes: Buffer;
    try {
      bytes = await readBody(req);
    } catch {
      return json(res, 413, { error: TOO_BIG });
    }
    if (bytes.length < 100) return json(res, 400, { error: "Pusty / uszkodzony plik." });
    if (part === 0 && !looksLikeMp3(bytes)) return json(res, 415, { error: "To nie wygląda na plik MP3." });

    if (part === 0) {
      // nowa wersja pliku: usuń stare części
      await c.execute({ sql: "DELETE FROM song_audio_parts WHERE song_id = ?", args: [id] });
    }
    await c.execute({
      sql: `INSERT INTO song_audio_parts (song_id, part, bytes, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(song_id, part) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`,
      args: [id, part, bytes, nowIso()],
    });

    if (part < partsN - 1) return json(res, 200, { ok: true, part, done: false });

    // ostatnia część — sprawdź komplet i łączny rozmiar
    const st = await c.execute({
      sql: "SELECT COUNT(*) AS k, COALESCE(SUM(length(bytes)), 0) AS n FROM song_audio_parts WHERE song_id = ?",
      args: [id],
    });
    const k = Number(st.rows[0]?.k ?? 0);
    const total = Number(st.rows[0]?.n ?? 0);
    if (k !== partsN || total > MAX_TOTAL) {
      await c.execute({ sql: "DELETE FROM song_audio_parts WHERE song_id = ?", args: [id] });
      return json(res, total > MAX_TOTAL ? 413 : 400, {
        error: total > MAX_TOTAL ? TOO_BIG : "Nie dotarły wszystkie części pliku — wyślij jeszcze raz.",
      });
    }
    // stary zapis w jednej tabeli już niepotrzebny
    await c.execute({ sql: "DELETE FROM song_audio WHERE song_id = ?", args: [id] });
    return json(res, 200, { ok: true, bytes: total, done: true });
  } catch (e) {
    console.error("song-audio", e);
    return json(res, 500, { error: "Błąd serwera." });
  }
}
