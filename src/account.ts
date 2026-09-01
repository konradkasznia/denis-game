// Konto gracza (na razie zamarkowane — logowanie nie jest podłączone do serwera).
// Trzymamy lokalnie: nick, zgody + daty ich wyrażenia, sposób logowania.
// Gdy będzie backend: te dane wędrują do API, reszta kodu bez zmian.

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
}

export function marketing(): boolean {
  return !!getAccount()?.marketing;
}

/** Usunięcie konta i całego lokalnego postępu (żądanie „usuń moje dane”). */
export function deleteAccount() {
  for (const k of [
    KEY,
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
  // wyczyść też tablice wyników trzymane lokalnie
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("denis.board.")) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
