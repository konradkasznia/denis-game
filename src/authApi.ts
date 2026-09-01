// Warstwa logowania / rejestracji / odzyskiwania hasła.
//
// TERAZ: implementacja zaślepkowa (mock) trzymająca konta w localStorage.
// Hasła są tylko lekko „zamaskowane” — to NIE jest bezpieczne przechowywanie.
// DOCELOWO: podmień ciało funkcji na wywołania REST do backendu
// (np. `await fetch(API + "/auth/login", { method: "POST", body: ... })`).
// Sygnatury funkcji i typ `AuthResult` zostają bez zmian — reszta aplikacji
// (game.ts, account.ts) nie wymaga wtedy przeróbek.

import { saveAccount, type Account } from "./account.ts";

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

/** Prosty, jawnie NIEbezpieczny „hash” — tylko do wersji demo bez serwera. */
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
    // e-mail trzymamy w polu method-agnostycznym; przy realnym API przyjdzie token
  } as Account);
  try {
    localStorage.setItem("denis.email", email.trim().toLowerCase());
  } catch {
    /* ignore */
  }
}

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
  if (!opts.terms) return { ok: false, error: "Zaznacz akceptację Regulaminu i Polityki prywatności." };

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

export async function login(email: string, password: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  if (!validEmail(e)) return { ok: false, error: "Podaj poprawny adres e-mail." };
  const u = users();
  const row = u[e];
  // wersja demo: jeśli konta nie ma, zakładamy je „w locie” po poprawnym haśle
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
  // DOCELOWO: Sign in with Apple / Google Identity — token wymieniany na serwerze.
  const e = `${provider}-user@example.invalid`;
  startSession(e, provider);
  return { ok: true };
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  if (!validEmail(e)) return { ok: false, error: "Podaj poprawny adres e-mail." };
  // DOCELOWO: serwer wysyła link resetujący. Zawsze zwracamy tę samą odpowiedź,
  // żeby nie ujawniać, czy adres istnieje w bazie.
  return {
    ok: true,
    info: "Jeśli konto istnieje, wysłaliśmy na ten adres link do zmiany hasła.",
  };
}

export function currentEmail(): string {
  try {
    return localStorage.getItem("denis.email") || "";
  } catch {
    return "";
  }
}
