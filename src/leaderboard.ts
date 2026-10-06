// Ranking wyników — per piosenka, dwie zakładki: „ten miesiąc" / „wszystkie".
//
// Źródło prawdy: backend (/api/scores). Trzymamy lokalną kopię ostatnio pobranej
// tablicy oraz najlepszy wynik gracza (żeby UI działało natychmiast i offline).

import { nick as myNick } from "./account.ts";
import { applyServerCoins } from "./coins.ts";
import { api, backendReachable, getToken } from "./net.ts";

export type Period = "month" | "all";

export interface Entry {
  rank: number;
  nick: string;
  score: number;
  me?: boolean;
}

function keyFor(songId: string) {
  return `denis.board.${songId}`;
}

// Jednorazowe skasowanie lokalnie zapamiętanych „moich najlepszych wyników" po
// realnym zerowaniu tablic na serwerze (zmiana beatmapy = inna maks. liczba
// punktów, stary rekord gracza jest nieporównywalny) — inaczej telefon i tak
// pokazywałby stary wynik z lokalnego cache'a, mimo pustej bazy. Podbij
// CURRENT_RESET_VERSION przy każdym kolejnym takim zerowaniu.
const RESET_VERSION_KEY = "denis.scoresResetV";
const CURRENT_RESET_VERSION = 1;
(function invalidateStaleLocalBests() {
  try {
    const stored = Number(localStorage.getItem(RESET_VERSION_KEY) || 0);
    if (stored >= CURRENT_RESET_VERSION) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("denis.board.")) localStorage.removeItem(k);
    }
    localStorage.setItem(RESET_VERSION_KEY, String(CURRENT_RESET_VERSION));
  } catch {
    /* ignore */
  }
})();

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

// Które zakładki mają już zakończone pierwsze pobranie (sukces LUB błąd) —
// dopóki trwa, UI pokazuje „wczytywanie" zamiast samego wypełniacza (boty),
// żeby prawdziwa lista nie „doskakiwała" po sekundzie.
const loaded = new Set<string>();
const inflight = new Set<string>();

/** Czy tablica jest gotowa do pokazania (mamy dane z serwera, backend jest
 *  nieosiągalny = od razu wypełniacz, albo pierwsze pobranie się zakończyło). */
export function boardReady(songId: string, period: Period): boolean {
  if (!backendReachable()) return true;
  return loaded.has(rkey(songId, period));
}

/** Pobiera aktualną tablicę utworu (dla danej zakładki) z serwera do cache. */
export async function refreshBoard(songId: string, period: Period = "all"): Promise<void> {
  if (!backendReachable()) return;
  const k = rkey(songId, period);
  if (inflight.has(k)) return;
  inflight.add(k);
  try {
    const r = await api<RemoteBoard>(
      `/api/scores?songId=${encodeURIComponent(songId)}&period=${period}`,
      getToken() ? { auth: true } : {},
    );
    remote.set(k, { top: r.top || [], me: r.me ?? null, total: r.total || 0 });
  } catch {
    /* zostaje ostatnia znana kopia / sam wypełniacz */
  } finally {
    inflight.delete(k);
    loaded.add(k);
  }
}

async function postScore(songId: string, score: number, stars: number) {
  if (!backendReachable() || !getToken()) return;
  try {
    const r = await api<{ coins?: number }>("/api/scores", {
      method: "POST",
      body: { songId, score, stars },
      auth: true,
    });
    applyServerCoins(r.coins); // serwer dopisał monety za ten przebieg — weź jego liczbę
    await Promise.all([refreshBoard(songId, "all"), refreshBoard(songId, "month")]);
  } catch {
    /* wynik jest zapisany lokalnie; zsynchronizuje się przy następnej okazji */
  }
}

// ---- budowa widoku tablicy ------------------------------------

function fullBoard(songId: string, period: Period): Entry[] {
  const rb = remote.get(rkey(songId, period));
  const list: { nick: string; score: number; me?: boolean }[] = [];
  if (rb) for (const e of rb.top) list.push({ nick: e.nick, score: e.score, me: e.me });

  // „ja" w zakładce all-time bierzemy też z lokalnego rekordu (działa offline);
  // w zakładce miesięcznej — tylko z serwera
  // Serwer zwraca tylko top 200 + własne miejsce osobno (`me`). Gdy gracz jest
  // poza top, NIE doklejamy go do listy: dostałby fałszywe miejsce 201 —
  // jego realne miejsce pokazuje myEntry() z `rb.me`.
  const hasMe = list.some((e) => e.me) || !!rb?.me;
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

/** Miejsce gracza wg SERWERA (liczone po samych prawdziwych graczach).
 *  `null` gdy tablica tego utworu nie została jeszcze pobrana z serwera. */
export function serverRank(songId: string, period: Period = "all"): number | null {
  const r = remote.get(rkey(songId, period))?.me?.rank;
  return typeof r === "number" && r > 0 ? r : null;
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
  const me = b.find((e) => e.me) ?? myEntry(songId, period); // spoza top 200: z `rb.me`
  if (!me || me.rank <= n) return 0;
  const cut = b[n - 1]?.score ?? 0;
  return Math.max(0, cut - me.score + 1);
}
