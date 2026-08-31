// Ranking wyników — per piosenka.
//
// Na razie: lista „innych graczy" jest generowana deterministycznie (ten sam
// zestaw dla danej piosenki), a wynik gracza dokładany lokalnie. Gdy wpłynie
// backend, podmieniamy `fakeBoard`/`myBest` na zapytania do API — reszta UI
// (top 10, „…", moje miejsce, ile do TOP 10) zostaje bez zmian.

import { nick as myNick } from "./account.ts";

export interface Entry {
  rank: number;
  nick: string;
  score: number;
  me?: boolean;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NICKS = [
  "Kasia_88",
  "DJ_Bartek",
  "Ola2000",
  "kamil.pl",
  "WeselnyKról",
  "monika_r",
  "Piotrek",
  "aniaaa",
  "grzesiek_w",
  "NikaXO",
  "MłodaPara",
  "tomek1993",
  "sylwia.k",
  "MarekG",
  "dominika_",
  "krzychu",
  "julka_2010",
  "Rafał",
  "patka",
  "SzymonB",
  "gosia_m",
  "adrian.p",
  "weronika",
  "MateuszK",
  "iza_w",
  "ЯArek",
  "kinga_",
  "DawidM",
  "natalia88",
  "hubert.pl",
  "ewelina_",
  "ЯBartosz",
  "magda_z",
  "ЯKuba",
  "ola.nowak",
  "Filip",
  "karolina_k",
  "Wojtek99",
  "asia_p",
  "MichałW",
];

/** Deterministyczna „reszta stawki" dla danej piosenki. */
function fakeBoard(songId: string, n = 180): { nick: string; score: number }[] {
  const rng = mulberry32(hashStr("board:" + songId));
  const rows: { nick: string; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    // rozkład skośny w dół: kilka bardzo wysokich, długi ogon niżej
    const score = 45000 + Math.floor(Math.pow(rng(), 1.9) * 920000);
    const name = NICKS[Math.floor(rng() * NICKS.length)] + (rng() < 0.25 ? String(Math.floor(rng() * 90) + 10) : "");
    rows.push({ nick: name, score });
  }
  return rows;
}

function keyFor(songId: string) {
  return `denis.board.${songId}`;
}

export function myBest(songId: string): number | null {
  const v = Number(localStorage.getItem(keyFor(songId)));
  return v > 0 ? v : null;
}

/** Zapisuje wynik gracza dla piosenki (trzyma najlepszy). Zwraca miejsce. */
export function submitScore(songId: string, score: number): number {
  const prev = myBest(songId) ?? 0;
  if (score > prev) {
    try {
      localStorage.setItem(keyFor(songId), String(score));
    } catch {
      /* ignore */
    }
  }
  return rankOf(songId);
}

function fullBoard(songId: string): Entry[] {
  const mine = myBest(songId);
  const list: { nick: string; score: number; me?: boolean }[] = fakeBoard(songId).slice();
  if (mine != null) list.push({ nick: myNick(), score: mine, me: true });
  list.sort((a, b) => b.score - a.score);
  return list.map((e, i) => ({ ...e, rank: i + 1 }));
}

export function topN(songId: string, n = 10): Entry[] {
  return fullBoard(songId).slice(0, n);
}

export function rankOf(songId: string): number {
  const b = fullBoard(songId);
  const me = b.find((e) => e.me);
  return me ? me.rank : b.length + 1;
}

/** Wpis gracza (z miejscem) albo null, gdy nie ma jeszcze wyniku. */
export function myEntry(songId: string): Entry | null {
  return fullBoard(songId).find((e) => e.me) ?? null;
}

/** Ile punktów brakuje graczowi do TOP `n` (0 = już w top). */
export function gapToTop(songId: string, n = 10): number {
  const b = fullBoard(songId);
  const me = b.find((e) => e.me);
  if (!me || me.rank <= n) return 0;
  const cut = b[n - 1]?.score ?? 0;
  return Math.max(0, cut - me.score + 1);
}
