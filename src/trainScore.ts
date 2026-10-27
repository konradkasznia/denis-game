// Wynik rundy „Pociąg weselny" zapisany jako JEDNA liczba w zwykłym rankingu
// (tabela scores, sortowanie malejąco). Kolejność ważności:
//   1. długość pociągu (więcej gości = wyżej),
//   2. złapane flaszki (przy tej samej długości flaszka podnosi w rankingu),
//   3. czas osiągnięcia tej długości (szybciej = wyżej).
// score = len·1 000 000 + flaszki·10 000 + (9 999 − czas w dziesiątych sekundy)
// Ten sam wzór liczy serwer (api/scores.ts — TRAIN_SONG), klient tylko go odczytuje.

export const TRAIN_SONG = "pociag-weselny";

export interface TrainScore {
  len: number;
  flasks: number;
  timeMs: number;
}

export function encodeTrain(t: TrainScore): number {
  const len = Math.max(0, Math.min(999, Math.floor(t.len)));
  const flasks = Math.max(0, Math.min(99, Math.floor(t.flasks)));
  const tenths = Math.max(0, Math.min(9999, Math.round(t.timeMs / 100)));
  return len * 1_000_000 + flasks * 10_000 + (9999 - tenths);
}

export function decodeTrain(score: number): TrainScore {
  const s = Math.max(0, Math.floor(score));
  return {
    len: Math.floor(s / 1_000_000),
    flasks: Math.floor((s % 1_000_000) / 10_000),
    timeMs: (9999 - (s % 10_000)) * 100,
  };
}

/** „12 osób · 2 fl. · 0:41" — wiersz rankingu. */
export function formatTrain(score: number): string {
  const t = decodeTrain(score);
  const sec = Math.round(t.timeMs / 1000);
  const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return `${t.len} ${osob(t.len)} · ${t.flasks} fl. · ${time}`;
}

export function osob(n: number): string {
  if (n === 1) return "osoba";
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? "osoby" : "osób";
}

/** Gwiazdki na karuzeli wg długości pociągu. */
export function trainStars(len: number): number {
  return len >= 40 ? 5 : len >= 30 ? 4 : len >= 20 ? 3 : len >= 10 ? 2 : len >= 5 ? 1 : 0;
}
