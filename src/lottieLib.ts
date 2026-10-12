// Wspólny dostęp do lottie-web (renderer canvas) dla animacji postaci:
// slider/NAGRODY (sliderAnim.ts) oraz ujęcia w rozgrywce i edytorze (character.ts).
//
// Biblioteka jest zbundlowana STATYCZNIE przez punkty wejścia (main.ts, editor.ts)
// i rejestrowana tutaj — moduły gry (game.ts, character.ts) jej nie importują,
// bo testy uruchamiają je w Node bez DOM, gdzie lottie-web się nie załaduje.
// Dynamiczny import() celowo NIE jest używany: potrafił po cichu paść w WebView APK.

import type lottieType from "lottie-web/build/player/lottie_light_canvas";

export type Lottie = typeof lottieType;
export type LottieAnim = ReturnType<Lottie["loadAnimation"]>;

let lib: Lottie | null = null;

export function registerLottie(l: Lottie): void {
  lib = l;
}

export function getLottie(): Lottie | null {
  return lib;
}

/** Wczytuje animację Lottie z pliku .json (obrazki osadzone w base64) do
 *  własnego płótna. Klatki wybiera wołający (goToAndStop) — bez pętli
 *  requestAnimationFrame biblioteki. Rozwiązuje się, gdy obrazki są gotowe. */
export async function loadLottieCanvas(
  url: string,
): Promise<{ anim: LottieAnim; canvas: HTMLCanvasElement; fr: number; frames: number }> {
  const l = lib;
  if (!l) throw new Error("lottie niezarejestrowane");
  const res = await fetch(url);
  // status 0 = odpowiedź z paczki apki bez nagłówków HTTP (patrz audio.ts assetOk)
  if (!res.ok && res.status !== 0) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(data.w));
  canvas.height = Math.max(1, Math.round(data.h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("brak kontekstu 2d");
  const anim = l.loadAnimation({
    renderer: "canvas",
    loop: true,
    autoplay: false,
    animationData: data,
    rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
  } as Parameters<Lottie["loadAnimation"]>[0]);
  await new Promise<void>((resolve, reject) => {
    let images = false;
    let dom = false;
    const done = () => {
      if (images && dom) resolve();
    };
    anim.addEventListener("loaded_images", () => {
      images = true;
      done();
    });
    anim.addEventListener("DOMLoaded", () => {
      dom = true;
      done();
    });
    anim.addEventListener("data_failed", () => reject(new Error("data_failed")));
    // bezpiecznik: część wersji lottie nie emituje loaded_images
    setTimeout(() => {
      if (dom) {
        images = true;
        done();
      }
    }, 4000);
  });
  anim.goToAndStop(0, true);
  const fr = Number(data.fr) || 30;
  const frames = Math.max(1, Math.round((Number(data.op) || 1) - (Number(data.ip) || 0)));
  return { anim, canvas, fr, frames };
}
