// Animowane postacie na sliderze (karuzela WYBIERZ HIT).
//
// Animacje Lottie z narzędzia lottie-jezdziec (D:\Projekty\Lekkie animacje\Slider),
// skopiowane do public/assets/ui/slider-anim/<id>.json. Każda ma ten sam rozmiar
// co statyczna grafika select-<id>.png i obrazki osadzone w środku (base64), więc
// nie trzeba dociągać żadnych dodatkowych plików.
//
// Gra rysuje wszystko na jednym canvasie, dlatego animacja renderuje się do
// WŁASNEGO płótna pomocniczego (renderer canvas z lottie-web), a gra wkleja to
// płótno w miejsce statycznej grafiki. Klatkę wybieramy sami z zegara gry
// (autoplay: false + goToAndStop) — bez osobnej pętli requestAnimationFrame
// biblioteki, więc animacja staje razem z grą, gdy apka jest w tle.
//
// Dopóki animacja się nie wczyta (albo gdy się nie uda), wołający dostaje null
// i rysuje statyczny PNG — na sliderze nigdy nie ma pustego miejsca.
//
// Biblioteka zbundlowana STATYCZNIE (jak w splash.ts — dynamiczny import()
// potrafił po cichu paść w WebView APK), ale importuje ją main.ts i przekazuje
// przez registerSliderLottie(): game.ts (testowany w Node, bez DOM) nie ciągnie
// wtedy lottie. Bez rejestracji sliderAnimFrame() zwraca null = statyczny PNG.
// Plik animacji to zwykły fetch lokalnego .json, ta sama droga co beatmapy.

import type lottieType from "lottie-web/build/player/lottie_light_canvas";

type Lottie = typeof lottieType;
let lottie: Lottie | null = null;

/** Woła main.ts ze statycznie zaimportowaną biblioteką. */
export function registerSliderLottie(lib: Lottie): void {
  lottie = lib;
}

/** Utwory, które mają animację na sliderze. */
const ANIMATED = new Set(["panna-mloda", "ksiaze-z-bajki", "pogrzebowka"]);

type AnimItem = ReturnType<Lottie["loadAnimation"]>;

interface Entry {
  state: "loading" | "ready" | "failed";
  canvas: HTMLCanvasElement;
  anim?: AnimItem;
  fr: number;
  frames: number;
  lastFrame: number;
}

const entries = new Map<string, Entry>();

function load(id: string): Entry {
  const canvas = document.createElement("canvas");
  const e: Entry = { state: "loading", canvas, fr: 30, frames: 1, lastFrame: -1 };
  entries.set(id, e);
  void (async () => {
    try {
      const res = await fetch(`assets/ui/slider-anim/${id}.json`);
      // status 0 = odpowiedź z paczki apki bez nagłówków HTTP (patrz audio.ts assetOk)
      if (!res.ok && res.status !== 0) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      canvas.width = Math.max(1, Math.round(data.w));
      canvas.height = Math.max(1, Math.round(data.h));
      e.fr = Number(data.fr) || 30;
      e.frames = Math.max(1, Math.round((Number(data.op) || 1) - (Number(data.ip) || 0)));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("brak kontekstu 2d");
      if (!lottie) throw new Error("lottie niezarejestrowane");
      const anim = lottie.loadAnimation({
        renderer: "canvas",
        loop: true,
        autoplay: false,
        animationData: data,
        rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
      } as Parameters<Lottie["loadAnimation"]>[0]);
      e.anim = anim;
      // obrazki osadzone w base64 dekodują się asynchronicznie — zanim się
      // wczytają, klatka byłaby pusta; do tego czasu gra pokazuje statyczny PNG
      let imagesOk = false;
      let domOk = false;
      const markReady = () => {
        if (imagesOk && domOk && e.state === "loading") e.state = "ready";
      };
      anim.addEventListener("loaded_images", () => {
        imagesOk = true;
        markReady();
      });
      anim.addEventListener("DOMLoaded", () => {
        domOk = true;
        markReady();
      });
      anim.addEventListener("data_failed", () => {
        e.state = "failed";
      });
      // bezpiecznik: część wersji lottie nie emituje loaded_images dla 0 obrazków
      setTimeout(() => {
        if (e.state === "loading" && domOk) e.state = "ready";
      }, 4000);
    } catch (err) {
      console.warn(`[sliderAnim] ${id}:`, err);
      e.state = "failed";
    }
  })();
  return e;
}

/** Bieżąca klatka animacji postaci dla utworu `id` (płótno w rozmiarze grafiki
 *  select-<id>.png) albo null — wtedy rysuj statyczny PNG. Bezpieczne do
 *  wołania co klatkę: wczytuje leniwie przy pierwszym użyciu. */
export function sliderAnimFrame(id: string): HTMLCanvasElement | null {
  if (!lottie || !ANIMATED.has(id)) return null;
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
  return e.canvas;
}

/** Wczytaj z wyprzedzeniem (np. przy wejściu na slider), żeby animacja
 *  była gotowa, zanim gracz przesunie na dany utwór. */
export function preloadSliderAnim(id: string): void {
  if (lottie && ANIMATED.has(id) && !entries.has(id)) load(id);
}
