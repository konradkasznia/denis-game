// Zrzuty wszystkich ekranów gry do figma-ekrany/*.png (720x1280).
// Uruchom przy działającym dev serwerze (port 5180):
//   node tools/shots.mjs
import { chromium } from "file:///D:/Projekty/disco-ranking/node_modules/playwright/index.mjs";
import fs from "node:fs";

const OUT = "figma-ekrany";
fs.mkdirSync(OUT, { recursive: true });

const scenes = [
  { name: "01-rejestracja", scene: "auth", state: { authMarketing: true } },
  { name: "02-nick", scene: "nick" },
  { name: "03-menu", scene: "menu" },
  { name: "04-poznane-utwory", scene: "songs" },
  { name: "05-tablice-lista", scene: "boards" },
  { name: "06-tablica-piosenki", scene: "board", state: { boardSongId: "pan-mlody" } },
  { name: "07-gra-start", scene: "play", state: { awaitingStart: true } },
  {
    name: "08-gra-odliczanie",
    scene: "play",
    state: { awaitingStart: false, paused: false, songTime: 5.3 },
  },
  {
    name: "09-gra-rozgrywka",
    scene: "play",
    state: {
      awaitingStart: false,
      paused: false,
      songTime: 34,
      combo: 23,
      maxCombo: 23,
      flow: 18,
      flowTier: 1,
      score: 61200,
      displayScore: 61200,
      health: 0.72,
      counts: { perfect: 70, great: 14, good: 3, miss: 2 },
      judgedCount: 89,
      accSum: 82,
      comboPopAt: 33.9,
      denisPopAt: 33.9,
    },
  },
  {
    name: "10-gra-pauza",
    scene: "play",
    state: { awaitingStart: false, paused: true, resumeAt: 0, songTime: 34 },
  },
  {
    name: "11-wynik-animacja",
    scene: "results",
    state: {
      score: 780000,
      parScore: 900000,
      resultRank: 7,
      resultStarSeen: 2,
      counts: { perfect: 150, great: 38, good: 9, miss: 5 },
      judgedCount: 202,
      accSum: 178,
      maxCombo: 140,
      maxFlow: 90,
      holdsDone: 15,
      holdsBroken: 1,
      newBest: true,
    },
    reveal: 700,
  },
  {
    name: "12-wynik-zaliczone",
    scene: "results",
    state: {
      score: 780000,
      parScore: 900000,
      resultRank: 7,
      resultStarSeen: 5,
      counts: { perfect: 150, great: 38, good: 9, miss: 5 },
      judgedCount: 202,
      accSum: 178,
      maxCombo: 140,
      maxFlow: 90,
      holdsDone: 15,
      holdsBroken: 1,
      newBest: true,
    },
    reveal: 6000,
  },
  {
    name: "13-wynik-niezaliczone",
    scene: "results",
    state: {
      score: 95000,
      parScore: 900000,
      resultRank: 142,
      resultStarSeen: 1,
      counts: { perfect: 40, great: 60, good: 40, miss: 60 },
      judgedCount: 200,
      accSum: 90,
      maxCombo: 22,
      maxFlow: 6,
      holdsDone: 4,
      holdsBroken: 6,
      newBest: false,
    },
    reveal: 6000,
  },
];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && console.log("  page-err:", m.text()));
await page.goto("http://127.0.0.1:5180/", { waitUntil: "commit", timeout: 30000 });
await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });

// wczytaj beatmapę Pan Młody + ustaw dane rankingu, zamroź pętlę
await page.evaluate(async () => {
  const g = window.__game;
  const { loadTrack } = await import("/src/tracks.ts");
  g.song = await loadTrack("pan-mlody");
  g.update = () => {};
  g.bgReady = false;
  g.songBg = null;
  try {
    localStorage.setItem("denis.account", JSON.stringify({ nick: "Konrad", marketing: true, method: "email" }));
    localStorage.setItem("denis.board.pan-mlody", "138000");
  } catch {}
});

for (const s of scenes) {
  await page.evaluate(
    ({ scene, state, reveal }) => {
      const g = window.__game;
      if (state) Object.assign(g, state);
      if (scene) g.scene = scene;
      if (scene === "results") g.resultsAt = performance.now() - (reveal || 6000);
      g.render(document.getElementById("stage").getContext("2d"));
    },
    s,
  );
  await page.waitForTimeout(140);
  await page.locator("#stage").screenshot({ path: `${OUT}/${s.name}.png` });
  console.log("✓", s.name);
}

await browser.close();
console.log(`\nGotowe: ${scenes.length} plików w ${OUT}/`);
