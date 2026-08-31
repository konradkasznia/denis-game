// Tnie zestaw postaci (kit.png) na osobne sprite'y + składa sprite sheet tańca.
//   node tools/slice-kit.mjs
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";

const SRC = "public/assets/char/pan-mlody/kit.png";
const OUTDIR = "public/assets/char/pan-mlody";
const A_THRESH = 175; // alfa powyżej = „solidny" piksel (wysoko = tnie glow, rozdziela sąsiadów)

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data: D } = png;
const A = (x, y) => D[(y * W + x) * 4 + 3];

// ---- flood-fill connected components ----
const label = new Int32Array(W * H).fill(-1);
const comps = [];
const stack = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (label[idx] !== -1 || A(x, y) < A_THRESH) continue;
    const id = comps.length;
    let minX = x, maxX = x, minY = y, maxY = y, count = 0;
    stack.push(idx);
    label[idx] = id;
    while (stack.length) {
      const p = stack.pop();
      const px = p % W, py = (p / W) | 0;
      count++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (label[ni] === -1 && A(nx, ny) >= A_THRESH) {
          label[ni] = id;
          stack.push(ni);
        }
      }
    }
    comps.push({ id, minX, minY, maxX, maxY, count, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
}

// ---- podział na wiersze wg środka Y ----
comps.sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY));
const rows = [];
for (const c of comps) {
  const cy = (c.minY + c.maxY) / 2;
  let row = rows.find((r) => Math.abs(r.cy - cy) < 90);
  if (!row) {
    row = { cy, items: [] };
    rows.push(row);
  }
  row.items.push(c);
  row.cy = row.items.reduce((s, i) => s + (i.minY + i.maxY) / 2, 0) / row.items.length;
}
rows.forEach((r) => r.items.sort((a, b) => a.minX - b.minX));

console.log(`obraz ${W}x${H}, komponentów: ${comps.length}, wierszy: ${rows.length}\n`);
rows.forEach((r, i) => {
  const big = r.items.filter((c) => c.count > 1500);
  console.log(
    `wiersz ${i} (y≈${Math.round(r.cy)}): ${r.items.length} elem. (${big.length} dużych), ` +
      `rozmiary: ${big.map((c) => `${c.w}×${c.h}`).join("  ")}`,
  );
});

// ---- zapis pojedynczych sprite'ów z 2 pierwszych wierszy (pozy całej sylwetki) ----
const bodyRows = rows.slice(0, 2);
const poses = bodyRows.flatMap((r) => r.items.filter((c) => c.count > 4000 && c.h > 200));
console.log(`\npozy sylwetki: ${poses.length}`);

fs.mkdirSync(path.join(OUTDIR, "raw"), { recursive: true });
// maska: piksel należy do komponentu, jeśli jego label == id ALBO jest w promieniu
// kilku px od takiego piksela (żeby zachować miękką obwódkę własnego sprite'a)
const belongs = (gx, gy, id) => {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (label[ny * W + nx] === id) return true;
    }
  }
  return false;
};
const crop = (c, pad = 6) => {
  const x0 = Math.max(0, c.minX - pad), y0 = Math.max(0, c.minY - pad);
  const x1 = Math.min(W, c.maxX + 1 + pad), y1 = Math.min(H, c.maxY + 1 + pad);
  const cw = x1 - x0, ch = y1 - y0;
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const gx = x0 + x, gy = y0 + y;
      const si = (gy * W + gx) * 4;
      const di = (y * cw + x) * 4;
      const own = belongs(gx, gy, c.id);
      out.data[di] = D[si];
      out.data[di + 1] = D[si + 1];
      out.data[di + 2] = D[si + 2];
      out.data[di + 3] = own ? D[si + 3] : 0; // obce piksele -> przezroczyste
    }
  }
  return out;
};

poses.forEach((c, i) => {
  const n = String(i + 1).padStart(2, "0");
  fs.writeFileSync(path.join(OUTDIR, "raw", `pose-${n}.png`), PNG.sync.write(crop(c)));
});
console.log(`zapisano ${poses.length} plików do ${OUTDIR}/raw/`);
