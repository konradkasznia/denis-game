// Czysta logika oceny trafień — bez zależności od canvasu/audio, łatwa do testów.

import type { Note } from "./chart.ts";

export type Judgement = "perfect" | "great" | "good" | "miss";

// okna oceny w sekundach (odległość trafienia od idealnego czasu nuty)
export const W_PERFECT = 0.05;
export const W_GREAT = 0.1;
export const W_GOOD = 0.145;

export const SCORE: Record<Judgement, number> = {
  perfect: 300,
  great: 200,
  good: 100,
  miss: 0,
};

export const ACC_WEIGHT: Record<Judgement, number> = {
  perfect: 1,
  great: 0.65,
  good: 0.3,
  miss: 0,
};

/** Zamienia odległość czasową |Δt| na ocenę, albo null gdy poza oknem GOOD. */
export function classify(absDt: number): Exclude<Judgement, "miss"> | null {
  if (absDt > W_GOOD) return null;
  if (absDt <= W_PERFECT) return "perfect";
  if (absDt <= W_GREAT) return "great";
  return "good";
}

/** Mnożnik punktów od długości combo (1.0 → 2.0 przy 50+). */
export function comboMultiplier(combo: number): number {
  return 1 + Math.min(combo, 50) / 50;
}

/**
 * Wybiera nieocenioną nutę w danym torze najbliższą momentowi stuknięcia,
 * o ile mieści się w oknie GOOD. `offsetSec` to kalibracja opóźnienia dźwięku.
 */
export function pickNote(
  notes: Note[],
  lane: number,
  inputTime: number,
  offsetSec: number,
): { note: Note; absDt: number } | null {
  let best: Note | null = null;
  let bestAbs = Infinity;
  for (const n of notes) {
    if (n.judged || n.lane !== lane) continue;
    const absDt = Math.abs(inputTime - n.time - offsetSec);
    if (absDt <= W_GOOD && absDt < bestAbs) {
      best = n;
      bestAbs = absDt;
    }
  }
  return best ? { note: best, absDt: bestAbs } : null;
}

/** Czy nieoceniona nuta powinna już zostać uznana za pudło. */
export function isMissed(note: Note, songTime: number, offsetSec: number): boolean {
  return !note.judged && songTime - note.time - offsetSec > W_GOOD;
}
