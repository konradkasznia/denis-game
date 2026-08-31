// Buduje sprite sheet tańca -> public/assets/char/pan-mlody/{dance.png,anim.json}
// + podgląd GIF -> dance-preview.gif
//
// Wrzuć plik źródłowy jako:  public/assets/char/pan-mlody/src.png
//
//   node tools/build-dance.mjs [fps] [frames]
//     fps     — klatki/s (domyślnie 14)
//     frames  — ile klatek w pasku (domyślnie 21)
//
// PASEK (jeden rząd, wąski): tnie na N klatek i KOTWICZY każdą po głowie
// (środek głowy -> zawsze ten sam X, czubek głowy -> zawsze ten sam Y).
// Dzięki temu głowa stoi w miejscu, a nogi/ręce robią taniec. Bez skalowania.

import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from "node:fs";

const DIR = "public/assets/char/pan-mlody";
const SRC = `${DIR}/src.png`;
const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data: D } = png;
const A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : D[(y * W + x) * 4 + 3]);

const FPS = Number(process.argv[2]) || 14;
const N = Number(process.argv[3]) || 21;

// --- przytnij puste marginesy ---
const colInk = (x) => {
  let s = 0;
  for (let y = 0; y < H; y++) s += A(x, y) > 12 ? 1 : 0;
  return s;
};
let x0 = 0, x1 = W - 1;
while (x0 < W && colInk(x0) < 2) x0++;
while (x1 > x0 && colInk(x1) < 2) x1--;
const span = x1 - x0 + 1;
const pitch = span / N;
console.log(`${SRC} ${W}x${H} | tresc ${x0}..${x1} | ${N} klatek po ${pitch.toFixed(1)}px @ ${FPS}fps`);

const A_TH = 55;
const FLOOR_MARGIN = 6;
const med = (arr) => arr.slice().sort((a, b) => a - b)[arr.length >> 1];

// --- 1. wykryj GŁOWY: kolumny, w których tusz zaczyna się wysoko ---
const topInk = new Int32Array(W).fill(9999);
for (let x = 0; x < W; x++) {
  for (let y = 0; y < H; y++) if (A(x, y) >= A_TH) { topInk[x] = y; break; }
}
const globalTop = Math.min(...topInk.filter((v) => v < 9999));
let headRuns = [];
{
  let inR = false, st = 0;
  for (let x = 0; x <= W; x++) {
    const isHead = x < W && topInk[x] <= globalTop + 20;
    if (isHead && !inR) { inR = true; st = x; }
    else if (!isHead && inR) { inR = false; if (x - st >= 22) headRuns.push([st, x - 1]); }
  }
}
// scal bliskie, potem rozbij zbyt szerokie na równe części
headRuns = headRuns.reduce((acc, r) => {
  const p = acc[acc.length - 1];
  if (p && r[0] - p[1] < 8) p[1] = r[1];
  else acc.push(r.slice());
  return acc;
}, []);
const medHW = med(headRuns.map((r) => r[1] - r[0]));
const heads = [];
for (const [a, b] of headRuns) {
  const w = b - a;
  const parts = Math.max(1, Math.round((w + 6) / (medHW + 6)));
  for (let k = 0; k < parts; k++) {
    const pa = a + (w * k) / parts, pb = a + (w * (k + 1)) / parts;
    // centroid tuszu w tym wycinku głowy
    let sx = 0, cnt = 0, top = 9999;
    for (let x = Math.round(pa); x <= Math.round(pb); x++) {
      if (topInk[x] > globalTop + 20) continue;
      if (topInk[x] < top) top = topInk[x];
      for (let y = topInk[x]; y < topInk[x] + 30 && y < H; y++) if (A(x, y) >= A_TH) { sx += x; cnt++; }
    }
    if (cnt > 40) heads.push({ cx: sx / cnt, top: top === 9999 ? globalTop : top });
  }
}
heads.sort((p, q) => p.cx - q.cx);
console.log(`wykryto glów: ${heads.length}`);

// --- 2. dla każdej głowy: lokalny flood od głowy w dół, przycięty do ~pitch ---
const CROP = Math.round(pitch * 1.02);
const frames = heads.map((hd) => {
  const cx = Math.round(hd.cx);
  const wl = cx - Math.round(CROP / 2), wr = cx + Math.round(CROP / 2);
  const seen = new Set();
  const q = [];
  for (let x = cx - 5; x <= cx + 5; x++)
    for (let y = hd.top; y < hd.top + 48 && y < H; y++)
      if (A(x, y) >= A_TH) { const k = y * W + x; if (!seen.has(k)) { seen.add(k); q.push(k); } }
  let mnX = W, mxX = 0, mnY = H, mxY = 0;
  while (q.length) {
    const p = q.pop();
    const px = p % W, py = (p / W) | 0;
    if (px < mnX) mnX = px;
    if (px > mxX) mxX = px;
    if (py < mnY) mnY = py;
    if (py > mxY) mxY = py;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = px + dx, ny = py + dy;
      if (nx < wl || nx > wr || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (!seen.has(ni) && A(nx, ny) >= A_TH) { seen.add(ni); q.push(ni); }
    }
  }
  // usuń odpryski przy krawędziach okna (stopa/mikrofon sąsiada):
  // zostaw tylko główne, ciągłe pasmo kolumn wokół środka głowy
  const colCnt = new Int32Array(W);
  for (const k of seen) colCnt[k % W]++;
  const hc = Math.round(hd.cx);
  let L = hc, R = hc;
  while (L - 1 >= wl && colCnt[L - 1] >= 2) L--;
  while (R + 1 <= wr && colCnt[R + 1] >= 2) R++;
  for (const k of [...seen]) {
    const x = k % W;
    if (x < L - 1 || x > R + 1) seen.delete(k);
  }
  mnX = Math.max(mnX, L - 1);
  mxX = Math.min(mxX, R + 1);
  return { seen, minX: mnX, maxX: mxX, minY: mnY, maxY: mxY, headTop: mnY, headCx: hd.cx, wl, wr };
});

// --- 3. odrzuć zepsute (sklejone / przycięte) ---
const mw = med(frames.map((f) => f.maxX - f.minX));
const mh = med(frames.map((f) => f.maxY - f.minY));
let kept = frames.map((f, i) => {
  const w = f.maxX - f.minX, h = f.maxY - f.minY;
  const touchesEdge = f.minX <= f.wl + 1 && f.maxX >= f.wr - 1; // wypełnia całe okno = sklejka
  const bad = w > mw * 1.4 || w < mw * 0.5 || h < mh * 0.72 || (touchesEdge && w > mw * 1.25);
  return bad ? null : { f, i };
}).filter(Boolean);
console.log(`odrzucono: ${frames.length - kept.length} (mediana ${mw}x${mh}px)`);
const seq = kept.map((k) => k.i);
const valid = kept.map((k) => k.f);
console.log(`klatek do animacji: ${valid.length}/${frames.length}  [${seq.join(",")}]`);

// --- wspólny układ klatki wyjściowej ---
const SCALE = 3.1; // powiększenie całości (bez zmiany proporcji, to samo dla wszystkich)
const maxLeft = Math.max(...valid.map((f) => f.headCx - f.minX));
const maxRight = Math.max(...valid.map((f) => f.maxX - f.headCx));
const maxDown = Math.max(...valid.map((f) => f.maxY - f.headTop));
const ANCHOR_X = Math.ceil((maxLeft + 4) * SCALE);
const ANCHOR_Y = Math.ceil(8 * SCALE);
const FRAME_W = ANCHOR_X + Math.ceil((maxRight + 4) * SCALE);
const FRAME_H = ANCHOR_Y + Math.ceil((maxDown + FLOOR_MARGIN) * SCALE);

const NF = valid.length;
const sheet = new PNG({ width: FRAME_W * NF, height: FRAME_H, fill: true });
sheet.data.fill(0);

valid.forEach((f, fi) => {
  const baseX = fi * FRAME_W + ANCHOR_X;
  const baseY = ANCHOR_Y;
  // iteruj po docelowych pikselach, próbkuj źródło (nearest) tylko z własnych komponentów
  const dwL = Math.ceil((f.headCx - f.minX) * SCALE);
  const dwR = Math.ceil((f.maxX - f.headCx) * SCALE);
  const dh = Math.ceil((f.maxY - f.headTop) * SCALE) + 2;
  for (let dy = -2; dy < dh; dy++) {
    for (let dx = -dwL - 2; dx <= dwR + 2; dx++) {
      const srcX = Math.round(f.headCx + dx / SCALE);
      const srcY = Math.round(f.headTop + dy / SCALE);
      if (srcX < 0 || srcY < 0 || srcX >= W || srcY >= H) continue;
      if (!f.seen.has(srcY * W + srcX)) continue;
      const X = baseX + dx, Y = baseY + dy;
      if (X < 0 || Y < 0 || X >= sheet.width || Y >= FRAME_H) continue;
      const si = (srcY * W + srcX) * 4;
      const di = (Y * sheet.width + X) * 4;
      sheet.data[di] = D[si];
      sheet.data[di + 1] = D[si + 1];
      sheet.data[di + 2] = D[si + 2];
      sheet.data[di + 3] = D[si + 3];
    }
  }
});

fs.writeFileSync(`${DIR}/dance.png`, PNG.sync.write(sheet));
fs.writeFileSync(
  `${DIR}/anim.json`,
  JSON.stringify({ type: "sheet", src: "dance.png", frames: NF, cols: NF, fps: FPS }, null, 2) + "\n",
);
console.log(`dance.png ${sheet.width}x${sheet.height} (${FRAME_W}x${FRAME_H} /klatka)`);

// ---------- podgląd GIF ----------
{
  const PW = 300, PH = Math.round((FRAME_H / FRAME_W) * PW);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / FPS);
  for (let fi = 0; fi < NF; fi++) {
    const rgba = new Uint8Array(PW * PH * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 18; rgba[i + 1] = 16; rgba[i + 2] = 26; rgba[i + 3] = 255;
    }
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const sx = fi * FRAME_W + Math.round((x / PW) * FRAME_W);
        const sy = Math.round((y / PH) * FRAME_H);
        if (sx >= sheet.width || sy >= sheet.height) continue;
        const si = (sy * sheet.width + sx) * 4;
        const a = sheet.data[si + 3] / 255;
        if (a <= 0.02) continue;
        const di = (y * PW + x) * 4;
        rgba[di] = sheet.data[si] * a + rgba[di] * (1 - a);
        rgba[di + 1] = sheet.data[si + 1] * a + rgba[di + 1] * (1 - a);
        rgba[di + 2] = sheet.data[si + 2] * a + rgba[di + 2] * (1 - a);
      }
    }
    const pal = quantize(rgba, 256);
    const idx = applyPalette(rgba, pal);
    gif.writeFrame(idx, PW, PH, { palette: pal, delay });
  }
  gif.finish();
  fs.writeFileSync(`${DIR}/dance-preview.gif`, gif.bytes());
  console.log(`dance-preview.gif ${PW}x${PH}`);
}
