// Wibracje (haptyka).
//
// Web: `navigator.vibrate` działa na Androidzie (Chrome) i desktopie z silnikiem.
// iOS Safari NIE wspiera wibracji z poziomu strony — tam haptyka ruszy dopiero
// w wersji natywnej (Capacitor + @capacitor/haptics). Wtedy podmieniamy tylko
// implementację `fire()` poniżej, reszta gry bez zmian.

export type Haptic =
  | "tick" // zwykłe trafienie
  | "perfect" // perfekcyjne trafienie — mikro-impuls
  | "miss" // pudło
  | "hold" // utrzymana nuta trzymana
  | "holdTick" // puls w trakcie trzymania
  | "combo" // próg combo (co 10)
  | "flowUp" // wejście na wyższy mnożnik — mocna wibracja całego telefonu
  | "fail"; // koniec / brak życia

const PATTERNS: Record<Haptic, number | number[]> = {
  tick: 8,
  perfect: 14,
  miss: [0, 35, 25, 35],
  hold: 22,
  holdTick: 6,
  combo: [0, 22, 18, 22, 18, 22],
  flowUp: [0, 70, 45, 110, 45, 70],
  fail: [0, 120, 60, 120],
};

const supported =
  typeof navigator !== "undefined" && typeof (navigator as Navigator).vibrate === "function";

let enabled = true;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
  if (!on && supported) {
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }
}

export function hapticsAvailable() {
  return supported;
}

export function fire(kind: Haptic) {
  if (!enabled || !supported) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* ignore */
  }
}
