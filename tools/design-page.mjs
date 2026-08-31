// Buduje stronę-inwentarz ekranów (HTML artifact) z miniaturami zrzutów.
//   node tools/design-page.mjs
import { chromium } from "file:///D:/Projekty/disco-ranking/node_modules/playwright/index.mjs";
import fs from "node:fs";

const OUT_HTML =
  "C:/Users/Konrad/AppData/Local/Temp/claude/D--Mam-Prawnika-Claude-Kod/99b3c115-05e5-4640-8766-7670303f62fa/scratchpad/denis-ekrany.html";

const scenes = [
  { name: "01-rejestracja", scene: "auth", state: { authMarketing: true } },
  { name: "02-nick", scene: "nick" },
  { name: "03-menu", scene: "menu" },
  { name: "04-poznane-utwory", scene: "songs" },
  { name: "05-tablice-lista", scene: "boards" },
  { name: "06-tablica-piosenki", scene: "board", state: { boardSongId: "pan-mlody" } },
  { name: "07-gra-start", scene: "play", state: { awaitingStart: true } },
  { name: "08-gra-odliczanie", scene: "play", state: { awaitingStart: false, paused: false, songTime: 5.3 } },
  {
    name: "09-gra-rozgrywka",
    scene: "play",
    state: {
      awaitingStart: false, paused: false, songTime: 34, combo: 23, maxCombo: 23, flow: 18,
      flowTier: 1, score: 61200, displayScore: 61200, parScore: 220000, health: 0.72,
      counts: { perfect: 70, great: 14, good: 3, miss: 2 }, judgedCount: 89, accSum: 82,
      comboPopAt: 33.9, denisPopAt: 33.9,
    },
  },
  { name: "10-gra-pauza", scene: "play", state: { awaitingStart: false, paused: true, resumeAt: 0, songTime: 34 } },
  {
    name: "11-wynik-animacja", scene: "results", reveal: 700,
    state: {
      score: 620000, parScore: 900000, resultRank: 7, resultStarSeen: 2,
      counts: { perfect: 150, great: 38, good: 9, miss: 5 }, judgedCount: 202, accSum: 178,
      maxCombo: 140, maxFlow: 90, holdsDone: 15, holdsBroken: 1, newBest: true,
    },
  },
  {
    name: "12-wynik-zaliczone", scene: "results", reveal: 6000,
    state: {
      score: 780000, parScore: 900000, resultRank: 7, resultStarSeen: 5,
      counts: { perfect: 150, great: 38, good: 9, miss: 5 }, judgedCount: 202, accSum: 178,
      maxCombo: 140, maxFlow: 90, holdsDone: 15, holdsBroken: 1, newBest: true,
    },
  },
  {
    name: "13-wynik-niezaliczone", scene: "results", reveal: 6000,
    state: {
      score: 95000, parScore: 900000, resultRank: 142, resultStarSeen: 1,
      counts: { perfect: 40, great: 60, good: 40, miss: 60 }, judgedCount: 200, accSum: 90,
      maxCombo: 22, maxFlow: 6, holdsDone: 4, holdsBroken: 6, newBest: false,
    },
  },
];

const Q = (s) => s.replaceAll("»", "„").replaceAll("«", "”"); // »…« -> „…"
const META = {
  "01-rejestracja": {
    t: "Rejestracja / logowanie",
    job: "Pierwszy ekran. Zamarkowany — logowanie nie jest podłączone.",
    el: [
      "Logo »DENIS« (tekst z poświatą)", "Nagłówek sekcji", "Pole E-MAIL (placeholder)",
      "Pole HASŁO (placeholder)", "Przycisk ZALOGUJ (gradient pomarańcz→róż)",
      "Linki: »Zapomniałem hasła«, »Załóż konto«", "Separator »lub zaloguj przez:«",
      "Przycisk social — App Store / Apple ID (iPhone) albo Google Play (Android)",
      "Checkbox zgody marketingowej + treść zgody", "Stopka »wersja demo«",
    ],
  },
  "02-nick": {
    t: "Twój nick",
    job: "Po pierwszym logowaniu. Nick trafia do tablic wyników.",
    el: ["Nagłówek »TWÓJ NICK«", "Podtytuł", "Pole NICK (stuknięcie → wpisanie)", "Przycisk ZAPISZ I GRAJ (gradient)"],
  },
  "03-menu": {
    t: "Menu główne",
    job: "Punkt wyjścia. Start rundy, kolekcja, ranking, ustawienia.",
    el: [
      "Logo »DENIS« + »IMPULSYWNI« + plakietka »● LIVE« (pulsująca)", "Podpis »gra rytmiczna«",
      "Przycisk STARTUJEMY! (duży, gradient, pulsuje do bitu)",
      "Kafelek »Poznane Utwory« (licznik odkrytych)", "Kafelek »Tablice wyników«",
      "Kalibracja dźwięku: etykieta + przyciski −/+", "Przełącznik »Wibracje« (toggle)",
      "Najlepszy wynik", "Ostrzeżenie o przełączniku ciszy iPhone", "Podpowiedź sterowania",
    ],
  },
  "04-poznane-utwory": {
    t: "Poznane Utwory (kolekcja)",
    job: "Siatka utworów. Stuknięcie okładki = zagraj; przy odkrytych — przycisk Spotify.",
    el: [
      "Przycisk »‹ WRÓĆ«", "Nagłówek »POZNANE UTWORY«", "Licznik »odkryte: X / Y«",
      "Karty utworów (2 kolumny): okładka (proceduralna albo z pliku) + odznaka ▶ + tytuł + artysta",
      "Przycisk »▶ SPOTIFY« (zielony) na odkrytych", "Podpis »stuknij okładkę, aby zagrać«",
      "Zablokowane: »? ? ?« + »wkrótce«",
    ],
  },
  "05-tablice-lista": {
    t: "Tablice wyników — lista",
    job: "Wybór piosenki, dla której chcesz zobaczyć ranking.",
    el: [
      "Przycisk »‹ WRÓĆ«", "Nagłówek »TABLICE WYNIKÓW«",
      "Karty piosenek: tytuł + »Twój wynik« + »miejsce N« (albo »brak wyniku«) + »zobacz tablicę ›«",
    ],
  },
  "06-tablica-piosenki": {
    t: "Tablica wyników — jedna piosenka",
    job: "TOP 10 + gdzie jesteś Ty i ile brakuje do TOP 10.",
    el: [
      "Przycisk »‹ WRÓĆ«", "Tytuł piosenki + »TABLICA WYNIKÓW«",
      "Wiersze TOP 10: numer (medal 1/2/3 w kolorze) + nick + wynik",
      "Wiersz gracza podświetlony (jeśli w TOP 10)", "Separator »· · ·«",
      "Wiersz gracza z numerem miejsca",
      "Komunikat »do TOP 10 brakuje Ci N pkt« albo »Jesteś w TOP 10!«",
    ],
  },
  "07-gra-start": {
    t: "Gra — »Stuknij, aby zagrać«",
    job: "Ekran gotowości. Muzyka rusza od świeżego dotknięcia (wymóg iOS).",
    el: [
      "Tytuł utworu", "Ramka »🔊 SPRAWDŹ DŹWIĘK« — instrukcja o przełączniku ciszy i głośności",
      "Duży przycisk ▶ (pulsuje)", "Napis »STUKNIJ, ABY ZAGRAĆ«", "W tle: przyciemniony ekran gry",
    ],
  },
  "08-gra-odliczanie": {
    t: "Gra — odliczanie",
    job: "3-2-1 tuż przed pierwszą nutą.",
    el: ["Wielka cyfra odliczania (3/2/1) z poświatą", "Pełne pole gry w tle (tory, receptory, postać)"],
  },
  "09-gra-rozgrywka": {
    t: "Gra — rozgrywka",
    job: "Główny ekran. Perspektywiczny tor, nuty nadjeżdżają z głębi.",
    el: [
      "Tytuł utworu + pasek postępu (góra) + przycisk pauzy ❚❚",
      "Wynik (6 cyfr, z zerami), rząd 5 gwiazdek (rosną z oceną), pasek życia",
      "Panel »MNOŻNIK ×N« i »FLOW N« (lewa strona, białe kafelki)",
      "Pionowy miernik FLOW + ikona płomienia (prawa strona)",
      "Licznik COMBO (środek, skaluje się na trafieniu)",
      "Baner kamienia milowego (»COMBO ×30«, »MNOŻNIK ×3«)",
      "4 tory zbiegające do horyzontu + linia trafienia + 4 puste kółka (receptory)",
      "Klawisze dotykowe pod linią (zapalają się)",
      "Nuty: kółka rosnące z perspektywą; nuty trzymane z ogonem",
      "Pierścienie / napisy oceny (»PERFECT«, »SUPER«, »OK«, »PUDŁO«)",
      "Postać na pierwszym planie (placeholder patykowy — do podmiany)",
      "Reaktywne światła sceniczne w tle",
    ],
  },
  "10-gra-pauza": {
    t: "Gra — pauza",
    job: "Zamrożony ekran gry + menu pauzy.",
    el: [
      "Przyciemnienie", "Nagłówek »PAUZA«",
      "Przycisk WZNÓW (gradient) — krótkie 3-2-1 i grasz dalej", "Przycisk OD NOWA", "Przycisk MENU",
    ],
  },
  "11-wynik-animacja": {
    t: "Ekran wyniku — animacja licznika",
    job: "Wskazówka tarczy wyjeżdża wg punktów, gwiazdki wskakują równo z nią.",
    el: [
      "Tytuł utworu + »WYNIK RUNDY«", "Rząd 5 gwiazdek (wskakują kolejno)",
      "Tarcza (speedometer): łuk, podziałka, znacznik 70%, wskazówka, hub",
      "Odczyt środkowy: »N%« + »N pkt« + »miejsce N · do TOP 10: …«", "Podpis »stuknij, aby pominąć«",
    ],
  },
  "12-wynik-zaliczone": {
    t: "Ekran wyniku — zaliczone",
    job: "Po animacji, ocena ≥ 70%.",
    el: [
      "Tarcza + gwiazdki (końcowy stan)", "»ZALICZONE!« (zielone) + podtytuł",
      "Pasek statystyk: celność / max combo / flow / »★ REKORD« / »PEŁNE COMBO«",
      "6 liczników: PERFECT / SUPER / OK / PUDŁO / TRZYM. / ZERW.",
      "Przycisk »KOLEJNA RUNDA ›« (gradient)", "Przycisk »♥ Zapisz na Spotify« (zielony)",
      "Linki: »Jeszcze raz« / »Menu«",
    ],
  },
  "13-wynik-niezaliczone": {
    t: "Ekran wyniku — niezaliczone",
    job: "Po animacji, ocena < 70%.",
    el: [
      "Tarcza (wskazówka poniżej 70%) + gwiazdki", "»NIE TYM RAZEM« (różowe) + »zabrakło do 70%«",
      "Pasek statystyk + 6 liczników", "Przycisk »SPRÓBUJ PONOWNIE« (gradient)",
      "Przycisk »♥ Zapisz na Spotify«", "Link »Menu«",
    ],
  },
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:5180/", { waitUntil: "commit", timeout: 30000 });
await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
await page.evaluate(async () => {
  const g = window.__game;
  g.song = await (await import("/src/tracks.ts")).loadTrack("pan-mlody");
  g.update = () => {};
  g.bgReady = false;
  g.songBg = null;
  try {
    localStorage.setItem("denis.account", JSON.stringify({ nick: "Konrad", marketing: true, method: "email" }));
    localStorage.setItem("denis.board.pan-mlody", "138000");
  } catch {}
});

const thumbs = {};
for (const s of scenes) {
  const b64 = await page.evaluate(
    ({ scene, state, reveal }) => {
      const g = window.__game;
      if (state) Object.assign(g, state);
      if (scene) g.scene = scene;
      if (scene === "results") g.resultsAt = performance.now() - (reveal || 6000);
      g.render(document.getElementById("stage").getContext("2d"));
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 533;
      c.getContext("2d").drawImage(document.getElementById("stage"), 0, 0, 300, 533);
      return c.toDataURL("image/jpeg", 0.72).split(",")[1];
    },
    s,
  );
  thumbs[s.name] = b64;
  console.log("✓", s.name);
}
await browser.close();

// ---- HTML ----
const card = (name) => {
  const m = META[name];
  return `<figure class="screen">
  <div class="phone"><img alt="${Q(m.t)}" src="data:image/jpeg;base64,${thumbs[name]}"></div>
  <figcaption>
    <span class="tag">${name}</span>
    <h3>${Q(m.t)}</h3>
    <p class="job">${Q(m.job)}</p>
    <ul>${m.el.map((e) => `<li>${Q(e)}</li>`).join("")}</ul>
  </figcaption>
</figure>`;
};

const swatch = (hex, role) =>
  `<div class="sw"><span style="background:${hex}"></span><code>${hex}</code><small>${role}</small></div>`;

const assetRow = (what, where, status) =>
  `<tr><td>${what}</td><td><code>${where}</code></td><td><span class="chip ${status[0]}">${status[1]}</span></td></tr>`;

const html = `<title>Denis — ekrany aplikacji</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Public+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Spline+Sans+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#f7f3ec; --panel:#fffdf9; --line:#e6ddcf; --ink:#221c16; --ink-soft:#6b6153;
  --amber:#e8791f; --amber-soft:#f4a04a; --rose:#e0416b; --stage:#c9601c;
  --good:#1f8a4c; --code-bg:#efe9dd;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#100d15; --panel:#191420; --line:#2c2436; --ink:#f3ecdf; --ink-soft:#b3a692;
    --amber:#ff9f43; --amber-soft:#ffbe7d; --rose:#ff5e7e; --stage:#ffb457;
    --good:#7be0a6; --code-bg:#221b2c;
  }
}
:root[data-theme="dark"]{
  --bg:#100d15; --panel:#191420; --line:#2c2436; --ink:#f3ecdf; --ink-soft:#b3a692;
  --amber:#ff9f43; --amber-soft:#ffbe7d; --rose:#ff5e7e; --stage:#ffb457;
  --good:#7be0a6; --code-bg:#221b2c;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:"Public Sans",system-ui,sans-serif; font-size:16px; line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1080px; margin:0 auto; padding:64px 24px 120px}
code,.mono{font-family:"Spline Sans Mono",ui-monospace,monospace; font-size:.86em}
h1,h2,h3{font-family:"Bricolage Grotesque","Public Sans",sans-serif; font-weight:800; text-wrap:balance; line-height:1.1; margin:0}
.eyebrow{font-size:.78rem; letter-spacing:.16em; text-transform:uppercase; color:var(--amber); font-weight:700}
header h1{font-size:clamp(2.4rem,6vw,3.8rem); margin:.3em 0 .2em; letter-spacing:-.01em}
header p.lede{font-size:1.15rem; color:var(--ink-soft); max-width:60ch}
.stagebar{height:4px; border-radius:2px; margin:28px 0 0;
  background:linear-gradient(90deg,var(--amber),var(--rose))}
section{margin-top:72px}
section > h2{font-size:1.7rem; display:flex; align-items:baseline; gap:.6ch}
section > h2::before{content:""; width:10px; height:10px; border-radius:3px; background:var(--amber); transform:translateY(-2px)}
section > p.intro{color:var(--ink-soft); max-width:66ch; margin:.8em 0 0}

.note{margin-top:20px; padding:16px 20px; border:1px solid var(--line); border-left:3px solid var(--amber);
  border-radius:8px; background:var(--panel); color:var(--ink-soft); font-size:.95rem}

table{width:100%; border-collapse:collapse; margin-top:22px; font-size:.94rem}
th,td{text-align:left; padding:12px 14px; border-bottom:1px solid var(--line); vertical-align:top}
th{font-size:.74rem; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft); font-weight:700}
td code{background:var(--code-bg); padding:2px 6px; border-radius:5px}
.chip{font-size:.72rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
  padding:3px 9px; border-radius:999px; white-space:nowrap}
.chip.design{background:color-mix(in srgb,var(--amber) 22%,transparent); color:var(--amber)}
.chip.have{background:color-mix(in srgb,var(--good) 20%,transparent); color:var(--good)}
.chip.code{background:var(--code-bg); color:var(--ink-soft)}

.palette{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; margin-top:22px}
.sw{border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--panel)}
.sw span{display:block; height:56px}
.sw code{display:block; padding:8px 10px 2px; font-weight:500}
.sw small{display:block; padding:0 10px 10px; color:var(--ink-soft); font-size:.78rem}

.type-row{display:flex; flex-wrap:wrap; gap:32px; margin-top:22px}
.type-row > div{flex:1; min-width:200px}
.type-row .spec{color:var(--ink-soft); font-size:.9rem; margin-top:4px}
.samp-d{font-family:"Bricolage Grotesque",sans-serif; font-weight:800; font-size:2rem; line-height:1}
.samp-b{font-family:"Public Sans",sans-serif; font-size:1.05rem}
.samp-m{font-family:"Spline Sans Mono",monospace; font-size:1rem}

.screens{display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:36px 28px; margin-top:28px}
.screen{margin:0; display:flex; flex-direction:column; gap:16px}
.phone{align-self:start; border-radius:22px; padding:8px; background:var(--panel);
  border:1px solid var(--line); box-shadow:0 12px 34px -14px rgba(0,0,0,.4)}
.phone img{display:block; width:100%; border-radius:15px}
.screen .tag{font-family:"Spline Sans Mono",monospace; font-size:.76rem; color:var(--amber)}
.screen h3{font-size:1.18rem; margin:.2em 0}
.screen .job{color:var(--ink-soft); font-size:.92rem; margin:0}
.screen ul{margin:.4em 0 0; padding-left:1.15em; font-size:.9rem; color:var(--ink); display:flex; flex-direction:column; gap:5px}
.screen li{line-height:1.45}

.grid-dims{display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px; margin-top:22px}
.dim{border:1px solid var(--line); border-radius:10px; padding:14px 16px; background:var(--panel)}
.dim b{font-family:"Bricolage Grotesque",sans-serif; font-size:1.3rem}
.dim small{display:block; color:var(--ink-soft); font-size:.82rem; margin-top:2px}

footer{margin-top:96px; padding-top:24px; border-top:1px solid var(--line); color:var(--ink-soft); font-size:.86rem}
a{color:var(--amber)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>

<div class="wrap">
<header>
  <span class="eyebrow">Referencja do Figmy</span>
  <h1>Denis — ekrany aplikacji</h1>
  <p class="lede">Wszystkie 13 ekranów gry rytmicznej, lista elementów każdego z nich, paleta i typografia. Do złożenia widoku w Figmie i zaznaczenia, co podmieniamy.</p>
  <div class="stagebar"></div>
</header>

<section>
  <h2>Jak to jest zbudowane</h2>
  <p class="intro">Cała gra to jeden <b>canvas 720 × 1280</b> (pion 9:16), skalowany do ekranu. Interfejs — przyciski, panele, tarcza wyniku, tor z nutami, tło sceniczne — jest <b>rysowany kodem</b> (kształty, gradienty, tekst), nie składany z plików graficznych. Dlatego „grafik" do podmiany jest niewiele — są wypisane niżej. Reszta to układ i kolory, które definiujesz w kodzie.</p>
  <div class="note">Zrzuty poniżej to stany przykładowe (uzupełnione dane, przykładowy ranking). Na telefonie proporcje są takie same, tylko wyższe/węższe zależnie od modelu.</div>
</section>

<section>
  <h2>Co jest do zaprojektowania</h2>
  <p class="intro">Elementy, które realnie produkujesz jako pliki i wrzucasz do gry. Reszta ekranów to interfejs generowany w kodzie — tam zmieniasz kolory/układ, nie podsyłasz grafik.</p>
  <table>
    <thead><tr><th>Element</th><th>Gdzie trafia</th><th>Status</th></tr></thead>
    <tbody>
      ${assetRow("Tło ekranu gry — 1 na piosenkę", "public/assets/bg/&lt;id&gt;.jpg · pion ~1080×1920", ["design", "do zrobienia"])}
      ${assetRow("Postać / animacja — 1 na piosenkę (można wspólną)", "public/assets/char/&lt;nazwa&gt;/ · sprite sheet lub sekwencja PNG", ["design", "do zrobienia"])}
      ${assetRow("Okładki utworów (kolekcja, tablice)", "public/assets/covers/&lt;id&gt;.jpg · kwadrat", ["design", "opcjonalne — teraz proceduralne"])}
      ${assetRow("Logo DENIS / IMPULSYWNI", "ekran logowania + menu — teraz tekst z poświatą", ["design", "opcjonalne — może zostać tekstem"])}
      ${assetRow("Ikona aplikacji / favicon", "app/favicon.ico", ["design", "placeholder"])}
      ${assetRow("Ikony logowania Apple / Google", "ekran logowania — teraz tekst ▶ Google Play", ["design", "opcjonalne"])}
      ${assetRow("Podkład muzyczny (mp3) + beatmapa", "public/assets/songs/ + public/charts/", ["have", "Pan Młody gotowy, reszta tymczasowa"])}
      ${assetRow("Cały pozostały interfejs (przyciski, panele, tarcza, tor, HUD)", "rysowane w kodzie (src/game.ts)", ["code", "kod — nie plik"])}
    </tbody>
  </table>
</section>

<section>
  <h2>Paleta</h2>
  <p class="intro">Kolory wprost z kodu gry. Ciepła scena: amber → róż na czerni. Semantyka ocen ma własne kolory (nie mieszać z akcentem).</p>
  <div class="palette">
    ${swatch("#0b0b12", "tło bazowe")}
    ${swatch("#101018", "tło pola gry")}
    ${swatch("#12101a", "panel / karta")}
    ${swatch("#ff9f43", "akcent — pomarańcz")}
    ${swatch("#ff5e7e", "akcent — róż (koniec gradientu)")}
    ${swatch("#ffb457", "poświata / światła sceniczne")}
    ${swatch("#ffce8a", "etykiety, linki")}
    ${swatch("#ffd24c", "złoto — gwiazdki, combo")}
    ${swatch("#fff7ec", "nagłówki / tekst jasny")}
    ${swatch("#c9b7a6", "tekst drugorzędny")}
    ${swatch("#8a7c6e", "tekst wyciszony")}
    ${swatch("#ffe27a", "ocena PERFECT")}
    ${swatch("#8affc1", "ocena SUPER / sukces")}
    ${swatch("#8ab6ff", "ocena OK")}
    ${swatch("#ff6b7d", "ocena PUDŁO / błąd")}
    ${swatch("#43d67a", "pasek życia")}
    ${swatch("#1DB954", "Spotify")}
  </div>
  <div class="note"><b>Tory (4 kolory kolejno):</b> <code>#ff9f43</code> · <code>#ff6b3d</code> · <code>#ffd24c</code> · <code>#ff5e7e</code>. Przyciski główne: gradient poziomy <code>#ff9f43 → #ff5e7e</code>.</div>
</section>

<section>
  <h2>Typografia</h2>
  <p class="intro">Gra używa jednego kroju systemowego. Do makiety w Figmie odpowiednik: humanistyczny grotesk, bez szeryfów, dużo wagi 700–800, wersaliki z rozstrzeleniem.</p>
  <div class="type-row">
    <div><div class="samp-d">DENIS · STARTUJEMY!</div><div class="spec">Nagłówki / przyciski — waga 800, letter-spacing 0.04–0.12em w wersalikach. W grze: „Trebuchet MS" / system-ui.</div></div>
    <div><div class="samp-b">Trafiaj kółka na linii. Długie przytrzymaj.</div><div class="spec">Treść / podpowiedzi — waga 400–500, kolor drugorzędny.</div></div>
    <div><div class="samp-m">061200 · ×2 · 138 000 pkt</div><div class="spec">Liczby (wynik, ranking) — cyfry tabelaryczne, waga 700–800.</div></div>
  </div>
</section>

<section>
  <h2>Ekrany</h2>
  <p class="intro">13 ekranów w kolejności przepływu. Pod każdym — do czego służy i z jakich elementów się składa. Nazwy plików odpowiadają załączonym pełnym zrzutom PNG.</p>
  <div class="screens">
    ${scenes.map((s) => card(s.name)).join("\n")}
  </div>
</section>

<section>
  <h2>Siatka i wymiary</h2>
  <div class="grid-dims">
    <div class="dim"><b>720 × 1280</b><small>wewnętrzna rozdzielczość (9:16)</small></div>
    <div class="dim"><b>y ≈ 330</b><small>horyzont — punkt zbiegu torów</small></div>
    <div class="dim"><b>y ≈ 1118</b><small>linia trafienia (puste kółka)</small></div>
    <div class="dim"><b>150 px</b><small>odstęp środków torów przy linii</small></div>
    <div class="dim"><b>52 px</b><small>promień pustego kółka (receptora)</small></div>
    <div class="dim"><b>40 px</b><small>margines boczny UI</small></div>
    <div class="dim"><b>~706</b><small>linia „gruntu" postaci (regulowana per utwór)</small></div>
    <div class="dim"><b>2,15 s</b><small>czas przelotu nuty od horyzontu do linii</small></div>
  </div>
</section>

<footer>
  Wygenerowane z aktualnego kodu gry (<code>D:\\Projekty\\denis-game</code>). Pełne zrzuty PNG (720×1280) w folderze <code>figma-ekrany/</code> — dołączone osobno.
</footer>
</div>`;

fs.writeFileSync(OUT_HTML, html);
console.log("\nzapisano", OUT_HTML, "(" + Math.round(html.length / 1024) + " KB)");
