// Buduje sprite sheet tańca postaci -> public/assets/char/pan-mlody/{dance.png,anim.json}
//
// Wejście (w kolejności preferencji):
//   newkit.png  — model sheet na jednolitym tle (usuwamy tło kolorem)
//   v2.png      — arkusz z kanałem alfa (rzędy z klatkami)
//
//   node tools/build-dance.mjs [fps] [row]
import { PNG } from "pngjs";
import fs from "node:fs";

const DIR = "public/assets/char/pan-mlody";
const FPS = Number(process.argv[2]) || 8;
const ROW = process.argv[3] || "2"; // tylko dla v2.png

const hasNew = fs.existsSync(`${DIR}/newkit.png`);
const src = hasNew ? `${DIR}/newkit.png` : `${DIR}/v2.png`;
const png = PNG.sync.read(fs.readFileSync(src));
const { width: W, height: H, data: D } = png;
console.log(`źródło: ${src} (${W}x${H})`);

// ---------- 1. maska alfa ----------
if (hasNew) {
  // tło = kolor z rogów; flood-fill od krawędzi, usuń podobne
  const bg = [D[0], D[1], D[2]];
  const T = 30;
  const near = (i) => {
    const dr = D[i] - bg[0], dg = D[i + 1] - bg[1], db = D[i + 2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) < T;
  };
  const isBg = new Uint8Array(W * H);
  const q = [];
  for (let x = 0; x < W; x++) {
    q.push(x, (H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    q.push(y * W, y * W + W - 1);
  }
  while (q.length) {
    const p = q.pop();
    if (isBg[p] || !near(p * 4)) continue;
    isBg[p] = 1;
    const px = p % W, py = (p / W) | 0;
    if (px > 0) q.push(p - 1);
    if (px < W - 1) q.push(p + 1);
    if (py > 0) q.push(p - W);
    if (py < H - 1) q.push(p + W);
  }
  for (let p = 0; p < W * H; p++) D[p * 4 + 3] = isBg[p] ? 0 : 255;
  // erozja 1px — zjada białą obwódkę po szarym tle
  const er = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (D[p * 4 + 3] === 0) continue;
      if (
        D[(p - 1) * 4 + 3] === 0 ||
        D[(p + 1) * 4 + 3] === 0 ||
        D[(p - W) * 4 + 3] === 0 ||
        D[(p + W) * 4 + 3] === 0
      )
        er[p] = 1;
    }
  }
  for (let p = 0; p < W * H; p++) if (er[p]) D[p * 4 + 3] = 0;
  // feather: 3x3 box blur na alfie
  const a0 = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) a0[p] = D[p * 4 + 3];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a0[(y + dy) * W + (x + dx)];
      D[(y * W + x) * 4 + 3] = (s / 9) | 0;
    }
  }
}

// ---------- 2. connected components ----------
const A_TH = hasNew ? 40 : 165;
const label = new Int32Array(W * H).fill(-1);
const comps = [];
const st = [];
const A = (x, y) => D[(y * W + x) * 4 + 3];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (label[idx] !== -1 || A(x, y) < A_TH) continue;
    const id = comps.length;
    let a = x, b = x, c = y, e = y, n = 0;
    st.push(idx);
    label[idx] = id;
    while (st.length) {
      const p = st.pop();
      const px = p % W, py = (p / W) | 0;
      n++;
      if (px < a) a = px;
      if (px > b) b = px;
      if (py < c) c = py;
      if (py > e) e = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (label[ni] === -1 && A(nx, ny) >= A_TH) {
          label[ni] = id;
          st.push(ni);
        }
      }
    }
    comps.push({ id, minX: a, minY: c, maxX: b, maxY: e, w: b - a + 1, h: e - c + 1, n });
  }
}

// ---------- 3. wybór klatek ----------
let frames;
if (hasNew) {
  // 5 dużych sylwetek w rzędzie
  frames = comps.filter((c) => c.n > 8000 && c.h > H * 0.4).sort((a, b) => a.minX - b.minX);
} else {
  const chars = comps.filter((c) => c.n > 1200 && c.h > 90);
  chars.sort((x, y) => x.minY + x.maxY - (y.minY + y.maxY));
  const rows = [];
  for (const c of chars) {
    const cy = (c.minY + c.maxY) / 2;
    let r = rows.find((r) => Math.abs(r.cy - cy) < 70);
    if (!r) {
      r = { cy, items: [] };
      rows.push(r);
    }
    r.items.push(c);
    r.cy = r.items.reduce((s, i) => s + (i.minY + i.maxY) / 2, 0) / r.items.length;
  }
  rows.forEach((r) => r.items.sort((a, b) => a.minX - b.minX));
  const map = { "1": 0, "2": 1, mic: 2, turn: 3 };
  frames = rows[map[ROW] ?? 1]?.items ?? [];
}
console.log(`klatek: ${frames.length}  (${frames.map((c) => `${c.w}×${c.h}`).join("  ")})`);
if (frames.length < 3) {
  console.error("za mało klatek");
  process.exit(1);
}

// ---------- 4. maska własnego sprite'a + wspólna skala + podłoga ----------
const belongs = (gx, gy, id) => {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && label[ny * W + nx] === id) return true;
    }
  return false;
};
const heights = frames.map((c) => c.h).sort((a, b) => a - b);
const refH = heights[Math.floor(heights.length * 0.6)];
const CONTENT_H = 520; // docelowa wysokość sylwetki w klatce
const SCALE = CONTENT_H / refH;
const FRAME_W = 460;
const FRAME_H = 620;

// ping-pong: 1,2,3,4,5,4,3,2 -> płynna pętla bez skoku
const order =
  hasNew && frames.length >= 3
    ? [...frames.keys(), ...[...frames.keys()].slice(1, -1).reverse()]
    : [...frames.keys()];
const seqFrames = order.map((i) => frames[i]);

const sheet = new PNG({ width: FRAME_W * seqFrames.length, height: FRAME_H });

seqFrames.forEach((c, fi) => {
  const dw = Math.round(c.w * SCALE);
  const dh = Math.round(c.h * SCALE);
  const ox = fi * FRAME_W + Math.round((FRAME_W - dw) / 2);
  const oy = FRAME_H - dh - 8;
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const X = ox + dx, Y = oy + dy;
      if (X < 0 || Y < 0 || X >= sheet.width || Y >= FRAME_H) continue;
      // bilinearne próbkowanie
      const fx = c.minX + dx / SCALE, fy = c.minY + dy / SCALE;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) continue;
      if (!belongs(Math.round(fx), Math.round(fy), c.id)) continue;
      const tx = fx - x0, ty = fy - y0;
      const at = (X2, Y2) => {
        const i = (Y2 * W + X2) * 4;
        return [D[i], D[i + 1], D[i + 2], D[i + 3]];
      };
      const p00 = at(x0, y0), p10 = at(x1, y0), p01 = at(x0, y1), p11 = at(x1, y1);
      const di = (Y * sheet.width + X) * 4;
      for (let k = 0; k < 4; k++) {
        const top = p00[k] * (1 - tx) + p10[k] * tx;
        const bot = p01[k] * (1 - tx) + p11[k] * tx;
        sheet.data[di + k] = Math.round(top * (1 - ty) + bot * ty);
      }
    }
  }
});

fs.writeFileSync(`${DIR}/dance.png`, PNG.sync.write(sheet));
fs.writeFileSync(
  `${DIR}/anim.json`,
  JSON.stringify(
    { type: "sheet", src: "dance.png", frames: seqFrames.length, cols: seqFrames.length, fps: FPS },
    null,
    2,
  ) + "\n",
);
console.log(`dance.png ${sheet.width}x${sheet.height}, ${seqFrames.length} klatek @ ${FPS}fps`);
