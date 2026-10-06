// Diagnostyka natywnej apki iOS (src/diag.ts): apka wysyła paczki krótkich
// wpisów, a my wypisujemy je do logów funkcji Vercela (`vercel logs`).
// Nic nie zapisujemy w bazie. Twarde limity rozmiaru zamiast rate-limitu,
// bo wpis w logu jest tani, a zapytanie do bazy na każdą paczkę już nie.
//   POST /api/diag  { s: "<id sesji>", lines: ["0.52s prep ...", ...] }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allow, body, json } from "./_lib/util.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["POST"])) return;
  const b = body<{ s?: unknown; lines?: unknown }>(req);
  const sid = String(b.s ?? "?").replace(/[^\w-]/g, "").slice(0, 12) || "?";
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
  for (const l of lines) console.log(`DIAG ${sid} ${String(l).replace(/[\r\n]+/g, " ").slice(0, 300)}`);
  json(res, 200, { ok: true });
}
