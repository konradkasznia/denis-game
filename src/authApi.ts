// Logowanie / rejestracja — model: LOGIN + HASŁO (bez e-maila, bez odzyskiwania).
//
// Ścieżka główna: REST do /api (baza Turso). Fallback: gdy backend jest
// nieosiągalny lub sypie 5xx (test, file://, brak sieci, brak konfiguracji) —
// lokalna atrapa na localStorage, żeby wejście do gry nie było zablokowane.

import { saveAccount, type Account } from "./account.ts";
import {
  api,
  ApiError,
  backendReachable,
  clearToken,
  getToken,
  OfflineError,
  setToken,
} from "./net.ts";

export interface AuthResult {
  ok: boolean;
  error?: string;
}

const USERS_KEY = "denis.users";

type UserRow = { pw: string; login: string; createdAt: string };

function users(): Record<string, UserRow> {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveUsers(u: Record<string, UserRow>) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(u));
  } catch {
    /* ignore */
  }
}

/** Prosty, jawnie NIEbezpieczny „hash" — tylko do atrapy bez serwera. */
function mask(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `d${h.toString(36)}_${s.length}`;
}

export function validLogin(s: string): boolean {
  return /^[\p{L}\p{N}._-]{3,18}$/u.test(s.trim());
}
/** Hasło: min. 8 znaków, przynajmniej jedna wielka litera i jeden znak specjalny. */
export function validPassword(p: string): boolean {
  return p.length >= 8 && p.length <= 200 && /\p{Lu}/u.test(p) && /[^\p{L}\p{N}]/u.test(p);
}
export const PW_RULE = "Hasło musi mieć min. 8 znaków, wielką literę i znak specjalny.";

function startSession(login: string) {
  saveAccount({
    login,
    nick: "",
    terms: true,
    termsAt: new Date().toISOString(),
    method: "login",
  } as Account);
  try {
    localStorage.setItem("denis.login", login);
  } catch {
    /* ignore */
  }
}

/** ApiError 4xx → komunikat. 5xx / OfflineError → rzuć dalej (fallback na atrapę). */
function toResult(e: unknown): AuthResult {
  if (e instanceof ApiError && e.status < 500) return { ok: false, error: e.message };
  throw e instanceof OfflineError ? e : new OfflineError();
}

// ---- rejestracja --------------------------------------------------

export async function register(
  login: string,
  password: string,
  password2: string,
  opts: { terms: boolean },
): Promise<AuthResult> {
  const l = login.trim();
  if (!validLogin(l)) return { ok: false, error: "Nick: od 3 do 18 znaków, bez spacji." };
  if (!validPassword(password)) return { ok: false, error: "Hasło nie spełnia wymagań." };
  if (password !== password2) return { ok: false, error: "Hasła nie są takie same." };
  if (!opts.terms) return { ok: false, error: "Zaznacz zgodę na Regulamin i Politykę." };

  if (backendReachable()) {
    try {
      const r = await api<{ token: string }>("/api/auth/register", {
        method: "POST",
        body: { login: l, password, password2, terms: opts.terms },
      });
      setToken(r.token);
      startSession(l);
      return { ok: true };
    } catch (err) {
      try {
        return toResult(err);
      } catch {
        /* OfflineError → atrapa poniżej */
      }
    }
  }

  const u = users();
  const key = l.toLowerCase();
  if (u[key]) return { ok: false, error: "Ten login jest już zajęty. Wybierz inny." };
  u[key] = { pw: mask(password), login: l, createdAt: new Date().toISOString() };
  saveUsers(u);
  startSession(l);
  return { ok: true };
}

// ---- logowanie ---------------------------------------------------

export async function login(loginName: string, password: string): Promise<AuthResult> {
  const l = loginName.trim();
  if (!validLogin(l)) return { ok: false, error: "Podaj poprawny nick." };

  if (backendReachable()) {
    try {
      const r = await api<{ token: string; login?: string }>("/api/auth/login", {
        method: "POST",
        body: { login: l, password },
      });
      setToken(r.token);
      startSession(r.login || l);
      return { ok: true };
    } catch (err) {
      try {
        return toResult(err);
      } catch {
        /* OfflineError → atrapa poniżej */
      }
    }
  }

  const u = users();
  const row = u[l.toLowerCase()];
  if (!row || row.pw !== mask(password))
    return { ok: false, error: "Nieprawidłowy login lub hasło." };
  startSession(row.login);
  return { ok: true };
}

/** Czy login jest wolny. Bez backendu / offline zwraca true (nie blokuje). */
export async function checkLogin(login: string): Promise<boolean> {
  const l = login.trim();
  if (!validLogin(l)) return false;
  if (!backendReachable()) {
    return !users()[l.toLowerCase()];
  }
  try {
    const r = await api<{ available: boolean }>(
      `/api/auth/check?login=${encodeURIComponent(l)}`,
    );
    return !!r.available;
  } catch {
    return true;
  }
}

// ---- sesja -----------------------------------------------------

export function currentLogin(): string {
  try {
    return localStorage.getItem("denis.login") || "";
  } catch {
    return "";
  }
}

export interface Me {
  login: string;
  nick: string;
  progress?: Record<string, { score: number; stars: number }>;
}

/** Sprawdza sesję po stronie serwera (po starcie aplikacji / po zalogowaniu).
 *  UWAGA: przy 401 NIE czyścimy tokena ani konta — użytkownik zostaje
 *  zalogowany, dopóki sam się nie wyloguje (priorytet: nie wyrzucać z sesji
 *  na żadnej platformie). Gra działa wtedy na lokalnej kopii danych. */
export async function fetchMe(): Promise<Me | null> {
  if (!backendReachable() || !getToken()) return null;
  try {
    const r = await api<Me>("/api/auth/me", { auth: true });
    return { login: r.login, nick: r.nick, progress: r.progress };
  } catch {
    return null;
  }
}

export function logout() {
  clearToken();
}
