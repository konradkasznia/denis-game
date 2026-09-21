import "./style.css";
import { Game } from "./game.ts";
import { initInput } from "./input.ts";
import { hideSplash, initNativeShell } from "./nativeShell.ts";
import { initSplash, splashGameReady } from "./splash.ts";
import { VH, VW, viewport } from "./viewport.ts";

initSplash();

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// Adaptacyjna rozdzielczość canvasu. Na słabszych GPU (zmierzone na Galaxy A41,
// Mali-G52: 45 fps przy 2.0x, 59.5 fps przy 1.5x) wąskim gardłem jest
// rasteryzacja dużego canvasu (m.in. shadowBlur), nie JavaScript — główny wątek
// stoi wtedy w ~65% bezczynny. Startujemy w pełnej jakości, a gdy klatki
// regularnie się spóźniają, schodzimy o stopień niżej i pamiętamy wybór.
const DPR_STEPS = [2, 1.5, 1.25, 1];
const DPR_KEY = "denis.dprStep";
let dprStep = 0;
try {
  const saved = Number(localStorage.getItem(DPR_KEY));
  if (Number.isInteger(saved) && saved >= 0 && saved < DPR_STEPS.length) dprStep = saved;
} catch {
  /* brak localStorage — zostajemy przy pełnej jakości */
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprStep]);
  // fallbacki na wypadek dziwnego momentu cyklu życia (0 / undefined) —
  // bez nich `scale` może wyjść 0/NaN i cały render się wywala co klatkę
  const availW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || VW);
  // iOS Safari zaniża `innerHeight` o pasek narzędzi, przez co gra „myśli", że
  // ekran jest niższy niż jest (pusty pas u dołu, ucięta grafika u góry).
  // `#app` ma `position:fixed;inset:0`, więc `documentElement.clientHeight`
  // (layout viewport) opisuje realny obszar — bierzemy większą z wartości.
  const availH = Math.max(
    1,
    window.innerHeight || 0,
    document.documentElement.clientHeight || 0,
    window.visualViewport?.height || 0,
  );

  // Skala MUSI mieścić cały projekt 720x1280, nie tylko jego szerokość.
  //
  // Wcześniej było `scale = availW / VW`, czyli „wypełnij szerokość", a wysokość
  // układu domykał `Math.max(VH, ...)`. Na telefonie (proporcje ~19.5:9) to
  // działa, bo ekran jest WYŻSZY niż projekt. Na tablecie jest odwrotnie:
  // Galaxy Tab A7 lite to 800x1340, czyli 1.675 — mniej niż 1280/720 = 1.778.
  // Gra rysowała wtedy układ na 1280 jednostek, a widocznych było ~1107:
  // linia trafienia (hitY 1118) i CAŁA strefa klawiszy (do 1264) lądowały
  // poniżej dolnej krawędzi ekranu. Karuzela działała (GRAJ kończy się na
  // 1090), więc objaw wyglądał jak „runda się nie uruchamia", choć runda
  // startowała — tylko nie było czego dotknąć.
  //
  // `Math.min` = dopasuj do węższego wymiaru: na telefonie wychodzi dokładnie
  // to samo co wcześniej (człon szerokości jest mniejszy), na tablecie gra
  // skaluje się do wysokości i jest wyśrodkowana w poziomie.
  // Skala: domyślnie „wypełnij szerokość" (tak było i tak ma zostać na telefonach).
  // Letterbox (dopasowanie do wysokości + pasy po bokach) włączamy TYLKO gdy
  // ekranowi realnie brakuje wysokości, bo inaczej strefa klawiszy wypada poza
  // ekran — tak było na Galaxy Tab: widoczne 1107 jednostek zamiast 1280,
  // linia trafienia na 1118, klawisze do 1264, czyli poza obrazem.
  // Mały niedobór (paski Safari na iPhone chowające się przy scrollu) ignorujemy:
  // ucina nieużywany margines pod klawiszami, a gra nie skacze między skalami.
  const TOLERANCJA = 90; // jednostek projektu
  const scaleW = availW / VW;
  const widoczneNaScaleW = availH / scaleW;
  const scale = widoczneNaScaleW >= VH - TOLERANCJA ? scaleW : Math.min(scaleW, availH / VH);
  // clamp do rozsądnego zakresu — nawet gdyby availH było absurdalne
  const vh = Math.max(VH, Math.min(VH * 3, Math.round(availH / scale) || VH));
  // poziome wyśrodkowanie, gdy ekran jest szerszy niż przeskalowany projekt
  const offsetX = Math.max(0, Math.round((availW - VW * scale) / 2));

  canvas.style.width = `${availW}px`;
  canvas.style.height = `${availH}px`;
  canvas.width = Math.round(availW * dpr);
  canvas.height = Math.round(availH * dpr);

  viewport.scale = scale;
  viewport.offsetX = offsetX;
  viewport.offsetY = 0;
  viewport.dpr = dpr;
  viewport.vh = vh;

  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, 0);
  // "medium" wygląda w tej stylistyce tak samo, a przy dużych skalowanych
  // bitmapach (postać, tła) na telefonie kosztuje wyraźnie mniej (audyt B7)
  ctx.imageSmoothingQuality = "medium";
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
  onDrag: (dy) => game.onDrag(dy),
  onDragEnd: () => game.onDragEnd(),
  onWheel: (dy) => game.onWheel(dy),
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

// Okno pomiarowe: ~90 klatek pełnej płynności. Jeśli >= 20% z nich trwa dłużej
// niż 25 ms (GPU nie wyrabia — vsync zbija 60 → 30 fps), schodzimy o stopień
// rozdzielczości. Liczymy tylko gdy gra i tak rysuje pełnym tempem (highFps),
// z krótką rozgrzewką na start (ładowanie obrazków to nie wina rozdzielczości).
const ADAPT_WARMUP = 90;
const ADAPT_WINDOW = 90;
let adaptSeen = 0;
let adaptSlow = 0;
function adaptQuality(elapsedMs: number, full: boolean) {
  if (!full || elapsedMs > 250) {
    adaptSeen = 0;
    adaptSlow = 0;
    return;
  }
  adaptSeen++;
  if (adaptSeen <= ADAPT_WARMUP) return;
  if (elapsedMs > 25) adaptSlow++;
  if (adaptSeen - ADAPT_WARMUP < ADAPT_WINDOW) return;
  const bad = adaptSlow / ADAPT_WINDOW >= 0.25;
  adaptSeen = ADAPT_WARMUP;
  adaptSlow = 0;
  if (!bad) return;
  const cur = Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprStep]);
  let next = dprStep + 1;
  while (next < DPR_STEPS.length && DPR_STEPS[next] >= cur) next++;
  if (next >= DPR_STEPS.length) return; // niżej się nie da
  dprStep = next;
  try {
    localStorage.setItem(DPR_KEY, String(dprStep));
  } catch {
    /* ignoruj */
  }
  resize();
  game.repositionFields();
}

let last = performance.now();
let firstFrame = true;
function frame(now: number, gen: number) {
  if (!loopActive || gen !== loopGen) return; // przestarzała pętla — kończymy
  requestAnimationFrame((t) => frame(t, gen));

  const elapsed = (now - last) / 1000;
  // poza grą ograniczamy do ~30 kl./s (mniej pracy GPU/CPU, telefon się nie grzeje)
  const full = game.highFps();
  const minStep = full ? 0 : 0.031;
  if (elapsed < minStep) return;

  const dt = Math.min(elapsed, 0.05);
  last = now;
  adaptQuality(elapsed * 1000, full && game.isRoundRunning());
  // Siatka bezpieczeństwa: cała gra to tysiące linii rysujących co klatkę —
  // jeden nieprzewidziany brzegowy przypadek (np. dostęp do jeszcze
  // niewczytanego obrazka, indeks poza tablicą) rzucony BEZ tego try/catch
  // urywałby `ctx.restore()`, zostawiając canvas z niesparowanym `save()`
  // NA STAŁE (przekrzywiony/obcięty rysunek do końca sesji, bez żadnego
  // komunikatu). Teraz pojedyncza zła klatka jest pomijana, a pętla i canvas
  // wracają do normy od następnej — zamiast trwale zepsutego ekranu.
  try {
    game.update(dt, now);
  } catch (e) {
    console.error("game.update() — pominięto klatkę:", e);
  }
  // Wyczyść CAŁY canvas w pikselach urządzenia. Gra rysuje tylko obszar
  // projektu (720 jednostek szerokości), a przy ekranie szerszym niż
  // przeskalowany projekt (tablety, letterbox) zostają pasy po bokach, których
  // nic nie zamalowuje — bez tego widać w nich śmieci z bufora canvasu.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0b0b12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  ctx.save();
  try {
    game.render(ctx);
  } catch (e) {
    console.error("game.render() — pominięto resztę klatki:", e);
  } finally {
    ctx.restore();
  }
  if (firstFrame) {
    firstFrame = false;
    hideSplash(); // gra narysowana — chowamy natywny splash (Capacitor)
    splashGameReady(); // ...i pozwalamy zejść ekranowi powitalnemu (web)
  }
}
void ensureFonts().then(() => requestAnimationFrame((t) => frame(t, loopGen)));
