// Podglad animacji postaci jako GIF -> public/assets/char/<utwor>/dance-preview.gif
// Czyta anim.json (w tym frameMs / holds), obsluguje "sheet" i "frames".
//
//   node tools/preview.mjs [utwor]     (domyslnie: pan-mlody)

import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from "node:fs";

const ID = process.argv[2] || "pan-mlody";
const DIR = `public/assets/char/${ID}`;
const meta = JSON.parse(fs.readFileSync(`${DIR}/anim.json`, "utf8"));
const N = meta.frames;
const type = meta.type ?? "sheet";

// --- wczytaj klatki jako RGBA ---
let FW, FH, frameRGBA;
if (type === "frames") {
  const pad = meta.pad ?? 0;
  frameRGBA = [];
  for (let i = 1; i <= N; i++) {
    const n = pad ? String(i).padStart(pad, "0") : String(i);
    const p = PNG.sync.read(fs.readFileSync(`${DIR}/${meta.src.replace("{}", n)}`));
    if (i === 1) { FW = p.width; FH = p.height; }
    frameRGBA.push(p);
  }
} else {
  const sheet = PNG.sync.read(fs.readFileSync(`${DIR}/${meta.src}`));
  const cols = meta.cols ?? N;
  const rows = meta.rows ?? Math.ceil(N / cols);
  FW = sheet.width / cols;
  FH = sheet.height / rows;
  frameRGBA = [];
  for (let f = 0; f < N; f++) {
    const ox = (f % cols) * FW, oy = Math.floor(f / cols) * FH;
    const p = new PNG({ width: Math.round(FW), height: Math.round(FH) });
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const si = ((oy + y) * sheet.width + (ox + x)) * 4;
        const di = (y * p.width + x) * 4;
        p.data[di] = sheet.data[si];
        p.data[di + 1] = sheet.data[si + 1];
        p.data[di + 2] = sheet.data[si + 2];
        p.data[di + 3] = sheet.data[si + 3];
      }
    frameRGBA.push(p);
  }
}

// --- czasy klatek (ms) ---
const base = 1000 / (meta.fps || 12);
let durs;
const steps = meta.sequence?.length ?? N;
if (meta.frameMs?.length === steps) durs = meta.frameMs.slice();
else if (meta.holds?.length === steps) durs = meta.holds.map((h) => Math.max(1, h) * base);
else durs = Array(steps).fill(base);
const cellSeq = meta.sequence ?? [...Array(N).keys()];
console.log(`${ID}: ${type}, ${N} unikalnych klatek, ${steps} krokow, petla ${(durs.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`);
console.log(`  czasy: [${durs.map((d) => Math.round(d)).join(", ")}] ms`);

// --- render GIF ---
const PW = 300;
const PH = Math.round((FH / FW) * PW);
const gif = GIFEncoder();
for (let f = 0; f < steps; f++) {
  const src = frameRGBA[cellSeq[f]];
  const rgba = new Uint8Array(PW * PH * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 18; rgba[i + 1] = 16; rgba[i + 2] = 26; rgba[i + 3] = 255; }
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const sx = Math.round((x / PW) * src.width);
      const sy = Math.round((y / PH) * src.height);
      if (sx >= src.width || sy >= src.height) continue;
      const si = (sy * src.width + sx) * 4;
      const a = src.data[si + 3] / 255;
      if (a <= 0.02) continue;
      const di = (y * PW + x) * 4;
      rgba[di] = src.data[si] * a + rgba[di] * (1 - a);
      rgba[di + 1] = src.data[si + 1] * a + rgba[di + 1] * (1 - a);
      rgba[di + 2] = src.data[si + 2] * a + rgba[di + 2] * (1 - a);
    }
  const pal = quantize(rgba, 256);
  const idx = applyPalette(rgba, pal);
  gif.writeFrame(idx, PW, PH, { palette: pal, delay: Math.max(20, Math.round(durs[f])) });
}
gif.finish();
fs.writeFileSync(`${DIR}/dance-preview.gif`, gif.bytes());
console.log(`-> ${DIR}/dance-preview.gif  ${PW}x${PH}`);
