// Generuje beatmapę z pliku mp3 (detekcja onsetów w headless Chrome) i zapisuje
// public/charts/<id>.json z audioUrl + nutami. Wymaga dzialajacego dev serwera.
//
//   npm run dev        (w innym oknie, port 5180)
//   node tools/make-chart.mjs panna-mloda [bpm]
//
// Potem chart mozna recznie dostrajac / zrobic edytor. Postać (characters) i tło
// dokladamy tu na sztywno ponizej.

import { chromium } from "file:///D:/Projekty/disco-ranking/node_modules/playwright/index.mjs";
import fs from "node:fs";

const ID = process.argv[2] || "panna-mloda";
const BPM = Number(process.argv[3]) || 155;
const URL = "http://127.0.0.1:5180";
const AUDIO = `assets/songs/${ID}.mp3`;

// rotacja ujęć (te same co w tracks.ts) — do ustalenia docelowe sekundy
const characters = [];
const ujecia = [1, 2, 3, 4];
for (let t = 0, i = 0; t < 300; t += 4, i++) characters.push({ at: t, sprite: `assets/char/${ID}/ujecie${ujecia[i % 4]}` });

const b = await chromium.launch({ args: ["--no-sandbox"] });
const p = await b.newPage();
await p.goto(URL, { waitUntil: "commit" });
await p.waitForFunction(() => document.readyState === "complete", null, { timeout: 15000 });

const res = await p.evaluate(async ({ audio, bpm }) => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(await (await fetch(audio)).arrayBuffer());
  const sr = buf.sampleRate;
  const N = buf.length;
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;

  // energia w oknach + różnica dodatnia (prosty spectral-flux-lite)
  const HOP = 512;
  const WIN = 1024;
  const frames = Math.floor((N - WIN) / HOP);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const off = f * HOP;
    for (let i = 0; i < WIN; i++) { const v = mono[off + i]; s += v * v; }
    energy[f] = Math.sqrt(s / WIN);
  }
  // wygładzona średnia krocząca
  const avg = new Float32Array(frames);
  const W = 24;
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0;
    for (let k = -W; k <= W; k++) { const j = f + k; if (j >= 0 && j < frames) { s += energy[j]; c++; } }
    avg[f] = s / c;
  }
  // onsety: lokalne maksimum energii wyraźnie ponad średnią
  const tFrame = (f) => (f * HOP + WIN / 2) / sr;
  const raw = [];
  for (let f = 1; f < frames - 1; f++) {
    if (energy[f] > energy[f - 1] && energy[f] >= energy[f + 1] && energy[f] > avg[f] * 1.35 && energy[f] > 0.012) {
      raw.push({ t: tFrame(f), e: energy[f] });
    }
  }

  return { duration: buf.duration, sr, onsets: raw };
}, { audio: AUDIO, bpm: BPM });

await b.close();

const beat = 60 / BPM;
const grid = beat / 2; // ósemki
const lead = 2.4;
const tail = 1.0;
const end = res.duration - tail;

// 1. snap do siatki ósemek, usun duplikaty i za gęste (min 0.16 s odstęp)
let times = [];
for (const o of res.onsets) {
  if (o.t < lead || o.t > end) continue;
  const q = Math.round(o.t / grid) * grid;
  if (times.length && q - times[times.length - 1] < 0.16) continue;
  if (times.length && q === times[times.length - 1]) continue;
  times.push(q);
}
// 2. przerzedź do ~2 nut/s w każdym oknie sekundowym
const capped = [];
let winStart = times[0] ?? 0, winCnt = 0;
for (const t of times) {
  if (t - winStart >= 1) { winStart = t; winCnt = 0; }
  if (winCnt < 2) { capped.push(t); winCnt++; }
}

// 3. tory: przebieg po klawiszach, bez powtórki tego samego zbyt blisko
const PATTERN = [0, 1, 2, 3, 2, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1];
const notes = [];
let pi = 0, lastLane = -1, lastT = -10;
for (const t of capped) {
  let lane = PATTERN[pi++ % PATTERN.length];
  if (lane === lastLane && t - lastT < 0.35) lane = PATTERN[pi++ % PATTERN.length];
  notes.push({ lane, time: +t.toFixed(3), dur: 0 });
  lastLane = lane; lastT = t;
}

// 4. kilka nut trzymanych na „mocnych" taktach (co 8 beatów), jesli jest miejsce
for (let k = 0; k < notes.length; k++) {
  const onDown = Math.abs((notes[k].time - lead) % (beat * 4)) < 0.06;
  if (onDown && Math.random() < 0.5) {
    const next = notes[k + 1];
    if (!next || next.time - notes[k].time > beat * 1.5) notes[k].dur = +(beat * 1.5).toFixed(3);
  }
}

const chart = {
  id: ID,
  title: ID === "panna-mloda" ? "Panna Młoda" : ID,
  artist: "Denis",
  bpm: BPM,
  gridOffset: 0,
  duration: +res.duration.toFixed(2),
  audioUrl: AUDIO,
  characters,
  characterScale: 0.95,
  characterY: 704,
  notes,
};
fs.writeFileSync(`public/charts/${ID}.json`, JSON.stringify(chart, null, 2) + "\n");
console.log(`${ID}: dlugosc ${res.duration.toFixed(1)}s, onsetow ${res.onsets.length} -> nut ${notes.length} (${(notes.length / res.duration).toFixed(2)}/s), holdow ${notes.filter((n) => n.dur > 0).length}`);
console.log(`-> public/charts/${ID}.json`);
