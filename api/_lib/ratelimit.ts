// Prosty limiter zapytań oparty o bazę (bez dodatkowych usług).
// Klucz = akcja + IP. Okno przesuwne: liczymy wpisy z ostatnich `windowSec`
// sekund; jeśli >= `max`, odrzucamy. Stare wpisy sprzątamy przy okazji.

import type { VercelRequest } from "@vercel/node";
import { db } from "./db.js";

export function clientIp(req: VercelRequest): string {
  // Na Vercelu `x-real-ip` = realne IP połączenia (ustawiane przez proxy, nie do
  // podrobienia). `x-forwarded-for` klient może prefiksować dowolnymi wartościami,
  // więc bierzemy z niego dopiero OSTATNI segment (dołożony przez Vercela).
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  if (realIp) return realIp.slice(0, 64);
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[xff.length - 1] : xff || "";
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return (parts[parts.length - 1] || "0.0.0.0").slice(0, 64);
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
    // Sprzątanie DLA TEGO KLUCZA w tym samym round-tripie — tabela nie puchnie
    // nawet pod atakiem (każdy klucz trzyma najwyżej ~1 okno wpisów).
    await c.execute({ sql: "DELETE FROM rate_limits WHERE k = ? AND ts < ?", args: [key, from] });
    const r = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM rate_limits WHERE k = ? AND ts >= ?",
      args: [key, from],
    });
    if (Number(r.rows[0]?.n ?? 0) >= max) return false;
    await c.execute({ sql: "INSERT INTO rate_limits (k, ts) VALUES (?, ?)", args: [key, now] });
    // rzadkie globalne sprzątanie (na wypadek osieroconych kluczy)
    if (Math.random() < 0.02) {
      await c.execute({
        sql: "DELETE FROM rate_limits WHERE ts < ?",
        args: [now - 3 * 3600 * 1000],
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
