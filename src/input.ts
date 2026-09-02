// Wejście: dotyk (multi-touch) / mysz / klawiatura → zdarzenia press / release
// w układzie gry. Śledzimy wciśnięcia, żeby obsłużyć nuty trzymane.

import { toGame } from "./viewport.ts";

export interface InputHandlers {
  /** x/y w układzie gry; lane = -1 gdy poza polem gry (menu/wynik) */
  onPress: (lane: number, x: number, y: number) => void;
  onRelease: (lane: number) => void;
  /** który tor odpowiada współrzędnej x (albo -1) */
  laneAt: (x: number) => number;
  /** przesunięcie palcem w bok: dir = +1 (w lewo → następny), -1 (w prawo → poprzedni) */
  onSwipe?: (dir: 1 | -1) => void;
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
  // śledzenie „przeciągnięcia palcem" (swipe) — pierwszy aktywny wskaźnik
  let swipe: { id: number; x0: number; y0: number; t0: number } | null = null;

  canvas.addEventListener(
    "pointerdown",
    (ev) => {
      ev.preventDefault();
      const p = toGame(ev.clientX, ev.clientY, canvas);
      const lane = h.laneAt(p.x);
      pointerLane.set(ev.pointerId, lane);
      if (swipe === null) swipe = { id: ev.pointerId, x0: p.x, y0: p.y, t0: performance.now() };
      h.onPress(lane, p.x, p.y);
    },
    { passive: false },
  );

  const endPointer = (ev: PointerEvent) => {
    if (swipe && swipe.id === ev.pointerId) {
      const p = toGame(ev.clientX, ev.clientY, canvas);
      const dx = p.x - swipe.x0;
      const dy = p.y - swipe.y0;
      const dt = performance.now() - swipe.t0;
      swipe = null;
      if (dt < 700 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        h.onSwipe?.(dx < 0 ? 1 : -1);
      }
    }
    if (!pointerLane.has(ev.pointerId)) return;
    const lane = pointerLane.get(ev.pointerId)!;
    pointerLane.delete(ev.pointerId);
    if (lane >= 0) h.onRelease(lane);
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  window.addEventListener("blur", () => {
    swipe = null;
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
