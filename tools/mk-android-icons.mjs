// Ikony Androida z jednej grafiki (GooglePlay_512x512.png). Brak warstwowego
// źródła → foreground = cała grafika lekko wpuszczona w viewport z miękką
// krawędzią, tło = ciepły blask. Legacy mipmapy = grafika z zaokrąglonymi rogami.

import { PNG } from "pngjs";
import fs from "fs";

const SRC = "Materiały robocze/Ikony/Android_Icons/GooglePlay_512x512.png";
const src = PNG.sync.read(fs.readFileSync(SRC));
const W = src.width, H = src.height;
const px = (x, y, c) => src.data[(y * W + x) * 4 + c];

function sampleSrc(fx, fy) {
  fx = Math.max(0, Math.min(W - 1, fx));
  fy = Math.max(0, Math.min(H - 1, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const lerp = (a, b, t) => a + (b - a) * t;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = lerp(lerp(px(x0, y0, c), px(x1, y0, c), dx), lerp(px(x0, y1, c), px(x1, y1, c), dx), dy);
  }
  return out;
}

// foreground: grafika w `frac` viewportu, wyśrodkowana, miękka krawędź (feather)
function makeForeground(size, frac, featherFrac) {
  const out = new PNG({ width: size, height: size });
  out.data.fill(0);
  const draw = size * frac;
  const off = (size - draw) / 2;
  const feather = size * featherFrac;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const lx = x - off, ly = y - off;
      if (lx < 0 || ly < 0 || lx >= draw || ly >= draw) continue;
      const s = sampleSrc((lx / draw) * W, (ly / draw) * H);
      const edge = Math.min(lx, ly, draw - lx, draw - ly);
      const a = Math.max(0, Math.min(1, edge / feather));
      const di = (y * size + x) * 4;
      out.data[di] = s[0]; out.data[di + 1] = s[1]; out.data[di + 2] = s[2];
      out.data[di + 3] = Math.round(255 * a);
    }
  return PNG.sync.write(out);
}

function makeLegacy(size, radiusFrac) {
  const out = new PNG({ width: size, height: size });
  const r = size * radiusFrac;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const s = sampleSrc((x / size) * W, (y / size) * H);
      let a = 1;
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
      if (cx < r && cy < r) a = Math.max(0, Math.min(1, r - Math.hypot(r - cx, r - cy) + 0.5));
      const di = (y * size + x) * 4;
      out.data[di] = s[0]; out.data[di + 1] = s[1]; out.data[di + 2] = s[2]; out.data[di + 3] = 255 * a;
    }
  return PNG.sync.write(out);
}

const FG = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const LEG = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const base = "android/app/src/main/res";
for (const [dpi, size] of Object.entries(FG))
  fs.writeFileSync(`${base}/drawable-${dpi}/ic_launcher_foreground.png`, makeForeground(size, 0.92, 0.05));
for (const [dpi, size] of Object.entries(LEG)) {
  fs.writeFileSync(`${base}/mipmap-${dpi}/ic_launcher.png`, makeLegacy(size, 0.17));
  fs.writeFileSync(`${base}/mipmap-${dpi}/ic_launcher_round.png`, makeLegacy(size, 0.5));
}
console.log("ikony zapisane (foreground 92% + feather)");
