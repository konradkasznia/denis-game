// Animowane postacie: slider (karuzela WYBIERZ HIT) i ekran NAGRODY.
//
// Animacje Lottie z narzędzia lottie-jezdziec (D:\Projekty\Lekkie animacje\Slider),
// skopiowane do public/assets/ui/slider-anim/<id>.json. Obrazki są osadzone w
// środku (base64), a statycznych PNG tych postaci w grze już NIE MA (apka ma być
// lekka) — animacja jest jedynym źródłem grafiki. Pliki leżą w paczce apki i
// wczytują się przy starcie gry (initSliderAnims w main.ts).
//
// Gra rysuje wszystko na jednym canvasie, dlatego animacja renderuje się do
// WŁASNEGO płótna pomocniczego (renderer canvas z lottie-web), a gra wkleja to
// płótno w swoje miejsce. Klatkę wybieramy sami z zegara gry (autoplay: false +
// goToAndStop) — bez osobnej pętli requestAnimationFrame biblioteki, więc
// animacja staje razem z grą, gdy apka jest w tle.
//
// Zablokowany poziom: ta sama animacja w odcieniach szarości (sliderAnimFrame
// z gray=true). Szarość robimy trybami mieszania canvasu ("saturation"), a nie
// ctx.filter, bo filter na canvasie działa w Safari dopiero od iOS 18.
//
// Biblioteka lottie: wspólny rejestr w lottieLib.ts (rejestruje main.ts).

import { getLottie, loadLottieCanvas, type LottieAnim } from "./lottieLib.ts";

// "prezent" = Denis z prezentem na ekranie NAGRODY
const ANIMATED = new Set([
  "panna-mloda",
  "ksiaze-z-bajki",
  "pogrzebowka",
  "pani-policjantko",
  "byleby-nie-byla-ciepla",
  "prezent",
]);

/** Czy dana postać jest animacją (a nie statycznym select-<id>.png). */
export function hasSliderAnim(id: string): boolean {
  return ANIMATED.has(id);
}

type Rect = { x: number; y: number; w: number; h: number };

interface Entry {
  state: "loading" | "ready" | "failed";
  canvas: HTMLCanvasElement;
  gray: HTMLCanvasElement | null;
  grayFrame: number;
  anim?: LottieAnim;
  fr: number;
  frames: number;
  lastFrame: number;
  bounds: Rect | null;
}

const entries = new Map<string, Entry>();

/** Prostokąt nieprzezroczystej treści klatki (bez pustych marginesów). */
function alphaBounds(c: HTMLCanvasElement): Rect {
  const w = c.width;
  const h = c.height;
  try {
    const p = c.getContext("2d")!.getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (p[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 > x0 && y1 > y0) return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  } catch {
    /* ignore — cały obraz */
  }
  return { x: 0, y: 0, w, h };
}

function load(id: string): Entry {
  const e: Entry = {
    state: "loading",
    canvas: document.createElement("canvas"),
    gray: null,
    grayFrame: -1,
    fr: 30,
    frames: 1,
    lastFrame: -1,
    bounds: null,
  };
  entries.set(id, e);
  loadLottieCanvas(`assets/ui/slider-anim/${id}.json`).then(
    ({ anim, canvas, fr, frames }) => {
      e.anim = anim;
      e.canvas = canvas;
      e.fr = fr;
      e.frames = frames;
      e.lastFrame = 0;
      e.bounds = alphaBounds(canvas); // obrys postaci z pierwszej klatki
      e.state = "ready";
    },
    (err) => {
      console.warn(`[sliderAnim] ${id}:`, err);
      e.state = "failed";
    },
  );
  return e;
}

/** Szara wersja bieżącej klatki (zablokowany poziom), przeliczana tylko przy
 *  zmianie klatki. Kolejno: klatka → nasycenie 0 (tryb „saturation") →
 *  przywrócenie przezroczystości (destination-in) → lekkie przyciemnienie. */
function grayOf(e: Entry): HTMLCanvasElement {
  let g = e.gray;
  if (!g) {
    g = e.gray = document.createElement("canvas");
    g.width = e.canvas.width;
    g.height = e.canvas.height;
  }
  if (e.grayFrame !== e.lastFrame) {
    e.grayFrame = e.lastFrame;
    const c = g.getContext("2d")!;
    c.globalCompositeOperation = "copy";
    c.drawImage(e.canvas, 0, 0);
    c.globalCompositeOperation = "saturation";
    c.fillStyle = "#808080";
    c.fillRect(0, 0, g.width, g.height);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(e.canvas, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = "rgba(0,0,0,0.18)";
    c.fillRect(0, 0, g.width, g.height);
    c.globalCompositeOperation = "source-over";
  }
  return g;
}

/** Bieżąca klatka animacji (płótno w rozmiarze oryginalnej grafiki) albo null,
 *  gdy jeszcze się wczytuje. `gray` = wersja szara (zablokowany poziom).
 *  Bezpieczne do wołania co klatkę. */
export function sliderAnimFrame(id: string, gray = false): HTMLCanvasElement | null {
  if (!getLottie() || !ANIMATED.has(id)) return null;
  const e = entries.get(id) ?? load(id);
  if (e.state !== "ready" || !e.anim) return null;
  const frame = Math.floor((performance.now() / 1000) * e.fr) % e.frames;
  if (frame !== e.lastFrame) {
    e.lastFrame = frame;
    try {
      e.anim.goToAndStop(frame, true);
    } catch (err) {
      console.warn(`[sliderAnim] ${id} render:`, err);
      e.state = "failed";
      return null;
    }
  }
  return gray ? grayOf(e) : e.canvas;
}

/** Obrys postaci w pikselach animacji (z pierwszej klatki) — do dopasowania
 *  postaci do wolnego miejsca na ekranie tak jak dawny przycięty PNG. */
export function sliderAnimBounds(id: string): Rect | null {
  const e = entries.get(id);
  return e && e.state === "ready" ? e.bounds : null;
}

/** Wczytuje wszystkie animacje — woła main.ts przy starcie gry, żeby były
 *  gotowe, zanim gracz dojdzie do slidera / nagród. */
export function initSliderAnims(skip?: (id: string) => boolean): void {
  if (!getLottie()) return;
  for (const id of ANIMATED) if (!entries.has(id) && !skip?.(id)) load(id);
}
