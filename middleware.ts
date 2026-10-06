// Ochrona edytora beatmap hasłem (HTTP Basic Auth, Vercel Edge Middleware).
// Hasło w zmiennej środowiskowej EDITOR_PASSWORD (login dowolny).
// Gra, API i dokumenty prawne NIE są objęte — matcher tylko na /editor.
//
// Nieudane próby są liczone per IP w tej samej tabeli `rate_limits` i pod tym
// samym kluczem co publikacja z edytora (api/_lib/editor.ts) — po 10 błędach
// w 15 min oba wejścia odpowiadają 429, więc hasła nie da się zgadywać.

import { createClient } from "@libsql/client/web";

export const config = {
  matcher: ["/editor", "/editor.html", "/editor/:path*"],
};

const FAIL_MAX = 10; // = EDITOR_FAIL_MAX w api/_lib/editor.ts
const FAIL_WINDOW_MS = 15 * 60 * 1000;

function clientIp(request: Request): string {
  const real = (request.headers.get("x-real-ip") || "").trim();
  if (real) return real.slice(0, 64);
  const parts = (request.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (parts[parts.length - 1] || "0.0.0.0").slice(0, 64);
}

function dbClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return null;
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

/** Porównanie w stałym czasie (Edge nie ma node:crypto.timingSafeEqual). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const unauthorized = () =>
  new Response("Edytor beatmap — wymagane logowanie.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Edytor beatmap DENIS", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
    },
  });

export default async function middleware(request: Request): Promise<Response | undefined> {
  const pass = process.env.EDITOR_PASSWORD;
  if (!pass) {
    // Tylko lokalny dev bez hasła przepuszczamy. Na każdym deployu Vercela
    // (produkcja I preview) brak hasła = zamknięte — adresy preview nie są
    // sekretem, a baza `charts` bywa wspólna z produkcją.
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "development") {
      return new Response("Edytor niedostępny (brak konfiguracji).", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return undefined;
  }

  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  // bez nagłówka = przeglądarka dopiero pyta o hasło; nie liczymy jako próby
  if (scheme !== "Basic" || !encoded) return unauthorized();

  const db = dbClient();
  const failKey = `editor-fail:${clientIp(request)}`;
  try {
    if (db) {
      const r = await db.execute({
        sql: "SELECT COUNT(*) AS n FROM rate_limits WHERE k = ? AND ts >= ?",
        args: [failKey, Date.now() - FAIL_WINDOW_MS],
      });
      if (Number(r.rows[0]?.n ?? 0) >= FAIL_MAX) {
        return new Response("Zbyt wiele błędnych haseł. Spróbuj za 15 minut.", {
          status: 429,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    }
  } catch {
    /* baza niedostępna — samo hasło dalej chroni edytor */
  }

  let provided = "";
  try {
    const decoded = atob(encoded);
    provided = decoded.slice(decoded.indexOf(":") + 1);
  } catch {
    /* zła wartość -> porażka poniżej */
  }
  if (provided && (await safeEqual(provided, pass))) return undefined;

  try {
    if (db) await db.execute({ sql: "INSERT INTO rate_limits (k, ts) VALUES (?, ?)", args: [failKey, Date.now()] });
  } catch {
    /* ignore */
  }
  return unauthorized();
}
