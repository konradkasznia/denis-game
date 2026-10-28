// Pojedynki 1 na 1 („Rzuć wyzwanie znajomym") — klient API (serwer: api/_lib/duels.ts,
// pod /api/scores?duels=…). Stan trzymamy tu, ekrany rysuje game.ts.

import { api, backendReachable, getToken } from "./net.ts";

export interface DuelIncoming {
  id: number;
  opp: string;
  createdAt: string;
}
export type DuelResultKind = "won" | "lost" | "draw" | "waiting" | "oppDeclined" | "iDeclined" | "oppExpired" | "iExpired";
export interface DuelResult {
  id: number;
  opp: string;
  myScore: number | null;
  oppScore: number | null;
  result: DuelResultKind;
  at: string;
}
export interface DuelRankRow {
  rank: number;
  nick: string;
  wins: number;
  losses: number;
  best: number;
  me: boolean;
}

export const duelState = {
  loaded: false,
  incoming: [] as DuelIncoming[],
  results: [] as DuelResult[],
  rank: [] as DuelRankRow[],
  rankLoaded: false,
  lastFetch: 0,
};

const Q = "/api/scores?duels=";

/** Lista moich pojedynków (co najwyżej raz na 20 s, chyba że `force`). */
export async function refreshDuels(force = false): Promise<void> {
  if (!backendReachable() || !getToken()) return;
  if (!force && performance.now() - duelState.lastFetch < 20_000) return;
  duelState.lastFetch = performance.now();
  try {
    const r = await api<{ incoming?: DuelIncoming[]; results?: DuelResult[] }>(Q + "mine", { auth: true });
    duelState.incoming = r.incoming || [];
    duelState.results = r.results || [];
    duelState.loaded = true;
  } catch {
    /* offline — zostaje ostatnia lista */
  }
}

export async function refreshDuelRank(): Promise<void> {
  if (!backendReachable()) return;
  try {
    const r = await api<{ rows?: DuelRankRow[] }>(Q + "rank", { auth: true });
    duelState.rank = r.rows || [];
    duelState.rankLoaded = true;
  } catch {
    /* zostaje ostatnia lista */
  }
}

/** Czy ten nick da się wyzwać. Zwraca poprawną pisownię nicku albo komunikat błędu. */
export async function checkDuelNick(nick: string): Promise<{ ok: true; nick: string } | { ok: false; error: string }> {
  if (!backendReachable() || !getToken()) return { ok: false, error: "Do pojedynków potrzebny jest internet i zalogowane konto." };
  try {
    const r = await api<{ nick: string }>(Q + "check&nick=" + encodeURIComponent(nick.trim()), { auth: true });
    return { ok: true, nick: r.nick };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Brak połączenia. Spróbuj jeszcze raz." };
  }
}

export async function createDuel(nick: string, score: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(Q + "1", { method: "POST", body: { action: "create", nick, score }, auth: true });
    void refreshDuels(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Nie udało się wysłać wyzwania." };
  }
}

export async function answerDuel(id: number, score: number): Promise<{ ok: true; myScore: number; oppScore: number; result: "won" | "lost" | "draw" } | { ok: false; error: string }> {
  try {
    const r = await api<{ myScore: number; oppScore: number; result: "won" | "lost" | "draw" }>(Q + "1", {
      method: "POST",
      body: { action: "answer", id, score },
      auth: true,
    });
    void refreshDuels(true);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Nie udało się zapisać wyniku." };
  }
}

export async function declineDuel(id: number): Promise<boolean> {
  try {
    await api(Q + "1", { method: "POST", body: { action: "decline", id }, auth: true });
    duelState.incoming = duelState.incoming.filter((d) => d.id !== id);
    void refreshDuels(true);
    return true;
  } catch {
    return false;
  }
}
