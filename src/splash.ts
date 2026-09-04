// Ekran powitalny: czarne tło + animacja Lottie (public/assets/ui/splash.json).
//
// - czarne tło pojawia się NATYCHMIAST (HTML/CSS, w index.html) — zanim
//   cokolwiek się wczyta
// - lottie-web ładowany dynamicznie (osobny chunk), żeby nie obciążać wejścia
// - splash znika, gdy gra narysowała pierwszą klatkę I animacja się dograła
//   (albo po twardym limicie czasu)
// - można go pokazać ponownie (powrót do apki po dłuższej nieobecności)

let dismissed = false;
let gameReady = false;
let lottieDone = false;
let root: HTMLElement | null = null;
let shownAt = performance.now();
let runId = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lottieMod: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let animData: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentAnim: any = null;

const MIN_SHOW_MS = 1200; // nie mrugaj splashem
const SOFT_CAP_MS = 4600; // animacja ma ~3 s — daj jej dojść, potem nie czekaj
const HARD_CAP_MS = 6500; // absolutny limit — splash zawsze zniknie

function reduceMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Ładuje bibliotekę + dane animacji RAZ (cache między pokazami). */
async function ensureAssets(): Promise<boolean> {
  try {
    if (!lottieMod) lottieMod = await import("lottie-web/build/player/lottie_light");
    if (!animData) {
      const url = new URL("assets/ui/splash.json", document.baseURI).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`splash.json HTTP ${res.status}`);
      animData = await res.json();
      // polskie znaki: podmień czcionkę z projektu na pewny stack systemowy
      const list = animData?.fonts?.list;
      if (Array.isArray(list)) {
        for (const f of list) f.fFamily = "Arial, Helvetica, 'Segoe UI', 'Liberation Sans', sans-serif";
      }
    }
    return true;
  } catch (e) {
    console.warn("[splash] animacja niedostępna:", e);
    return false;
  }
}

async function playLottie(myRun: number) {
  const host = document.getElementById("splash-anim");
  if (!host) return;
  host.innerHTML = "";
  const ok = await ensureAssets();
  if (myRun !== runId) return; // w międzyczasie splash zszedł / pokazano nowy
  if (!ok || !lottieMod || !animData) {
    // brak animacji — pokaż prosty tekstowy fallback zamiast samej czerni
    host.innerHTML =
      '<div style="font:800 40px/1.1 Arial,sans-serif;letter-spacing:2px;color:#ffce8a;text-align:center;">' +
      "DENIS<br><span style=\"font-size:18px;color:#c9b7a6;letter-spacing:4px;\">IMPULSYWNI&nbsp;LIVE</span></div>";
    lottieDone = true;
    maybeDismiss();
    return;
  }
  const reduce = reduceMotion();
  try {
    if (currentAnim) {
      currentAnim.destroy();
      currentAnim = null;
    }
    currentAnim = lottieMod.default.loadAnimation({
      container: host,
      renderer: "svg",
      loop: false,
      autoplay: !reduce,
      animationData: animData,
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    if (reduce) {
      currentAnim.goToAndStop(Math.max(0, (animData.op ?? 1) - 1), true);
      lottieDone = true;
      maybeDismiss();
    } else {
      currentAnim.addEventListener("complete", () => {
        lottieDone = true;
        maybeDismiss();
      });
    }
  } catch (e) {
    console.warn("[splash] lottie loadAnimation:", e);
    lottieDone = true;
    maybeDismiss();
  }
}

export function initSplash() {
  root = document.getElementById("splash");
  if (!root) return;
  startRun();
}

function startRun() {
  if (!root) return;
  runId++;
  const myRun = runId;
  dismissed = false;
  lottieDone = false;
  shownAt = performance.now();
  root.classList.remove("splash-hide");
  root.style.removeProperty("display");
  void playLottie(myRun);
  setTimeout(maybeDismiss, HARD_CAP_MS + 100);
}

/** Woła main.ts, gdy gra narysowała pierwszą klatkę. */
export function splashGameReady() {
  gameReady = true;
  maybeDismiss();
}

/** Pokazuje splash ponownie (powrót do apki po dłuższej nieobecności). */
export function showSplashAgain() {
  if (!root) {
    root = document.getElementById("splash");
    if (!root) return;
  }
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
