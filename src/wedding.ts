// Wesele — runda bonusowa „Pan Młody" (tylko z zaproszeniem) i „Wesele trwa".
//
// - Zaproszenie: serwer dopisuje "pan-mlody" do listy odblokowanych (api/invite.ts),
//   klient dostaje ją razem z monetami (applyServerUnlocked) i pokazuje modal
//   „Otrzymałeś zaproszenie weselne" (raz na urządzenie).
// - Garnitury: kupowane za monety jak poziomy ("garnitur-1", "garnitur-2" w
//   UNLOCK_COST). Który jest „założony" — lokalny wybór gracza (kosmetyka).
// - Koperta: przed rundą gracz wkłada monety (przepadają). Jednorazowo min.
//   ENVELOPE_MIN odblokowuje „Wesele trwa" (serwer, akcja "envelope").
//
// Bez DOM — importowane też przez tracks.ts (testy w Node).

import { isUnlocked, UNLOCK_COST } from "./coins.ts";

export const WEDDING = "pan-mlody";
export const WEDDING_AFTER = "wesele-trwa";
export const ENVELOPE_MIN = 1000;
export const ENVELOPE_STEP = 100;

export interface Suit {
  id: string;
  name: string;
  /** kolor marynarki (zastępcza grafika, dopóki nie ma PNG/animacji) */
  color: string;
  lapel: string;
  tie: string;
}

export const SUITS: Suit[] = [
  { id: "garnitur-1", name: "CZARNY", color: "#1f1d28", lapel: "#0f0e15", tie: "#c0182c" },
  { id: "garnitur-2", name: "BIAŁY", color: "#f1ece0", lapel: "#d9cfb8", tie: "#d4a017" },
];

export function suitPrice(id: string): number {
  return UNLOCK_COST[id] ?? 0;
}

export function invited(): boolean {
  return isUnlocked(WEDDING);
}

const WORN_KEY = "denis.suit";

/** Założony garnitur (tylko kupiony), albo null = Denis w bokserkach. */
export function wornSuit(): string | null {
  let id = "";
  try {
    id = localStorage.getItem(WORN_KEY) || "";
  } catch {
    /* ignore */
  }
  if (id && isUnlocked(id)) return id;
  // nic nie wybrano, ale coś kupione → pierwszy kupiony
  return SUITS.find((s) => isUnlocked(s.id))?.id ?? null;
}

export function wearSuit(id: string): void {
  try {
    localStorage.setItem(WORN_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Ujęcia postaci w rundzie zależą od garnituru: chart z edytora ma ścieżki
 *  "assets/char/pan-mlody/ujecieN" → w grze "assets/char/pan-mlody/<garnitur>/ujecieN"
 *  (po 3 ujęcia na garnitur). Stary format (cały folder bez ujęć) zostaje bez zmian. */
export function outfitSprite(sprite: string): string {
  const suit = wornSuit();
  const m = sprite.match(/^assets\/char\/pan-mlody\/(ujecie\d+)$/);
  if (!suit || !m) return sprite;
  return `assets/char/pan-mlody/${suit}/${m[1]}`;
}

const INVITE_SEEN_KEY = "denis.invite.seen";

export function inviteSeen(): boolean {
  try {
    return localStorage.getItem(INVITE_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markInviteSeen(): void {
  try {
    localStorage.setItem(INVITE_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}
