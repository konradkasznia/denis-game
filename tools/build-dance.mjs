// Składa sprite sheet tańca z arkusza v2.png (rzędy z etykietami).
//   node tools/build-dance.mjs [nazwa-rzędu] [fps]
// domyślnie: DANCE_LOOP_2
import { PNG } from "pngjs";
import fs from "node:fs";

const SRC = "public/assets/char/pan-mlody/v2.png";
const OUT = "public/assets/char/pan-mlody";
const A_TH = 165; // próg alfy do wykrywania sylwetek (tnie mgłę/glow)
const ROW_ARG = (process.argv[2] || "2"); // "1","2","mic","turn"
const FPS = Number(process.argv[3]) || 13;

const ROWS = { "1": 0, "2": 1, mic: 2, turn: 3 }; // indeks rzędu z klatkami

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data: D } = png;
const A = (x, y) => D[(y * W + x) * 4 + 3];

// ---- connected components ----
const label = new Int32Array(W * H).fill(-1);
const comps = [];
const st = [];
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

// ---- rzędy z klatkami (sylwetki: duże i wysokie) ----
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

const rowIdx = ROWS[ROW_ARG] ?? 1;
const frameComps = rows[rowIdx]?.items ?? [];
console.log(`rzędy: ${rows.map((r) => r.items.length).join(", ")}  ->  wybrany rząd ${rowIdx}: ${frameComps.length} klatek`);
if (frameComps.length < 4) {
  console.error("za mało klatek — przerwane");
  process.exit(1);
}

// ---- maska: piksel należy do komponentu jeśli w promieniu 2px od jego label ----
const belongs = (gx, gy, id) => {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && label[ny * W + nx] === id) return true;
    }
  return false;
};

// ---- wspólna SKALA (jedna dla wszystkich klatek) + wyrównanie do podłogi ----
const heights = frameComps.map((c) => c.h).sort((a, b) => a - b);
const refH = heights[Math.floor(heights.length * 0.7)]; // 70. percentyl wysokości
const SCALE = 240 / refH; // ~2x upscale
const FRAME_W = 300;
const FRAME_H = 320;
const sheet = new PNG({ width: FRAME_W * frameComps.length, height: FRAME_H });

frameComps.forEach((c, fi) => {
  const scale = SCALE;
  const dw = Math.round(c.w * scale);
  const dh = Math.round(c.h * scale);
  const ox = fi * FRAME_W + Math.round((FRAME_W - dw) / 2);
  const oy = FRAME_H - dh - 6;
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const X = ox + dx, Y = oy + dy;
      if (X < 0 || Y < 0 || X >= sheet.width || Y >= FRAME_H) continue;
      // nearest-neighbour ze źródła (mały upscale, ostre krawędzie)
      const sx = Math.round(c.minX + dx / scale);
      const sy = Math.round(c.minY + dy / scale);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      if (!belongs(sx, sy, c.id)) continue;
      const si = (sy * W + sx) * 4;
      const di = (Y * sheet.width + X) * 4;
      sheet.data[di] = D[si];
      sheet.data[di + 1] = D[si + 1];
      sheet.data[di + 2] = D[si + 2];
      sheet.data[di + 3] = D[si + 3];
    }
  }
});

fs.writeFileSync(`${OUT}/dance.png`, PNG.sync.write(sheet));
fs.writeFileSync(
  `${OUT}/anim.json`,
  JSON.stringify(
    { type: "sheet", src: "dance.png", frames: frameComps.length, cols: frameComps.length, fps: FPS },
    null,
    2,
  ) + "\n",
);
console.log(`dance.png ${sheet.width}x${sheet.height}, ${frameComps.length} klatek @ ${FPS}fps`);
