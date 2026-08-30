// Wejście: dotyk (multi-touch) / mysz / klawiatura → zdarzenia press / release
// w układzie gry. Śledzimy wciśnięcia, żeby obsłużyć nuty trzymane.

import { toGame } from "./viewport.ts";

export interface InputHandlers {
  /** x/y w układzie gry; lane = -1 gdy poza polem gry (menu/wynik) */
  onPress: (lane: number, x: number, y: number) => void;
  onRelease: (lane: number) => void;
  /** który tor odpowiada współrzędnej x (albo -1) */
  laneAt: (x: number) => number;
}

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

export function initInput(canvas: HTMLCanvasElement, h: InputHandlers) {
  const pointerLane = new Map<number, number>();
  const keyLane = new Map<string, number>();

  canvas.addEventListener(
    "pointerdown",
    (ev) => {
      ev.preventDefault();
      const p = toGame(ev.clientX, ev.clientY, canvas);
      const lane = h.laneAt(p.x);
      pointerLane.set(ev.pointerId, lane);
      h.onPress(lane, p.x, p.y);
    },
    { passive: false },
  );

  const endPointer = (ev: PointerEvent) => {
    if (!pointerLane.has(ev.pointerId)) return;
    const lane = pointerLane.get(ev.pointerId)!;
    pointerLane.delete(ev.pointerId);
    if (lane >= 0) h.onRelease(lane);
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  window.addEventListener("blur", () => {
    for (const lane of pointerLane.values()) if (lane >= 0) h.onRelease(lane);
    pointerLane.clear();
    for (const lane of keyLane.values()) h.onRelease(lane);
    keyLane.clear();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.repeat) return;
    const lane = LANE_KEYS[ev.code];
    if (lane === undefined) {
      if (ev.code === "Space" || ev.code === "Enter") h.onPress(-1, -1, -1);
      return;
    }
    if (keyLane.has(ev.code)) return;
    keyLane.set(ev.code, lane);
    h.onPress(lane, -1, -1);
  });

  window.addEventListener("keyup", (ev) => {
    const lane = keyLane.get(ev.code);
    if (lane === undefined) return;
    keyLane.delete(ev.code);
    h.onRelease(lane);
  });
}
