// Ekran powitalny: czarne tło + animacja Lottie.
//
// Animacja i biblioteka są STATYCZNIE zbundlowane (import poniżej) — żadnego
// dynamicznego import()/fetch, który potrafił milczkiem paść w WebView APK
// (wtedy widać było samą czerń). Źródło animacji: `src/splash-anim.json`
// (kopia tego, co Konrad wrzuca do `public/assets/ui/splash.json`).
//
// - czarne tło pojawia się NATYCHMIAST (HTML/CSS, w index.html)
// - splash znika po dograniu animacji (albo po twardym limicie czasu)
// - można go pokazać ponownie (powrót do apki po dłuższej nieobecności)

// lottie_light (renderer SVG, bez expressions/efektów — których ta animacja
// nie używa) STATYCZNIE w bundlu — żadnego dynamicznego import(), który
// potrafił milczkiem paść w WebView APK
import lottie from "lottie-web/build/player/lottie_light";
import splashAnim from "./splash-anim.json";

let dismissed = false;
let gameReady = false;
let lottieDone = false;
let root: HTMLElement | null = null;
let shownAt = performance.now();
let runId = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentAnim: any = null;

const MIN_SHOW_MS = 1200;
const SOFT_CAP_MS = 4600; // animacja ~3 s — daj jej dojść
const HARD_CAP_MS = 6500;

// podmiana czcionki na pewny stack systemowy (polskie znaki; tekst w JSON to
// żywy string, nie ścieżki) — robimy RAZ na module
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (splashAnim as any)?.fonts?.list;
  if (Array.isArray(list)) {
    for (const f of list) f.fFamily = "Arial, Helvetica, 'Segoe UI', 'Liberation Sans', sans-serif";
  }
} catch {
  /* ignore */
}

function reduceMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function playLottie(myRun: number) {
  const host = document.getElementById("splash-anim");
  if (!host || myRun !== runId) return;
  host.innerHTML = "";
  const reduce = reduceMotion();
  try {
    if (currentAnim) {
      currentAnim.destroy();
      currentAnim = null;
    }
    currentAnim = lottie.loadAnimation({
      container: host,
      renderer: "svg",
      loop: false,
      autoplay: !reduce,
      animationData: splashAnim,
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    if (reduce) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentAnim.goToAndStop(Math.max(0, ((splashAnim as any).op ?? 1) - 1), true);
      lottieDone = true;
      maybeDismiss();
    } else {
      currentAnim.addEventListener("complete", () => {
        lottieDone = true;
        maybeDismiss();
      });
    }
  } catch (e) {
    console.warn("[splash] lottie:", e);
    // fallback tekstowy, żeby nie było samej czerni
    host.innerHTML =
      '<div style="font:800 40px/1.15 Arial,sans-serif;letter-spacing:2px;color:#ffce8a;text-align:center;">' +
      "DENIS<br><span style=\"font-size:16px;color:#c9b7a6;letter-spacing:3px;\">IMPULSYWNI&nbsp;LIVE</span></div>";
    lottieDone = true;
    maybeDismiss();
  }
}

function startRun() {
  if (!root) return;
  runId++;
  dismissed = false;
  lottieDone = false;
  shownAt = performance.now();
  root.classList.remove("splash-hide");
  root.style.removeProperty("display");
  playLottie(runId);
  setTimeout(maybeDismiss, HARD_CAP_MS + 100);
}

export function initSplash() {
  root = document.getElementById("splash");
  if (!root) return;
  startRun();
}

/** Woła main.ts, gdy gra narysowała pierwszą klatkę. */
export function splashGameReady() {
  gameReady = true;
  maybeDismiss();
}

/** Pokazuje splash ponownie (powrót do apki po dłuższej nieobecności). */
export function showSplashAgain() {
  if (!root) root = document.getElementById("splash");
  if (!root) return;
  gameReady = true; // gra już działa — czekamy tylko na animację / SOFT_CAP
  startRun();
}

function maybeDismiss() {
  if (dismissed || !root) return;
  const elapsed = performance.now() - shownAt;
  const ready =
    elapsed >= HARD_CAP_MS ||
    (gameReady && elapsed >= MIN_SHOW_MS && (lottieDone || elapsed >= SOFT_CAP_MS));
  if (!ready) {
    setTimeout(maybeDismiss, 200);
    return;
  }
  dismissed = true;
  root.classList.add("splash-hide");
  const r = root;
  setTimeout(() => {
    if (dismissed) r.style.display = "none"; // zostaje w DOM — można pokazać znów
  }, 550);
}
