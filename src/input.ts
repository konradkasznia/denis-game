// Wejście: dotyk / mysz / klawiatura → zdarzenia w układzie gry.

import { toGame } from "./viewport.ts";

export interface TapEvent {
  x: number;
  y: number;
  /** ustawiane dla wejścia klawiaturą (0..LANES-1), inaczej -1 */
  lane: number;
}

type TapHandler = (e: TapEvent) => void;

const LANE_KEYS: Record<string, number> = {
  KeyD: 0,
  KeyF: 1,
  KeyJ: 2,
  KeyK: 3,
  ArrowLeft: 0,
  ArrowUp: 1,
  ArrowDown: 2,
  ArrowRight: 3,
};

export function initInput(canvas: HTMLCanvasElement, onTap: TapHandler) {
  const heldKeys = new Set<string>();

  canvas.addEventListener(
    "pointerdown",
    (ev) => {
      ev.preventDefault();
      const p = toGame(ev.clientX, ev.clientY, canvas);
      onTap({ x: p.x, y: p.y, lane: -1 });
    },
    { passive: false },
  );

  window.addEventListener("keydown", (ev) => {
    if (ev.repeat) return;
    const lane = LANE_KEYS[ev.code];
    if (lane === undefined) {
      if (ev.code === "Space" || ev.code === "Enter") onTap({ x: -1, y: -1, lane: -1 });
      return;
    }
    if (heldKeys.has(ev.code)) return;
    heldKeys.add(ev.code);
    onTap({ x: -1, y: -1, lane });
  });

  window.addEventListener("keyup", (ev) => heldKeys.delete(ev.code));
}
