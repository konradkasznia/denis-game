// Ranking wyników — per piosenka, dwie zakładki: „ten miesiąc" / „wszystkie".
//
// Źródło prawdy: backend (/api/scores). Trzymamy lokalną kopię ostatnio pobranej
// tablicy oraz najlepszy wynik gracza (żeby UI działało natychmiast i offline).
// „Boty" (deterministyczny ogon stawki) dokładamy tylko jako wypełnienie, gdy
// realnych wyników jest mało — żeby tablica nie świeciła pustką.

import { nick as myNick } from "./account.ts";
import { api, backendReachable, getToken } from "./net.ts";

export type Period = "month" | "all";

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

/** Deterministyczna „reszta stawki" (wypełniacz). Zakładka „ten miesiąc" ma
 *  mniej wpisów i niższe wyniki niż „wszystkie". */
function fakeBoard(songId: string, period: Period): { nick: string; score: number }[] {
  const rng = mulberry32(hashStr(`board:${period}:${songId}`));
  const n = period === "month" ? 70 : 180;
  const cap = period === "month" ? 620000 : 920000;
  const base = period === "month" ? 30000 : 45000;
  const rows: { nick: string; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    const score = base + Math.floor(Math.pow(rng(), 1.9) * cap);
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

/** Najlepszy wynik gracza w tej piosence (all-time, lokalny cache). */
export function myBest(songId: string): number | null {
  const v = Number(localStorage.getItem(keyFor(songId)));
  return v > 0 ? v : null;
}

/** Scala najlepsze wyniki z serwera (z /api/auth/me) do lokalnego cache —
 *  bierze wyższy wynik per utwór. Uzupełnia mergeServerStars przy odtwarzaniu
 *  postępu po wyczyszczeniu localStorage. */
export function mergeServerBest(server: Record<string, { score?: number }>): void {
  for (const [id, v] of Object.entries(server || {})) {
    const s = Math.max(0, Math.floor(v?.score ?? 0));
    if (s > (myBest(id) ?? 0)) {
      try {
        localStorage.setItem(keyFor(id), String(s));
      } catch {
        /* ignore */
      }
    }
  }
}

// ---- kopia z serwera --------------------------------------------

interface RemoteBoard {
  top: { nick: string; score: number; me?: boolean }[];
  me: { rank: number; score: number } | null;
  total: number;
}
const remote = new Map<string, RemoteBoard>();
const rkey = (songId: string, period: Period) => `${period}::${songId}`;

/** Pobiera aktualną tablicę utworu (dla danej zakładki) z serwera do cache. */
export async function refreshBoard(songId: string, period: Period = "all"): Promise<void> {
  if (!backendReachable()) return;
  try {
    const r = await api<RemoteBoard>(
      `/api/scores?songId=${encodeURIComponent(songId)}&period=${period}`,
      getToken() ? { auth: true } : {},
    );
    remote.set(rkey(songId, period), { top: r.top || [], me: r.me ?? null, total: r.total || 0 });
  } catch {
    /* zostaje ostatnia znana kopia / sam wypełniacz */
  }
}

async function postScore(songId: string, score: number, stars: number) {
  if (!backendReachable() || !getToken()) return;
  try {
    await api("/api/scores", { method: "POST", body: { songId, score, stars }, auth: true });
    await Promise.all([refreshBoard(songId, "all"), refreshBoard(songId, "month")]);
  } catch {
    /* wynik jest zapisany lokalnie; zsynchronizuje się przy następnej okazji */
  }
}

// ---- budowa widoku tablicy ------------------------------------

function fullBoard(songId: string, period: Period): Entry[] {
  const rb = remote.get(rkey(songId, period));
  const list: { nick: string; score: number; me?: boolean }[] = [];

  if (rb && rb.top.length) {
    for (const e of rb.top) list.push({ nick: e.nick, score: e.score, me: e.me });
    const floor = rb.top[rb.top.length - 1]?.score ?? 0;
    for (const f of fakeBoard(songId, period)) if (f.score < floor) list.push(f);
  } else {
    for (const f of fakeBoard(songId, period)) list.push(f);
  }

  // „ja" w zakładce all-time bierzemy też z lokalnego rekordu (działa offline);
  // w zakładce miesięcznej — tylko z serwera
  const hasMe = list.some((e) => e.me);
  if (!hasMe && period === "all") {
    const mineLocal = myBest(songId);
    if (mineLocal != null) list.push({ nick: myNick(), score: mineLocal, me: true });
  }

  list.sort((a, b) => b.score - a.score);
  return list.map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Zapisuje wynik gracza (trzyma najlepszy) i wysyła na serwer. Zwraca miejsce (all-time). */
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
  return rankOf(songId, "all");
}

export function topN(songId: string, period: Period, n = 10): Entry[] {
  return fullBoard(songId, period).slice(0, n);
}

export function rankOf(songId: string, period: Period): number {
  const rb = remote.get(rkey(songId, period));
  if (rb?.me) return rb.me.rank;
  const b = fullBoard(songId, period);
  const me = b.find((e) => e.me);
  return me ? me.rank : b.length + 1;
}

/** Wpis gracza (z miejscem) albo null, gdy nie ma jeszcze wyniku w tej zakładce. */
export function myEntry(songId: string, period: Period): Entry | null {
  const inList = fullBoard(songId, period).find((e) => e.me);
  if (inList) return inList;
  const rb = remote.get(rkey(songId, period));
  if (rb?.me) return { rank: rb.me.rank, nick: myNick(), score: rb.me.score, me: true };
  return null;
}

/** Ile punktów brakuje graczowi do TOP `n` (0 = już w top). */
export function gapToTop(songId: string, period: Period, n = 10): number {
  const b = fullBoard(songId, period);
  const me = b.find((e) => e.me);
  if (!me || me.rank <= n) return 0;
  const cut = b[n - 1]?.score ?? 0;
  return Math.max(0, cut - me.score + 1);
}
