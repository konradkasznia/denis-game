import "./style.css";
import { Game } from "./game.ts";
import { initInput } from "./input.ts";
import { hideSplash, initNativeShell } from "./nativeShell.ts";
import { VH, VW, viewport } from "./viewport.ts";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  const scale = Math.min(availW / VW, availH / VH);
  const cssW = VW * scale;
  const cssH = VH * scale;

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  // viewport.scale jest w jednostkach CSS (do przeliczania dotyku)
  viewport.scale = scale;
  viewport.offsetX = 0;
  viewport.offsetY = 0;
  viewport.dpr = dpr;

  // kontekst rysuje w jednostkach gry; dpr obsłużony tutaj
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.imageSmoothingQuality = "high";
}

const game = new Game(canvas);
initNativeShell(game);

let vpRaf = 0;
function onViewportChange() {
  if (vpRaf) return;
  vpRaf = requestAnimationFrame(() => {
    vpRaf = 0;
    // gdy user pisze w polu, klawiatura zmienia tylko wysokość okna — nie
    // przeskalowujemy całej gry (to powodowało „skakanie" i mruganie klawiatury),
    // jedynie korygujemy pozycję pól
    if (game.textInputActive()) {
      game.repositionFields();
      return;
    }
    resize();
    game.repositionFields();
  });
}
window.addEventListener("resize", onViewportChange);
window.addEventListener("orientationchange", onViewportChange);

// Blokada orientacji na PION — w apce ekran się nie obraca, niezależnie od
// ustawień telefonu. Natywnie (App Store / Google Play) wymusza to config
// Capacitora (iOS: UISupportedInterfaceOrientations = tylko Portrait;
// Android: android:screenOrientation="portrait"). Tu best-effort dla WebView/PWA.
function lockPortrait() {
  try {
    const so = (typeof screen !== "undefined" && screen.orientation) as unknown as
      | { lock?: (o: string) => Promise<void> }
      | null;
    if (so && typeof so.lock === "function") void so.lock("portrait").catch(() => {});
  } catch {
    /* nieobsługiwane — zostaje #rotate-hint (CSS) */
  }
}
lockPortrait();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") lockPortrait();
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onViewportChange);
}
resize();
initInput(canvas, {
  laneAt: (x) => game.laneAtX(x),
  onPress: (lane, x, y) => game.onPress(lane, x, y),
  onRelease: (lane) => game.onRelease(lane),
});

if (import.meta.env.DEV) (window as any).__game = game;

// wczytaj Roboto (nagłówki) zanim zacznie się pętla rysowania — z timeoutem,
// żeby nie blokować gry gdy Google Fonts nie odpowiada
async function ensureFonts() {
  try {
    await Promise.race([
      Promise.all([
        (document as any).fonts.load('900 32px "Roboto"'),
        (document as any).fonts.load('700 20px "Roboto"'),
      ]),
      new Promise((res) => setTimeout(res, 1500)),
    ]);
  } catch {
    /* fallback do stacku sans */
  }
}

let last = performance.now();
let firstFrame = true;
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt, now);
  ctx.save();
  game.render(ctx);
  ctx.restore();
  if (firstFrame) {
    firstFrame = false;
    hideSplash(); // gra narysowana — chowamy natywny splash
  }
  requestAnimationFrame(frame);
}
void ensureFonts().then(() => requestAnimationFrame(frame));
