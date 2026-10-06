// Prosty limiter zapytań oparty o bazę (bez dodatkowych usług).
// Klucz = akcja + IP. Okno przesuwne: liczymy wpisy z ostatnich `windowSec`
// sekund; jeśli > `max`, odrzucamy. Stare wpisy sprzątamy przy okazji.

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

/** Zwraca true = przepuść, false = przekroczono limit.
 *  Błąd bazy: domyślnie przepuść (gra ma działać mimo czkawki bazy), ale dla
 *  akcji wrażliwych (logowanie, hasło edytora) `failClosed` = odrzuć. */
export async function rateLimit(
  key: string,
  max: number,
  windowSec: number,
  failClosed = false,
): Promise<boolean> {
  try {
    const c = db();
    const now = Date.now();
    const from = now - windowSec * 1000;
    // JEDNA podróż do bazy zamiast trzech: sprzątanie tego klucza, wpis, licznik.
    // Wpis liczy się także dla odrzuconych żądań — kto młóci dalej, ten dalej
    // jest zablokowany (tabela i tak trzyma najwyżej ~1 okno wpisów na klucz).
    const r = await c.batch(
      [
        { sql: "DELETE FROM rate_limits WHERE k = ? AND ts < ?", args: [key, from] },
        { sql: "INSERT INTO rate_limits (k, ts) VALUES (?, ?)", args: [key, now] },
        { sql: "SELECT COUNT(*) AS n FROM rate_limits WHERE k = ? AND ts >= ?", args: [key, from] },
      ],
      "write",
    );
    const n = Number(r[2]?.rows[0]?.n ?? 0);
    // rzadkie globalne sprzątanie (na wypadek osieroconych kluczy)
    if (Math.random() < 0.02) {
      await c.execute({
        sql: "DELETE FROM rate_limits WHERE ts < ?",
        args: [now - 3 * 3600 * 1000],
      });
    }
    return n <= max;
  } catch {
    return !failClosed;
  }
}

/** Skrót: limit dla żądania (akcja + IP). */
export async function limitReq(
  req: VercelRequest,
  action: string,
  max: number,
  windowSec: number,
  failClosed = false,
): Promise<boolean> {
  return rateLimit(`${action}:${clientIp(req)}`, max, windowSec, failClosed);
}

// ---- liczniki NIEUDANYCH prób (hasło edytora) -----------------------
// Liczymy tylko porażki, więc poprawnie zalogowany edytor nie zużywa limitu.

/** Czy klucz ma już >= `max` porażek w oknie. Błąd bazy = zablokowany. */
export async function failuresExceeded(key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const r = await db().execute({
      sql: "SELECT COUNT(*) AS n FROM rate_limits WHERE k = ? AND ts >= ?",
      args: [key, Date.now() - windowSec * 1000],
    });
    return Number(r.rows[0]?.n ?? 0) >= max;
  } catch {
    return true;
  }
}

export async function recordFailure(key: string): Promise<void> {
  try {
    await db().execute({ sql: "INSERT INTO rate_limits (k, ts) VALUES (?, ?)", args: [key, Date.now()] });
  } catch {
    /* ignore */
  }
}
