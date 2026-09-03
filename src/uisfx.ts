// Dźwięki interfejsu (menu / przyciski) — osobne od silnika muzyki gry.
//
// Trzy klipy w `public/assets/ui/Sounds/`:
//   play.mp3    — wciśnięcie GRAJ
//   back.mp3    — cofnięcie (przycisk „wróć", systemowa strzałka wstecz)
//   buttons.mp3 — pozostałe przyciski UI (NIE tapnięcia w rozgrywce; menu pauzy TAK)
//
// Używamy HTMLAudioElement (a nie WebAudio) — dla krótkich dźwięków UI jest
// prostszy i nie walczy z AudioContextem gry. Pierwsze `play()` i tak leci
// w reakcji na dotknięcie, więc iOS je przepuszcza.

type UiKind = "play" | "back" | "buttons";

const clips = new Map<UiKind, HTMLAudioElement>();
let enabled = true;

function clip(kind: UiKind): HTMLAudioElement | null {
  let a = clips.get(kind);
  if (!a) {
    try {
      a = new Audio(`assets/ui/Sounds/${kind}.mp3`);
      a.preload = "auto";
      a.volume = 0.5;
      clips.set(kind, a);
    } catch {
      return null;
    }
  }
  return a;
}

export function uiSound(kind: UiKind): void {
  if (!enabled) return;
  const a = clip(kind);
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch(() => {
      /* zablokowane / jeszcze bez gestu — trudno */
    });
  } catch {
    /* ignore */
  }
}

export function setUiSoundEnabled(on: boolean): void {
  enabled = on;
}
