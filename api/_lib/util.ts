// Wspólne narzędzia dla funkcji API: hasła (scrypt), tokeny, sesje, odpowiedzi.

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "./db.js";

function scrypt(pw: string, salt: string): Promise<Buffer> {
  return new Promise((res, rej) => {
    _scrypt(pw, salt, 32, (err, dk) => (err ? rej(err) : res(dk as Buffer)));
  });
}

/** Zwraca "scrypt$<salt-hex>$<hash-hex>". */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const dk = await scrypt(pw, salt);
  return `scrypt$${salt}$${dk.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = String(stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hex] = parts;
  const dk = await scrypt(pw, salt);
  const a = Buffer.from(hex, "hex");
  return a.length === dk.length && timingSafeEqual(a, dk);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export const nowIso = () => new Date().toISOString();
export function plusDaysIso(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

/** Login = 3–18 znaków: litery (też polskie), cyfry, kropka, podkreślnik, myślnik. */
export function validLogin(s: string): boolean {
  return /^[\p{L}\p{N}._-]{3,18}$/u.test(String(s).trim());
}
/** Hasło: 8–200 znaków, wielka litera, cyfra i znak specjalny. */
export function validPassword(p: string): boolean {
  return (
    typeof p === "string" &&
    p.length >= 8 &&
    p.length <= 200 &&
    /\p{Lu}/u.test(p) &&
    /\p{Nd}/u.test(p) &&
    /[^\p{L}\p{N}\s]/u.test(p)
  );
}
export const PW_RULE = "Hasło musi mieć min. 8 znaków, wielką literę, cyfrę i znak specjalny.";

// ---- HTTP ----------------------------------------------------------

/** CORS — apka natywna (Capacitor, origin https://localhost) woła API cross-origin.
 *  Bez ciasteczek (auth = Bearer), więc `*` jest bezpieczne. */
export function cors(res: VercelResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-editor-key");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}

export function json(res: VercelResponse, status: number, body: unknown) {
  cors(res);
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.send(JSON.stringify(body));
}

/** Body przychodzi zparsowane przez Vercel; tu tylko normalizacja. */
export function body<T = Record<string, unknown>>(req: VercelRequest): T {
  const b = req.body;
  if (!b) return {} as T;
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as T;
    } catch {
      return {} as T;
    }
  }
  return b as T;
}

export function allow(req: VercelRequest, res: VercelResponse, methods: string[]): boolean {
  if (req.method === "OPTIONS") {
    cors(res);
    res.setHeader("access-control-allow-methods", [...methods, "OPTIONS"].join(", "));
    res.status(204).end();
    return false;
  }
  if (!methods.includes(req.method || "")) {
    json(res, 405, { error: "Metoda niedozwolona." });
    return false;
  }
  return true;
}

export interface SessionUser {
  id: number;
  login: string;
  nick: string;
  terms: boolean;
}

/** Długość życia sesji. Sesja jest „przesuwana" (patrz sessionUser) — aktywny
 *  gracz nigdy nie zostaje wylogowany. */
export const SESSION_DAYS = 730;
/** Poniżej tego zapasu (dni) odświeżamy `expires_at` przy użyciu sesji. */
const SESSION_RENEW_BELOW_DAYS = 690;

/** Odczytuje token z nagłówka Authorization i zwraca użytkownika albo null. */
export async function sessionUser(req: VercelRequest): Promise<SessionUser | null> {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  const c = db();
  const s = await c.execute({
    sql: "SELECT user_id, expires_at FROM sessions WHERE token = ?",
    args: [token],
  });
  const row = s.rows[0];
  if (!row) return null;
  const expMs = new Date(String(row.expires_at)).getTime();
  if (expMs < Date.now()) {
    await c.execute({ sql: "DELETE FROM sessions WHERE token = ?", args: [token] });
    return null;
  }
  // przesuwane wygaśnięcie — gdy zapasu zostało mniej niż próg, przedłuż sesję,
  // żeby aktywny użytkownik nigdy nie musiał logować się ponownie
  if (expMs - Date.now() < SESSION_RENEW_BELOW_DAYS * 86400_000) {
    try {
      await c.execute({
        sql: "UPDATE sessions SET expires_at = ? WHERE token = ?",
        args: [plusDaysIso(SESSION_DAYS), token],
      });
    } catch {
      /* przedłużenie nieudane — sesja i tak jest jeszcze ważna */
    }
  }
  const u = await c.execute({
    sql: "SELECT id, login, nick, terms FROM users WHERE id = ?",
    args: [Number(row.user_id)],
  });
  const ur = u.rows[0];
  if (!ur) return null;
  return {
    id: Number(ur.id),
    login: String(ur.login),
    nick: String(ur.nick || ""),
    terms: !!Number(ur.terms),
  };
}

/** Tworzy nową sesję (token przesuwany, patrz SESSION_DAYS / sessionUser). */
export async function createSession(userId: number): Promise<string> {
  const token = randomToken(32);
  await db().execute({
    sql: "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    args: [token, userId, nowIso(), plusDaysIso(SESSION_DAYS)],
  });
  return token;
}
