// Wibracje (haptyka).
//
// - Natywnie (Capacitor / Android): `@capacitor/haptics` — prawdziwy silnik
//   haptyczny (impact/notification), lepszy feel niż surowy `vibrate`.
// - Web: `navigator.vibrate` (Android Chrome / desktop z silnikiem).
//   iOS Safari nie wspiera wibracji z poziomu strony — tam zadziała dopiero
//   wersja natywna.

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "./native.ts";

export type Haptic =
  | "tick" // zwykłe trafienie
  | "perfect" // perfekcyjne trafienie — mikro-impuls
  | "miss" // pudło
  | "hold" // utrzymana nuta trzymana
  | "holdTick" // puls w trakcie trzymania
  | "combo" // próg combo (co 10)
  | "flowUp" // wejście na wyższy mnożnik — mocna wibracja
  | "fail"; // koniec / brak życia

// wzorce dla web (`navigator.vibrate`)
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

const webSupported =
  typeof navigator !== "undefined" && typeof (navigator as Navigator).vibrate === "function";

let enabled = true;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
  if (!on && webSupported) {
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }
}

export function hapticsAvailable() {
  return isNative || webSupported;
}

function fireNative(kind: Haptic) {
  const p =
    kind === "tick" || kind === "holdTick"
      ? Haptics.impact({ style: ImpactStyle.Light })
      : kind === "perfect" || kind === "hold"
        ? Haptics.impact({ style: ImpactStyle.Medium })
        : kind === "flowUp"
          ? Haptics.impact({ style: ImpactStyle.Heavy })
          : kind === "combo"
            ? Haptics.notification({ type: NotificationType.Success })
            : kind === "miss"
              ? Haptics.notification({ type: NotificationType.Warning })
              : Haptics.notification({ type: NotificationType.Error }); // fail
  void Promise.resolve(p).catch(() => {});
}

export function fire(kind: Haptic) {
  if (!enabled) return;
  if (isNative) {
    fireNative(kind);
    return;
  }
  if (!webSupported) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* ignore */
  }
}
