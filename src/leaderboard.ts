// Ranking wyników — per piosenka.
//
// Źródło prawdy: backend (/api/scores). Trzymamy lokalną kopię ostatnio pobranej
// tablicy oraz najlepszy wynik gracza (żeby UI działało natychmiast i offline).
// „Boty" (deterministyczny ogon stawki) dokładamy tylko jako wypełnienie, gdy
// realnych wyników dla utworu jest mało — dzięki temu tablica nie świeci pustką.

import { nick as myNick } from "./account.ts";
import { api, backendReachable, getToken } from "./net.ts";

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
  "Kasia_88", "DJ_Bartek", "Ola2000", "kamil.pl", "WeselnyKról", "monika_r", "Piotrek",
  "aniaaa", "grzesiek_w", "NikaXO", "MłodaPara", "tomek1993", "sylwia.k", "MarekG",
  "dominika_", "krzychu", "julka_2010", "Rafał", "patka", "SzymonB", "gosia_m",
  "adrian.p", "weronika", "MateuszK", "iza_w", "ЯArek", "kinga_", "DawidM", "natalia88",
  "hubert.pl", "ewelina_", "ЯBartosz", "magda_z", "ЯKuba", "ola.nowak", "Filip",
  "karolina_k", "Wojtek99", "asia_p", "MichałW",
];

/** Deterministyczna „reszta stawki" dla danej piosenki (wypełniacz). */
function fakeBoard(songId: string, n = 180): { nick: string; score: number }[] {
  const rng = mulberry32(hashStr("board:" + songId));
  const rows: { nick: string; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    const score = 45000 + Math.floor(Math.pow(rng(), 1.9) * 920000);
    const name =
      NICKS[Math.floor(rng() * NICKS.length)] +
      (rng() < 0.25 ? String(Math.floor(rng() * 90) + 10) : "");
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

// ---- kopia z serwera --------------------------------------------

interface RemoteBoard {
  top: { nick: string; score: number; me?: boolean }[];
  me: { rank: number; score: number } | null;
  total: number;
}
const remote = new Map<string, RemoteBoard>();

/** Pobiera aktualną tablicę utworu z serwera do lokalnej kopii. */
export async function refreshBoard(songId: string): Promise<void> {
  if (!backendReachable()) return;
  try {
    const r = await api<RemoteBoard>(
      `/api/scores?songId=${encodeURIComponent(songId)}`,
      getToken() ? { auth: true } : {},
    );
    remote.set(songId, { top: r.top || [], me: r.me ?? null, total: r.total || 0 });
  } catch {
    /* zostaje ostatnia znana kopia / sam wypełniacz */
  }
}

async function postScore(songId: string, score: number, stars: number) {
  if (!backendReachable() || !getToken()) return;
  try {
    await api("/api/scores", { method: "POST", body: { songId, score, stars }, auth: true });
    await refreshBoard(songId);
  } catch {
    /* wynik jest zapisany lokalnie; zsynchronizuje się przy następnej okazji */
  }
}

// ---- budowa widoku tablicy ------------------------------------

function fullBoard(songId: string): Entry[] {
  const rb = remote.get(songId);
  const mineLocal = myBest(songId);
  const list: { nick: string; score: number; me?: boolean }[] = [];

  if (rb && rb.top.length) {
    for (const e of rb.top) list.push({ nick: e.nick, score: e.score, me: e.me });
    // wypełnij ogon botami z wynikiem niższym niż najniższy realny
    const floor = rb.top[rb.top.length - 1]?.score ?? 0;
    for (const f of fakeBoard(songId)) if (f.score < floor) list.push(f);
  } else {
    for (const f of fakeBoard(songId)) list.push(f);
  }

  const hasMe = list.some((e) => e.me);
  if (!hasMe && mineLocal != null) list.push({ nick: myNick(), score: mineLocal, me: true });

  list.sort((a, b) => b.score - a.score);
  return list.map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Zapisuje wynik gracza (trzyma najlepszy) i wysyła na serwer. Zwraca miejsce. */
export function submitScore(songId: string, score: number, stars = 0): number {
  const prev = myBest(songId) ?? 0;
  if (score > prev) {
    try {
      localStorage.setItem(keyFor(songId), String(score));
    } catch {
      /* ignore */
    }
  }
  void postScore(songId, Math.max(score, prev), stars);
  return rankOf(songId);
}

export function topN(songId: string, n = 10): Entry[] {
  return fullBoard(songId).slice(0, n);
}

export function rankOf(songId: string): number {
  const rb = remote.get(songId);
  if (rb?.me) return rb.me.rank;
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
