// Warstwa logowania / rejestracji / odzyskiwania hasła.
//
// Ścieżka główna: REST do funkcji serverless w /api (baza Turso, maile Resend).
// Fallback: gdy backend jest nieosiągalny (test jednostkowy, file://, brak sieci)
// używamy lokalnej atrapy na localStorage — dzięki temu gra działa też offline,
// a testy nie wymagają serwera. Sygnatury i typ `AuthResult` są stabilne.

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
  /** komunikat do pokazania użytkownikowi (gdy ok === false) */
  error?: string;
  /** informacja pomocnicza (np. „link wysłany”) */
  info?: string;
}

const USERS_KEY = "denis.users";

type UserRow = { pw: string; createdAt: string };

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

/** Prosty, jawnie NIEbezpieczny „hash” — tylko do atrapy bez serwera. */
function mask(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `d${h.toString(36)}_${s.length}`;
}

export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}
export function validPassword(p: string): boolean {
  return p.length >= 8;
}

function startSession(email: string, method: string, extra: Partial<Account> = {}) {
  const now = new Date().toISOString();
  saveAccount({
    nick: "",
    terms: true,
    termsAt: now,
    marketing: false,
    method,
    ...extra,
  } as Account);
  try {
    localStorage.setItem("denis.email", email.trim().toLowerCase());
  } catch {
    /* ignore */
  }
}

/**
 * ApiError 4xx → komunikat dla użytkownika (błąd walidacji, złe hasło, zajęty e-mail).
 * ApiError 5xx / OfflineError → przerzuć dalej: warstwa wyżej spróbuje lokalnej atrapy,
 * żeby awaria lub brak konfiguracji backendu nie blokowały wejścia do gry.
 */
function toResult(e: unknown): AuthResult {
  if (e instanceof ApiError && e.status < 500) return { ok: false, error: e.message };
  throw e instanceof OfflineError ? e : new OfflineError();
}

// ---- rejestracja --------------------------------------------------

export async function register(
  email: string,
  password: string,
  password2: string,
  opts: { terms: boolean; marketing: boolean },
): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  if (!validEmail(e)) return { ok: false, error: "Podaj poprawny adres e-mail." };
  if (!validPassword(password)) return { ok: false, error: "Hasło musi mieć co najmniej 8 znaków." };
  if (password !== password2) return { ok: false, error: "Hasła nie są takie same." };
  if (!opts.terms)
    return { ok: false, error: "Zaznacz akceptację Regulaminu i Polityki prywatności." };

  if (backendReachable()) {
    try {
      const r = await api<{ token: string }>("/api/auth/register", {
        method: "POST",
        body: { email: e, password, password2, terms: opts.terms, marketing: opts.marketing },
      });
      setToken(r.token);
      const now = new Date().toISOString();
      startSession(e, "email", {
        marketing: opts.marketing,
        marketingAt: opts.marketing ? now : undefined,
      });
      return { ok: true };
    } catch (err) {
      try {
        return toResult(err);
      } catch {
        /* OfflineError → spróbuj atrapy poniżej */
      }
    }
  }

  // atrapa offline
  const u = users();
  if (u[e]) return { ok: false, error: "Konto z tym adresem już istnieje. Zaloguj się." };
  u[e] = { pw: mask(password), createdAt: new Date().toISOString() };
  saveUsers(u);
  const now = new Date().toISOString();
  startSession(e, "email", {
    marketing: opts.marketing,
    marketingAt: opts.marketing ? now : undefined,
  });
  return { ok: true };
}

// ---- logowanie ---------------------------------------------------

export async function login(email: string, password: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  if (!validEmail(e)) return { ok: false, error: "Podaj poprawny adres e-mail." };

  if (backendReachable()) {
    try {
      const r = await api<{ token: string; nick?: string }>("/api/auth/login", {
        method: "POST",
        body: { email: e, password },
      });
      setToken(r.token);
      startSession(e, "email", { nick: r.nick || "" });
      return { ok: true };
    } catch (err) {
      try {
        return toResult(err);
      } catch {
        /* OfflineError → atrapa poniżej */
      }
    }
  }

  // atrapa offline
  const u = users();
  const row = u[e];
  if (!row) {
    if (!validPassword(password)) return { ok: false, error: "Nie znaleziono konta. Załóż nowe." };
    u[e] = { pw: mask(password), createdAt: new Date().toISOString() };
    saveUsers(u);
    startSession(e, "email");
    return { ok: true };
  }
  if (row.pw !== mask(password)) return { ok: false, error: "Nieprawidłowy e-mail lub hasło." };
  startSession(e, "email");
  return { ok: true };
}

export async function loginSocial(provider: "apple" | "google"): Promise<AuthResult> {
  // DOCELOWO: Sign in with Apple / Google Identity — token wymieniany na serwerze
  // (osobny endpoint /api/auth/social). Na tym etapie działa tylko atrapa.
  const e = `${provider}-user@example.invalid`;
  startSession(e, provider);
  return { ok: true };
}

// ---- reset hasła -----------------------------------------------

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  if (!validEmail(e)) return { ok: false, error: "Podaj poprawny adres e-mail." };

  if (backendReachable()) {
    try {
      const r = await api<{ info?: string }>("/api/auth/forgot", {
        method: "POST",
        body: { email: e },
      });
      return {
        ok: true,
        info: r.info || "Jeśli konto istnieje, wysłaliśmy na ten adres link do zmiany hasła.",
      };
    } catch (err) {
      try {
        return toResult(err);
      } catch {
        /* OfflineError → komunikat ogólny poniżej */
      }
    }
  }

  return {
    ok: true,
    info: "Jeśli konto istnieje, wysłaliśmy na ten adres link do zmiany hasła.",
  };
}

// ---- sesja -----------------------------------------------------

export function currentEmail(): string {
  try {
    return localStorage.getItem("denis.email") || "";
  } catch {
    return "";
  }
}

/** Sprawdza sesję po stronie serwera (po starcie aplikacji). Zwraca dane lub null. */
export async function fetchMe(): Promise<{ email: string; nick: string; marketing: boolean } | null> {
  if (!backendReachable() || !getToken()) return null;
  try {
    const r = await api<{ email: string; nick: string; marketing: boolean }>("/api/auth/me", {
      auth: true,
    });
    return { email: r.email, nick: r.nick, marketing: r.marketing };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      clearToken();
    }
    return null;
  }
}

export function logout() {
  clearToken();
}
