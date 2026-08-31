// Składa sprite sheet tańca z wyciętych póz.
//   node tools/build-dance.mjs
import { PNG } from "pngjs";
import fs from "node:fs";

const RAW = "public/assets/char/pan-mlody/raw";
const OUT = "public/assets/char/pan-mlody";

// wybrane pozy (mikrofon na statywie, przód, energiczne) — kolejność = groove
const SEQ = [1, 4, 2, 5, 3, 9];

const FRAME_W = 460;
const FRAME_H = 600;
const CHAR_H = 540; // docelowa wysokość postaci (bbox) po skalowaniu
const FPS = 5;

function contentBox(png, thresh = 110) {
  const { width: w, height: h, data: d } = png;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > thresh) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// bilinearne próbkowanie źródła do (sx,sy) w przestrzeni źródła
function sample(png, sx, sy) {
  const { width: w, height: h, data: d } = png;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = sx - x0, fy = sy - y0;
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return [0, 0, 0, 0];
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  };
  const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), e = at(x1, y1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = a[k] * (1 - fx) + b[k] * fx;
    const bot = c[k] * (1 - fx) + e[k] * fx;
    out[k] = top * (1 - fy) + bot * fy;
  }
  return out;
}

const frames = SEQ.map((n) => {
  const p = PNG.sync.read(fs.readFileSync(`${RAW}/pose-${String(n).padStart(2, "0")}.png`));
  return { png: p, box: contentBox(p) };
});

const sheet = new PNG({ width: FRAME_W * frames.length, height: FRAME_H });

frames.forEach(({ png, box }, fi) => {
  const scale = CHAR_H / box.h;
  const drawW = Math.round(box.w * scale);
  const drawH = Math.round(box.h * scale);
  const ox = fi * FRAME_W + Math.round((FRAME_W - drawW) / 2);
  const oy = FRAME_H - drawH - 8; // wyrównanie do „podłogi"

  for (let dy = 0; dy < drawH; dy++) {
    for (let dx = 0; dx < drawW; dx++) {
      const X = ox + dx, Y = oy + dy;
      if (X < 0 || Y < 0 || X >= sheet.width || Y >= FRAME_H) continue;
      const sx = box.minX + dx / scale;
      const sy = box.minY + dy / scale;
      const [r, g, b, a] = sample(png, sx, sy);
      if (a < 3) continue;
      const idx = (Y * sheet.width + X) * 4;
      sheet.data[idx] = r;
      sheet.data[idx + 1] = g;
      sheet.data[idx + 2] = b;
      sheet.data[idx + 3] = a;
    }
  }
});

fs.writeFileSync(`${OUT}/dance.png`, PNG.sync.write(sheet));
fs.writeFileSync(
  `${OUT}/anim.json`,
  JSON.stringify(
    { type: "sheet", src: "dance.png", frames: frames.length, cols: frames.length, fps: FPS },
    null,
    2,
  ) + "\n",
);
console.log(
  `dance.png ${sheet.width}x${sheet.height}, ${frames.length} klatek @ ${FPS}fps -> ${OUT}/`,
);
