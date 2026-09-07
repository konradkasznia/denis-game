// Monety — waluta zbierana za wynik w rundach. Za każde pełne 10 000 pkt =
// 1 moneta (bez połówek: 9 999 pkt = 0 monet). Na razie tylko localStorage;
// docelowo do zsynchronizowania z kontem (patrz TODO.md).

const KEY = "denis.coins";
const PER_COIN = 10_000;

export function coins(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

export function addCoins(n: number): number {
  const total = coins() + Math.max(0, Math.floor(n));
  try {
    localStorage.setItem(KEY, String(total));
  } catch {
    /* ignore */
  }
  return total;
}

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

/** Odmiana: 1 monetę / 2–4 monety / 5+ monet. */
export function monetyWord(n: number): string {
  if (n === 1) return "monetę";
  const d = n % 10;
  const dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return "monety";
  return "monet";
}
