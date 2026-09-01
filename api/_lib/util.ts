// Wspólne narzędzia dla funkcji API: hasła (scrypt), tokeny, sesje, odpowiedzi.

import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
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

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export const nowIso = () => new Date().toISOString();
export function plusDaysIso(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}
export function plusHoursIso(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());
}
export function validPassword(p: string): boolean {
  return typeof p === "string" && p.length >= 8 && p.length <= 200;
}

// ---- HTTP ----------------------------------------------------------

export function json(res: VercelResponse, status: number, body: unknown) {
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
    res.setHeader("access-control-allow-methods", methods.join(", "));
    res.setHeader("access-control-allow-headers", "content-type, authorization");
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
  email: string;
  nick: string;
  marketing: boolean;
  terms: boolean;
  method: string;
}

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
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    await c.execute({ sql: "DELETE FROM sessions WHERE token = ?", args: [token] });
    return null;
  }
  const u = await c.execute({
    sql: "SELECT id, email, nick, marketing, terms, method FROM users WHERE id = ?",
    args: [Number(row.user_id)],
  });
  const ur = u.rows[0];
  if (!ur) return null;
  return {
    id: Number(ur.id),
    email: String(ur.email),
    nick: String(ur.nick || ""),
    marketing: !!Number(ur.marketing),
    terms: !!Number(ur.terms),
    method: String(ur.method || "email"),
  };
}

/** Tworzy nową sesję (token ważny 180 dni). */
export async function createSession(userId: number): Promise<string> {
  const token = randomToken(32);
  await db().execute({
    sql: "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    args: [token, userId, nowIso(), plusDaysIso(180)],
  });
  return token;
}
