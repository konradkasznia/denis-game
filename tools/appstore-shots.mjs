// Zrzuty do App Store Connect (iPhone 6,9" i iPad 13") z dev serwera gry.
//   npm run dev   (albo preview)  →  node tools/appstore-shots.mjs [port]
// Wynik: appstore-shots/iphone-69/*.png (1320x2868), appstore-shots/ipad-13/*.png (2064x2752)
import { chromium } from "file:///D:/Projekty/disco-ranking/node_modules/playwright/index.mjs";
import fs from "node:fs";

const PORT = process.argv[2] || "5180";
const URL = `http://127.0.0.1:${PORT}/`;

const DEVICES = [
  { dir: "iphone-69", viewport: { width: 440, height: 956 }, dpr: 3 }, // 1320x2868
  { dir: "ipad-13", viewport: { width: 1032, height: 1376 }, dpr: 2 }, // 2064x2752
];

// gracz „z zewnątrz" (nie konto dev): 2 poziomy zaliczone, Pogrzebówka kupiona
const STORAGE = {
  "denis.login": "fan",
  "denis.account": JSON.stringify({ nick: "Ola", marketing: false, method: "email" }),
  "denis.stars": JSON.stringify({ "panna-mloda": 5, "ksiaze-z-bajki": 4, pogrzebowka: 3 }),
  "denis.unlocked": JSON.stringify(["pogrzebowka"]),
  "denis.coins": "1240",
  "denis.howto": "1",
  "denis.healthWarn": "1",
};

const PLAY = (song, t, extra = {}) => ({
  song,
  scene: "play",
  state: {
    awaitingStart: false,
    paused: false,
    resumeAt: 0,
    songTime: t,
    combo: 48,
    maxCombo: 48,
    flow: 30,
    flowTier: 2,
    score: 184600,
    displayScore: 184600,
    health: 0.8,
    counts: { perfect: 92, great: 21, good: 4, miss: 2 },
    judgedCount: 119,
    accSum: 108,
    ...extra,
  },
});

const SHOTS = [
  { name: "01-slider-panna-mloda", scene: "hits", state: { hitIndex: 0 } },
  { name: "02-gra-panna-mloda", ...PLAY("panna-mloda", 53.1) },
  { name: "03-slider-ksiaze", scene: "hits", state: { hitIndex: 1 } },
  { name: "04-gra-pogrzebowka", ...PLAY("pogrzebowka", 110.2, { combo: 87, maxCombo: 87, flowTier: 3 }) },
  {
    name: "05-wynik",
    song: "panna-mloda",
    scene: "results",
    state: {
      score: 912400,
      parScore: 900000,
      resultRank: 3,
      resultStarSeen: 5,
      counts: { perfect: 231, great: 34, good: 6, miss: 3 },
      judgedCount: 274,
      accSum: 260,
      maxCombo: 188,
      maxFlow: 120,
      holdsDone: 0,
      holdsBroken: 0,
      newBest: true,
      coinsEarned: 120,
      resultPrevBest: 845300,
    },
    reveal: 6000,
  },
  { name: "06-nagrody", scene: "rewards" },
];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const d of DEVICES) {
  const out = `appstore-shots/${d.dir}`;
  fs.mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
  await ctx.addInitScript((st) => {
    for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v);
  }, STORAGE);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  page-err:", e.message));
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 25000 });
  await page.waitForTimeout(2500); // splash + grafiki menu

  for (const s of SHOTS) {
    await page.evaluate(async ({ song }) => {
      const g = window.__game;
      if (song && g.__shotSong !== song) {
        const { loadTrack } = await import("/src/tracks.ts");
        g.song = await loadTrack(song);
        g.trackId = song;
        g.loadSongBg?.(g.song.bg);
        g.character?.load?.({ character: g.song.character, characters: g.song.characters });
        g.__shotSong = song;
      }
    }, s);
    await page.waitForTimeout(1500); // tło utworu + arkusze postaci
    await page.evaluate(({ scene, state, reveal }) => {
      const g = window.__game;
      g.soundModal = false;
      g.healthModal = false;
      g.tutModal = false;
      // rozgrywka bez dźwięku: zamroź update(), żeby zegar audio nie nadpisał songTime
      if (!g.__origUpdate) g.__origUpdate = g.update;
      g.update = scene === "play" ? () => {} : g.__origUpdate;
      if (state) Object.assign(g, state);
      if (scene) g.scene = scene;
      if (scene === "results") g.resultsAt = performance.now() - (reveal || 6000);
    }, s);
    await page.waitForTimeout(900); // kilka klatek pętli (animacje, postać)
    await page.screenshot({ path: `${out}/${s.name}.png` });
    console.log("✓", d.dir, s.name);
  }
  await ctx.close();
}
await browser.close();
