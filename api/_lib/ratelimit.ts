// Prosty limiter zapytań oparty o bazę (bez dodatkowych usług).
// Klucz = akcja + IP. Okno przesuwne: liczymy wpisy z ostatnich `windowSec`
// sekund; jeśli >= `max`, odrzucamy. Stare wpisy sprzątamy przy okazji.

import type { VercelRequest } from "@vercel/node";
import { db } from "./db.js";

export function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff || "";
  const ip = raw.split(",")[0].trim() || String(req.headers["x-real-ip"] || "") || "0.0.0.0";
  return ip.slice(0, 64);
}

/** Zwraca true = przepuść, false = przekroczono limit. Błąd bazy = przepuść. */
export async function rateLimit(
  key: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  try {
    const c = db();
    const now = Date.now();
    const from = now - windowSec * 1000;
    const r = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM rate_limits WHERE k = ? AND ts >= ?",
      args: [key, from],
    });
    if (Number(r.rows[0]?.n ?? 0) >= max) return false;
    await c.execute({ sql: "INSERT INTO rate_limits (k, ts) VALUES (?, ?)", args: [key, now] });
    // okazjonalne sprzątanie (1 na ~20 żądań), żeby tabela nie puchła
    if (Math.random() < 0.05) {
      await c.execute({
        sql: "DELETE FROM rate_limits WHERE ts < ?",
        args: [now - 24 * 3600 * 1000],
      });
    }
    return true;
  } catch {
    return true;
  }
}

/** Skrót: limit dla żądania (akcja + IP). */
export async function limitReq(
  req: VercelRequest,
  action: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  return rateLimit(`${action}:${clientIp(req)}`, max, windowSec);
}
