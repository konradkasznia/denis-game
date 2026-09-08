// Głośność multimediów — tylko natywny Android (plugin `VolumePlugin.java`).
// Na iOS/web `volumeGateActive` = false i wszystko jest no-op / „jest dźwięk".
//
// Po co: gra reaguje na muzykę, więc na Androidzie chcemy wymusić włączony
// dźwięk. Modal „WŁĄCZ DŹWIĘK" pokazuje się tylko gdy telefon jest wyciszony,
// a jego przycisk podkręca głośność do 50%.

import { registerPlugin } from "@capacitor/core";
import { platform } from "./native.ts";

interface VolumePlugin {
  get(): Promise<{ level: number; muted: boolean }>;
  setLevel(opts: { level: number }): Promise<{ level: number }>;
}

const Volume = registerPlugin<VolumePlugin>("Volume");

/** Czy w ogóle pilnujemy głośności (tylko natywny Android). */
export const volumeGateActive = platform === "android";

let lastLevel = 1; // 0..1 — ostatni odczyt (1 = zakładamy „jest dźwięk")

/** Odświeża odczyt głośności i zwraca poziom 0..1 (na nie-Androidzie: 1). */
export async function refreshVolume(): Promise<number> {
  if (!volumeGateActive) return 1;
  try {
    lastLevel = (await Volume.get()).level;
  } catch {
    lastLevel = 1; // nie udało się odczytać — nie blokujemy gracza
  }
  return lastLevel;
}

/** Ostatnio odczytany poziom (bez zapytania do natywnej strony). */
export function volumeLevel(): number {
  return lastLevel;
}

/** Czy telefon jest wyciszony wg ostatniego odczytu (Android). */
export function isMuted(): boolean {
  return volumeGateActive && lastLevel <= 0;
}

/** Podkręca głośność multimediów (domyślnie 50%) + pokazuje systemowy suwak. */
export async function bumpVolume(level = 0.5): Promise<number> {
  if (!volumeGateActive) return 1;
  try {
    lastLevel = (await Volume.setLevel({ level })).level;
  } catch {
    /* brak uprawnień / DND — zostaje jak było */
  }
  return lastLevel;
}
