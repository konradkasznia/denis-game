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

export function submitVote(poll: string, choice: string): void {
  try {
    localStorage.setItem(key(poll), choice);
  } catch {
    /* ignore */
  }
  tagOneSignal(`wybor_${poll}`, choice);
  void api("/api/vote", { method: "POST", body: { poll, choice } }).catch(() => {
    /* offline / brak backendu — mamy przynajmniej tag OneSignal + localStorage */
  });
}
