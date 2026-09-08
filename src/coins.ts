// Monety — waluta zbierana za wynik w rundach. Za każde pełne 10 000 pkt =
// 1 moneta (bez połówek: 9 999 pkt = 0 monet).
//
// Serwer jest ŹRÓDŁEM PRAWDY (monety są wydawane, nie tylko rosną). localStorage
// to tylko cache do natychmiastowego UI i pracy offline — nadpisywany przy każdej
// synchronizacji z `/api/auth/me` oraz odpowiedzi z `/api/scores` / `/api/account`.

const KEY = "denis.coins";
const UNLOCK_KEY = "denis.unlocked";
const PER_COIN = 10_000;

/** Ile monet kosztuje odblokowanie danego poziomu (musi zgadzać się z api/account.ts). */
export const UNLOCK_COST: Record<string, number> = { pogrzebowka: 200 };

export function coins(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

function setCoins(n: number) {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.floor(n))));
  } catch {
    /* ignore */
  }
}

/** Dopisuje monety lokalnie (optymistycznie po rundzie). Serwer skoryguje. */
export function addCoins(n: number): number {
  const t = coins() + Math.max(0, Math.floor(n));
  setCoins(t);
  return t;
}

/** Nadpisuje lokalny stan monet wartością z serwera (autorytatywną). */
export function applyServerCoins(n: unknown): void {
  if (typeof n === "number" && Number.isFinite(n)) setCoins(n);
}

// ---- odblokowania za monety ----------------------------------------------

export function unlockedSet(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(UNLOCK_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

export function isUnlocked(id: string): boolean {
  return unlockedSet().has(id);
}

export function addUnlockedLocal(id: string): void {
  const s = unlockedSet();
  if (s.has(id)) return;
  s.add(id);
  try {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Nadpisuje listę odblokowanych wartością z serwera (autorytatywną). */
export function applyServerUnlocked(list: unknown): void {
  if (!Array.isArray(list)) return;
  try {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify(list.map(String)));
  } catch {
    /* ignore */
  }
}

// ---- pomocnicze ---------------------------------------------------------

/** Ile monet za dany wynik punktowy (pełne dziesiątki tysięcy, bez zaokrągleń w górę). */
export function coinsFromScore(score: number): number {
  return Math.floor(Math.max(0, score) / PER_COIN);
}

/** Skrót liczby: 80 → "80", 1000 → "1k", 1500 → "1,5k", 12 000 → "12k", 1 000 000 → "1M". */
export function fmtCoins(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return short(n / 1000) + "k";
  return short(n / 1_000_000) + "M";
}
function short(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
}

/** Pełny zapis z separatorem tysięcy: 1000 → "1 000". */
export function fmtCoinsFull(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Odmiana: 1 monetę / 2–4 monety / 5+ monet. */
export function monetyWord(n: number): string {
  if (n === 1) return "monetę";
  const d = n % 10;
  const dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return "monety";
  return "monet";
}
