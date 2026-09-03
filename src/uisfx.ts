// Dźwięki interfejsu (menu / przyciski) — cienka nakładka na silnik audio gry.
//
// Trzy klipy w `public/assets/ui/Sounds/`:
//   play.mp3    — wciśnięcie GRAJ
//   back.mp3    — cofnięcie (przycisk „wróć", systemowa strzałka wstecz)
//   buttons.mp3 — pozostałe przyciski UI (NIE tapnięcia w rozgrywce; menu pauzy TAK)
//
// WAŻNE (iOS): gramy je przez TEN SAM AudioContext co muzykę. Wcześniejsza wersja
// używała HTMLAudioElement — na iOS Safari odtworzenie <audio> przełącza kategorię
// sesji audio i potrafiło przerwać WebAudio (muzyka utworu cichła zupełnie).

import type { AudioEngine, UiKind } from "./audio.ts";

let engine: AudioEngine | null = null;
let enabled = true;

/** Woła `Game` raz, zaraz po utworzeniu silnika audio. */
export function registerUiAudio(e: AudioEngine): void {
  engine = e;
}

export function uiSound(kind: UiKind): void {
  if (!enabled || !engine) return;
  engine.uiSfx(kind);
}

export function setUiSoundEnabled(on: boolean): void {
  enabled = on;
  engine?.setUiEnabled(on);
}
