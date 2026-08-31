// Konto gracza (na razie zamarkowane — logowanie nie jest podłączone do serwera).
// Trzymamy tylko nick + zgodę marketingową lokalnie; służy do rankingu.

export interface Account {
  nick: string;
  /** zgoda na marketing / newsletter (zbierana przy rejestracji) */
  marketing: boolean;
  /** jak się "zalogował": email | apple | google */
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
  const a = getAccount() ?? { nick: "", marketing: false, method: "email" };
  a.nick = nick.trim().slice(0, 18);
  saveAccount(a);
}

export function nick(): string {
  return getAccount()?.nick || "Ty";
}
