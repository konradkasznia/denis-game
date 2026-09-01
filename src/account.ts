// Konto gracza. Źródłem prawdy jest backend (/api), a lokalnie trzymamy kopię
// roboczą: nick, zgody + daty ich wyrażenia, sposób logowania. Zmiany nicku /
// zgody / usunięcia konta są od razu zapisywane lokalnie i w tle wysyłane do API
// (gdy jest sesja i sieć). Bez sieci działa sam cache lokalny.

import { api, backendReachable, clearToken, getToken } from "./net.ts";

function syncToServer(bodyObj: Record<string, unknown>) {
  if (!backendReachable() || !getToken()) return;
  void api("/api/account", { method: "POST", body: bodyObj, auth: true }).catch(() => {
    /* zmiana i tak jest zapisana lokalnie; przy następnym logowaniu się zsynchronizuje */
  });
}

export interface Account {
  nick: string;
  /** akceptacja Regulaminu i Polityki Prywatności (wymagana) */
  terms: boolean;
  /** ISO data akceptacji regulaminu */
  termsAt?: string;
  /** zgoda na marketing e-mail (dobrowolna) */
  marketing: boolean;
  /** ISO data wyrażenia/cofnięcia zgody marketingowej */
  marketingAt?: string;
  /** jak się „zalogował”: email | apple | google */
  method: string;
}

const KEY = "denis.account";

export function getAccount(): Account | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export function saveAccount(a: Account) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

export function hasAccount(): boolean {
  return !!getAccount();
}

/** true = konto istnieje, ale gracz nie ustawił jeszcze nicku */
export function needsNick(): boolean {
  const a = getAccount();
  return !!a && !a.nick.trim();
}

export function setNick(nick: string) {
  const a =
    getAccount() ?? { nick: "", terms: true, marketing: false, method: "email" };
  a.nick = nick.trim().slice(0, 18);
  saveAccount(a);
  syncToServer({ action: "nick", nick: a.nick });
}

export function nick(): string {
  return getAccount()?.nick || "Ty";
}

/** Zmiana zgody marketingowej (z ekranu profilu) + zapis daty. */
export function setMarketing(on: boolean) {
  const a = getAccount();
  if (!a) return;
  a.marketing = on;
  a.marketingAt = new Date().toISOString();
  saveAccount(a);
  syncToServer({ action: "marketing", on });
}

export function marketing(): boolean {
  return !!getAccount()?.marketing;
}

/** Kończy sesję (wylogowanie): usuwa konto i lokalny postęp na tym urządzeniu. */
export function clearSession() {
  for (const k of [
    KEY,
    "denis.email",
    "denis.token",
    "denis.stars",
    "denis.best",
    "denis.discovered",
    "denis.settings",
  ]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  clearToken();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("denis.board.")) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** Usunięcie konta i wszystkich danych (żądanie „usuń moje dane”). */
export function deleteAccount() {
  // żądanie usunięcia po stronie serwera (wymóg RODO / App Store 5.1.1(v))
  syncToServer({ action: "delete" });
  // usuń też „rekord użytkownika” w lokalnej atrapie offline
  try {
    const email = localStorage.getItem("denis.email");
    if (email) {
      const raw = localStorage.getItem("denis.users");
      if (raw) {
        const u = JSON.parse(raw);
        delete u[email];
        localStorage.setItem("denis.users", JSON.stringify(u));
      }
    }
  } catch {
    /* ignore */
  }
  clearSession();
}
