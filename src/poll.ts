// Głosowania w apce (np. „jaki poziom 6?").
//
// Głos leci do backendu (`/api/vote` → Turso) best-effort oraz jako tag do
// OneSignal (segmentacja wysyłek). Lokalnie zapamiętujemy wybór, żeby nie
// pytać drugi raz.

import { api } from "./net.ts";
import { tagOneSignal } from "./push.ts";

export interface PollOption {
  id: string;
  label: string;
}

export const POLL_LEVEL6 = "poziom6";
export const POLL_LEVEL6_OPTIONS: PollOption[] = [
  { id: "pan-mlody", label: "Pan Młody" },
  { id: "pan-mechanik", label: "Pan Mechanik" },
  { id: "wodka-cytrynowka", label: "Wódka Cytrynówka" },
  { id: "skacz-baw-pij", label: "Skacz, Baw, Pij!" },
  { id: "krol-latino", label: "Król Latino" },
];

const key = (poll: string) => `denis.vote.${poll}`;

export function votedChoice(poll: string): string | null {
  try {
    return localStorage.getItem(key(poll));
  } catch {
    return null;
  }
}

function markVoted(poll: string, choice: string): void {
  try {
    localStorage.setItem(key(poll), choice || "1");
  } catch {
    /* ignore */
  }
}

export function submitVote(poll: string, choice: string): void {
  markVoted(poll, choice);
  tagOneSignal(`wybor_${poll}`, choice);
  // auth: głos jest wiązany z kontem (jeden na użytkownika, wymuszane serwerowo)
  void api("/api/vote", { method: "POST", body: { poll, choice }, auth: true }).catch(() => {
    /* offline / brak backendu — mamy przynajmniej tag OneSignal + localStorage */
  });
}

/** Dociąga z serwera „czy ten użytkownik już głosował" i zapisuje lokalnie —
 *  dzięki temu modal nie wróci nawet po wyczyszczeniu danych aplikacji /
 *  na innym urządzeniu tego samego konta. Bezpieczne do wołania w tle. */
export async function syncVoted(poll: string): Promise<void> {
  if (votedChoice(poll)) return;
  try {
    const r = await api<{ voted?: boolean; choice?: string | null }>(
      `/api/vote?poll=${encodeURIComponent(poll)}`,
      { auth: true },
    );
    if (r?.voted) markVoted(poll, r.choice || "1");
  } catch {
    /* offline / brak backendu — trudno, zostaje gate lokalny */
  }
}
