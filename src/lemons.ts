// Cytryny — „magiczne składniki" ukryte w beatmapach innych rund.
//
// Każda cytryna to osobna nuta-znajdźka w charcie (`lemon: true` w edytorze).
// Leci jak zwykła nuta, ale nie daje ani nie odejmuje punktów i nie rusza combo.
// Złapana raz liczy się na zawsze. Zebrany komplet (LEMONS_NEEDED) + monety
// odblokowuje rundę bonusową Wódka Cytrynówka.
//
// Klucz cytryny: "<id utworu>@<sekunda, 2 miejsca>" — stabilny między buildami,
// dopóki cytryna nie zostanie przesunięta w edytorze.
//
// Serwer (users.lemons) trzyma sumę zbiorów, localStorage to cache do pracy
// offline. Scalanie zawsze jako suma — cytryn nigdy nie ubywa.

import { api, getToken } from "./net.ts";

const KEY = "denis.lemons";

/** Runda odblokowywana cytrynami. */
export const LEMON_ROUND = "wodka-cytrynowka";
/** Ile cytryn trzeba zebrać (musi zgadzać się z api/account.ts). */
export const LEMONS_NEEDED = 5;

export function lemonKey(songId: string, time: number): string {
  return `${songId}@${time.toFixed(2)}`;
}

export function lemonSet(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function save(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export function lemonCount(): number {
  return lemonSet().size;
}

export function hasLemon(key: string): boolean {
  return lemonSet().has(key);
}

/** Dopisuje cytryny z tej rundy lokalnie i (gdy zalogowany) na serwerze. */
export function addLemons(keys: string[]): void {
  const s = lemonSet();
  for (const k of keys) s.add(k);
  save(s);
  void syncLemons();
}

/** Scala listę z serwera (suma) i odsyła lokalne, których serwer jeszcze nie ma. */
export function mergeServerLemons(list: unknown): void {
  if (!Array.isArray(list)) return;
  const s = lemonSet();
  const server = new Set(list.map(String));
  let missingOnServer = false;
  for (const k of s) if (!server.has(k)) missingOnServer = true;
  for (const k of server) s.add(k);
  save(s);
  if (missingOnServer) void syncLemons();
}

/** Wysyła lokalne cytryny na serwer (suma) i bierze z powrotem pełną listę. */
export async function syncLemons(): Promise<void> {
  if (!getToken()) return;
  try {
    const r = await api<{ lemons?: string[] }>("/api/account", {
      method: "POST",
      body: { action: "lemons", keys: [...lemonSet()] },
      auth: true,
    });
    if (Array.isArray(r.lemons)) {
      const s = lemonSet();
      for (const k of r.lemons) s.add(String(k));
      save(s);
    }
  } catch {
    /* offline — wyślemy przy następnej synchronizacji (mergeServerLemons) */
  }
}
