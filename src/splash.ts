// Ekran powitalny: czarne tło + animacja Lottie (public/assets/ui/splash.json).
//
// - czarne tło pojawia się NATYCHMIAST (HTML/CSS, w index.html) — zanim
//   cokolwiek się wczyta
// - lottie-web ładowany dynamicznie (osobny chunk), żeby nie obciążać wejścia
// - splash znika, gdy gra narysowała pierwszą klatkę I animacja się dograła
//   (albo po twardym limicie czasu)

let dismissed = false;
let gameReady = false;
let lottieDone = false;
let root: HTMLElement | null = null;
const shownAt = performance.now();

const MIN_SHOW_MS = 700; // nie mrugaj splashem
const SOFT_CAP_MS = 3400; // po tylu ms nie czekaj już na koniec animacji
const HARD_CAP_MS = 5000; // absolutny limit — splash zawsze zniknie

export function initSplash() {
  root = document.getElementById("splash");
  if (!root) return;
  void playLottie();
  setTimeout(maybeDismiss, HARD_CAP_MS);
}

/** Woła main.ts, gdy gra narysowała pierwszą klatkę. */
export function splashGameReady() {
  gameReady = true;
  maybeDismiss();
}

async function playLottie() {
  const host = document.getElementById("splash-anim");
  if (!host) return;
  const reduce =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    const [mod, res] = await Promise.all([
      import("lottie-web/build/player/lottie_light"),
      fetch("assets/ui/splash.json"),
    ]);
    const data = await res.json();
    // polskie znaki: podmień czcionkę z projektu na pewny stack systemowy
    // z pełnym zakresem łacińskim (tekst w JSON to żywy string, nie ścieżki)
    const list = data?.fonts?.list;
    if (Array.isArray(list)) {
      for (const f of list) f.fFamily = "Arial, Helvetica, 'Segoe UI', 'Liberation Sans', sans-serif";
    }
    const anim = mod.default.loadAnimation({
      container: host,
      renderer: "svg",
      loop: false,
      autoplay: !reduce,
      animationData: data,
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    if (reduce) {
      anim.goToAndStop(Math.max(0, (data.op ?? 1) - 1), true);
      lottieDone = true;
      maybeDismiss();
    } else {
      anim.addEventListener("complete", () => {
        lottieDone = true;
        maybeDismiss();
      });
    }
  } catch {
    // brak lottie / brak pliku / błąd parsowania — trudno, splash zejdzie
    // po sygnale z gry (czarny ekran przez chwilę zamiast animacji)
    lottieDone = true;
    maybeDismiss();
  }
}

function maybeDismiss() {
  if (dismissed || !root) return;
  const elapsed = performance.now() - shownAt;
  const ready =
    elapsed >= HARD_CAP_MS ||
    (gameReady && elapsed >= MIN_SHOW_MS && (lottieDone || elapsed >= SOFT_CAP_MS));
  if (!ready) {
    setTimeout(maybeDismiss, 250);
    return;
  }
  dismissed = true;
  root.classList.add("splash-hide");
  setTimeout(() => {
    root?.remove();
    root = null;
  }, 500);
}
