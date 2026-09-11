// Konto gracza. Źródłem prawdy jest backend (/api), lokalnie trzymamy kopię
// roboczą: login, opcjonalną nazwę wyświetlaną, akceptację regulaminu.
// Model: LOGIN + HASŁO, bez e-maila. Login jest zarazem nazwą w rankingu.

import { api, backendReachable, clearToken, getToken } from "./net.ts";

function syncToServer(bodyObj: Record<string, unknown>) {
  if (!backendReachable() || !getToken()) return;
  void api("/api/account", { method: "POST", body: bodyObj, auth: true }).catch(() => {
    /* zmiana i tak jest zapisana lokalnie; zsynchronizuje się przy okazji */
  });
}

export interface Account {
  /** login = nazwa konta i domyślna nazwa w rankingu */
  login: string;
  /** opcjonalna nazwa wyświetlana; puste = używamy loginu */
  nick: string;
  /** akceptacja Regulaminu i Polityki Prywatności (wymagana) */
  terms: boolean;
  /** ISO data akceptacji regulaminu */
  termsAt?: string;
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

export function login(): string {
  return getAccount()?.login || "";
}

/** Nazwa pokazywana w rankingu: nick, a jak pusty — login. */
export function nick(): string {
  const a = getAccount();
  return (a?.nick && a.nick.trim()) || a?.login || "Gracz";
}

/** Zmiana nazwy wyświetlanej (ekran ustawień). Puste = wracamy do loginu. */
export function setNick(nick: string) {
  const a = getAccount();
  if (!a) return;
  a.nick = nick.trim().slice(0, 18);
  saveAccount(a);
  syncToServer({ action: "nick", nick: a.nick });
}

/** Klucze URZĄDZENIA (nie konta) — przeżywają wylogowanie, bo dotyczą tego
 *  telefonu/przeglądarki, a nie zalogowanego gracza:
 *   - denis.howto / denis.healthWarn — samouczek i ostrzeżenie o migotaniu,
 *     „raz w życiu instalacji", niezależnie od tego, kto jest zalogowany;
 *   - denis.push.optin — subskrypcja OneSignal jest per-URZĄDZENIE (apka nie
 *     robi OneSignal.login/logout per konto), nie per-konto;
 *   - denis.users — lokalny rejestr kont założonych OFFLINE na tym
 *     urządzeniu (atrapa bez backendu) — trzeba go zachować, żeby dało się
 *     z powrotem zalogować na te konta po wylogowaniu.
 *  WSZYSTKO INNE pod prefiksem „denis." jest traktowane jako przypisane do
 *  KONTA i kasowane — świadomie na zasadzie listy wyjątków (a nie listy
 *  rzeczy do skasowania), żeby nowy klucz dodany w przyszłości domyślnie
 *  też się czyścił, zamiast po cichu „przeciekać" do następnego konta na
 *  tym samym urządzeniu (tak przeciekły kiedyś monety i odblokowania). */
const DEVICE_KEYS = new Set(["denis.howto", "denis.healthWarn", "denis.push.optin", "denis.users"]);

/** Kończy sesję (wylogowanie): usuwa konto i CAŁY lokalny postęp przypisany
 *  do niego na tym urządzeniu (monety, odblokowania, gwiazdki, tablice
 *  wyników, głosy w ankietach...) — patrz DEVICE_KEYS wyżej po listę
 *  wyjątków, które celowo zostają. */
export function clearSession() {
  clearToken();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("denis.") && !DEVICE_KEYS.has(k)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** Usunięcie konta i wszystkich danych (żądanie „usuń moje dane"). */
export function deleteAccount() {
  // żądanie usunięcia po stronie serwera (wymóg RODO / App Store 5.1.1(v))
  syncToServer({ action: "delete" });
  // usuń też rekord w lokalnej atrapie offline
  try {
    const l = (localStorage.getItem("denis.login") || "").toLowerCase();
    const raw = localStorage.getItem("denis.users");
    if (l && raw) {
      const u = JSON.parse(raw);
      delete u[l];
      localStorage.setItem("denis.users", JSON.stringify(u));
    }
  } catch {
    /* ignore */
  }
  clearSession();
}
