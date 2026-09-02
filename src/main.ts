import "./style.css";
import { Game } from "./game.ts";
import { initInput } from "./input.ts";
import { hideSplash, initNativeShell } from "./nativeShell.ts";
import { VH, VW, viewport } from "./viewport.ts";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // fallbacki na wypadek dziwnego momentu cyklu życia (0 / undefined) —
  // bez nich `scale` może wyjść 0/NaN i cały render się wywala co klatkę
  const availW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || VW);
  const availH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || VH);

  // Wypełniamy CAŁY ekran: skala liczona z szerokości (gra jest w pionie),
  // a wysokość układu „rozciąga się" — `viewport.vh` >= VH na wyższych telefonach.
  const scale = availW / VW;
  // clamp do rozsądnego zakresu — nawet gdyby availH było absurdalne
  const vh = Math.max(VH, Math.min(VH * 3, Math.round(availH / scale) || VH));

  canvas.style.width = `${availW}px`;
  canvas.style.height = `${availH}px`;
  canvas.width = Math.round(availW * dpr);
  canvas.height = Math.round(availH * dpr);

  viewport.scale = scale;
  viewport.offsetX = 0;
  viewport.offsetY = 0;
  viewport.dpr = dpr;
  viewport.vh = vh;

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
  onSwipe: (dir) => game.onSwipe(dir),
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

// ---- pętla renderu: oszczędna dla CPU / baterii / temperatury ----------
//  - gdy apka jest w tle / karta niewidoczna: pętla całkiem stoi
//  - poza rozgrywką (menu, karuzela, wyniki): ~30 kl./s zamiast 60
//
// `loopGen` = numer pokolenia pętli. Każde włączenie bumpuje go, więc nawet
// gdy szybko przełączymy off→on kilka razy, przeżyje TYLKO najnowsza pętla
// (inaczej narobiłoby się kilka równoległych rAF → podwójne update()).
let loopActive = true;
let loopGen = 0;

/** Włącza/wyłącza pętlę renderu (wołane przy zejściu apki w tło / powrocie). */
export function setLoopActive(on: boolean) {
  if (on === loopActive) return;
  loopActive = on;
  loopGen++;
  if (on) {
    last = performance.now();
    const gen = loopGen;
    requestAnimationFrame((t) => frame(t, gen));
  }
}
document.addEventListener("visibilitychange", () => {
  const visible = document.visibilityState === "visible";
  if (visible) {
    setLoopActive(true);
    game.onAppForeground();
  } else {
    game.onAppBackground(); // pauza gry/dźwięku PRZED zatrzymaniem pętli
    setLoopActive(false);
  }
});

let last = performance.now();
let firstFrame = true;
function frame(now: number, gen: number) {
  if (!loopActive || gen !== loopGen) return; // przestarzała pętla — kończymy
  requestAnimationFrame((t) => frame(t, gen));

  const elapsed = (now - last) / 1000;
  // poza grą ograniczamy do ~30 kl./s (mniej pracy GPU/CPU, telefon się nie grzeje)
  const minStep = game.highFps() ? 0 : 0.031;
  if (elapsed < minStep) return;

  const dt = Math.min(elapsed, 0.05);
  last = now;
  game.update(dt, now);
  ctx.save();
  game.render(ctx);
  ctx.restore();
  if (firstFrame) {
    firstFrame = false;
    hideSplash(); // gra narysowana — chowamy natywny splash
  }
}
void ensureFonts().then(() => requestAnimationFrame((t) => frame(t, loopGen)));
