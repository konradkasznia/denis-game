// Cienka warstwa HTTP do API gry (funkcje serverless na Vercel, katalog /api).
//
// - token sesji trzymamy w localStorage ("denis.token"); leci w nagłówku Bearer,
// - gdy backendu nie ma (test, file://, brak sieci) → `api()` rzuca `OfflineError`,
//   a warstwy wyżej (authApi, account, leaderboard) mają lokalny fallback.

const TOKEN_KEY = "denis.token";

export class OfflineError extends Error {
  constructor() {
    super("offline");
    this.name = "OfflineError";
  }
}
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiBase(): string {
  try {
    const b = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE;
    if (b) return b.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  return "";
}

/** Czy w ogóle próbować gadać z backendem w tym środowisku. */
export function backendReachable(): boolean {
  try {
    if (typeof fetch !== "function") return false;
    if (apiBase()) return true;
    if (typeof location === "undefined") return false;
    return /^https?:$/.test(location.protocol);
  } catch {
    return false;
  }
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
export function setToken(t: string) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
export function clearToken() {
  setToken("");
}

interface ApiOpts {
  method?: string;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

/** Wywołanie API. Zwraca sparsowany JSON. Rzuca OfflineError / ApiError. */
export async function api<T = Record<string, unknown>>(path: string, opts: ApiOpts = {}): Promise<T> {
  if (!backendReachable()) throw new OfflineError();
  const { method = "GET", body, auth = false, timeoutMs = 12000 } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const t = getToken();
    if (t) headers.authorization = `Bearer ${t}`;
  }
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r: Response;
  try {
    r = await fetch(apiBase() + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl?.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data: Record<string, unknown> = {};
  let parsed = false;
  try {
    data = (await r.json()) as Record<string, unknown>;
    parsed = true;
  } catch {
    /* pusta / nie-JSON odpowiedź */
  }
  if (!r.ok) {
    // brak JSON-owego body przy błędzie = backend nie odpowiada po swojemu
    // (np. 404 z dev-serwera bez funkcji, strona błędu proxy) → traktuj jak offline
    if (!parsed || typeof data.error !== "string") throw new OfflineError();
    throw new ApiError(r.status, String(data.error));
  }
  return data as T;
}
