// Pociąg weselny: 5 darmowych gier na konto, każda kolejna kosztuje 15 monet.
// Serwer jest źródłem prawdy (api/account.ts, akcja "trainPlay" — atomowo zabiera
// monety i nabija licznik). Tu tylko podręczna kopia licznika do napisu na przycisku.

import { api, backendReachable, getToken } from "./net.ts";
import { applyServerCoins, coins } from "./coins.ts";

export const TRAIN_FREE_PLAYS = 5;
export const TRAIN_PLAY_COST = 15;
const KEY = "denis.trainPlays";

export function trainPlays(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}
function setTrainPlays(n: number) {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.floor(n))));
  } catch {
    /* ignore */
  }
}
/** Liczba rozegranych gier z /api/auth/me (serwer wygrywa z lokalną kopią). */
export function applyServerTrainPlays(n: unknown): void {
  const v = Number(n);
  if (Number.isFinite(v) && v >= 0) setTrainPlays(v);
}

export function trainFreeLeft(): number {
  return Math.max(0, TRAIN_FREE_PLAYS - trainPlays());
}

/** Napis na przycisku startu rundy. */
export function trainPlayLabel(): string {
  const n = trainFreeLeft();
  if (n >= 5) return "MASZ 5 DARMOWYCH GIER!";
  if (n >= 2) return `MASZ ${n} DARMOWE GRY!`;
  if (n === 1) return "MASZ 1 DARMOWĄ GRĘ!";
  return `1 GRA - ${TRAIN_PLAY_COST} MONET`;
}

/** „zostały Ci 4 darmowe próby" (odmiana). */
export function trainFreeLeftText(n: number): string {
  if (n === 1) return "została Ci 1 darmowa próba";
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? `zostały Ci ${n} darmowe próby` : `zostało Ci ${n} darmowych prób`;
}

// samouczek przed pierwszą grą (per konto — znika przy wylogowaniu jak inne dane konta)
const TUT_KEY = "denis.trainTut";
export function trainTutSeen(): boolean {
  try {
    return localStorage.getItem(TUT_KEY) === "1";
  } catch {
    return false;
  }
}
export function markTrainTutSeen(): void {
  try {
    localStorage.setItem(TUT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export type PayResult = { ok: true } | { ok: false; reason: "coins" | "net" };

/** Pobiera opłatę za jedną grę (albo zużywa darmową). */
export async function payTrainPlay(): Promise<PayResult> {
  if (trainFreeLeft() === 0 && coins() < TRAIN_PLAY_COST) return { ok: false, reason: "coins" };
  if (!backendReachable() || !getToken()) return { ok: false, reason: "net" };
  try {
    const r = await api<{ ok?: boolean; coins?: number; trainPlays?: number }>("/api/account", {
      method: "POST",
      body: { action: "trainPlay" },
      auth: true,
    });
    applyServerCoins(r.coins);
    applyServerTrainPlays(r.trainPlays);
    return { ok: true };
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return { ok: false, reason: status === 402 ? "coins" : "net" };
  }
}
