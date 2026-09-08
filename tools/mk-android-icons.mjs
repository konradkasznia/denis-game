// Ikony Androida z przezroczystej głowy Denisa (`public/assets/ui/head.png`).
//
// Ikona adaptacyjna = DWIE warstwy:
//   • foreground — SAMA głowa, przezroczyste tło, w bezpiecznej strefie (~62%
//     płótna). Launcher przykrywa ją swoją maską (koło / squircle) i porusza
//     przy paralaksie — dlatego głowa NIE może dotykać krawędzi.
//   • background — ciepły pomarańcz (`drawable/ic_launcher_background.xml`).
// Legacy mipmapy (starszy Android / launchery bez adaptacyjnych) = gotowa
// kompozycja: pomarańczowy gradient + głowa, z zaokrągleniem / kołem.
//
// Uruchom: node tools/mk-android-icons.mjs

import { PNG } from "pngjs";
import fs from "fs";

const HEAD = PNG.sync.read(fs.readFileSync("public/assets/ui/head.png"));
const HW = HEAD.width;
const HH = HEAD.height;

/** Dwuliniowe próbkowanie głowy → [r,g,b,a] (0–255). Poza obrazem: alfa 0. */
function sampleHead(fx, fy) {
  if (fx < 0 || fy < 0 || fx > HW - 1 || fy > HH - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(HW - 1, x0 + 1);
  const y1 = Math.min(HH - 1, y0 + 1);
  const dx = fx - x0;
  const dy = fy - y0;
  const at = (x, y, c) => HEAD.data[(y * HW + x) * 4 + c];
  const lerp = (a, b, t) => a + (b - a) * t;
  const out = [];
  for (let c = 0; c < 4; c++) {
    out[c] = lerp(
      lerp(at(x0, y0, c), at(x1, y0, c), dx),
      lerp(at(x0, y1, c), at(x1, y1, c), dx),
      dy,
    );
  }
  return out;
}

/** Ciepły pomarańczowy blask (jak reflektory na renderze). */
function orangeBg(x, y, size) {
  const cx = size * 0.5;
  const cy = size * 0.44; // środek blasku lekko nad centrum
  const t = Math.min(1, Math.hypot(x - cx, y - cy) / (size * 0.72));
  const stops = [
    [0.0, [255, 214, 92]],
    [0.55, [240, 128, 26]],
    [1.0, [176, 46, 6]],
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const lt = (t - a[0]) / (b[0] - a[0] || 1);
  return [0, 1, 2].map((c) => a[1][c] + (b[1][c] - a[1][c]) * lt);
}

/** Głowa wpisana w kwadrat `headFrac × size`, wyśrodkowana (lekko podniesiona).
 *  Zwraca funkcję (x,y) → [r,g,b,a] próbki głowy w danym pikselu ikony. */
function headPlacer(size, headFrac, yNudge = -0.02) {
  const boxW = size * headFrac;
  const boxH = boxW * (HH / HW);
  const offX = (size - boxW) / 2;
  const offY = (size - boxH) / 2 + size * yNudge;
  return (x, y) => {
    const lx = (x - offX) / boxW;
    const ly = (y - offY) / boxH;
    if (lx < 0 || ly < 0 || lx > 1 || ly > 1) return [0, 0, 0, 0];
    return sampleHead(lx * (HW - 1), ly * (HH - 1));
  };
}

/** Foreground ikony adaptacyjnej — sama głowa, reszta przezroczysta. */
function makeForeground(size) {
  const out = new PNG({ width: size, height: size });
  out.data.fill(0);
  const head = headPlacer(size, 0.62);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = head(x, y);
      const di = (y * size + x) * 4;
      out.data[di] = s[0];
      out.data[di + 1] = s[1];
      out.data[di + 2] = s[2];
      out.data[di + 3] = Math.round(s[3]);
    }
  }
  return PNG.sync.write(out);
}

/** Legacy / store: pomarańczowe tło + głowa. `mask` = "round" | "rounded" | "none". */
function makeComposite(size, headFrac, mask) {
  const out = new PNG({ width: size, height: size });
  const head = headPlacer(size, headFrac);
  const r = size * 0.16; // promień zaokrąglenia rogów
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bg = orangeBg(x, y, size);
      const h = head(x, y);
      const ha = h[3] / 255;
      let rgb = [0, 1, 2].map((c) => bg[c] * (1 - ha) + h[c] * ha);
      let a = 255;
      if (mask === "round") {
        const d = Math.hypot(x - size / 2, y - size / 2);
        a = Math.max(0, Math.min(1, size / 2 - d + 0.5)) * 255;
      } else if (mask === "rounded") {
        const cx = Math.min(x, size - 1 - x);
        const cy = Math.min(y, size - 1 - y);
        if (cx < r && cy < r) {
          a = Math.max(0, Math.min(1, r - Math.hypot(r - cx, r - cy) + 0.5)) * 255;
        }
      }
      const di = (y * size + x) * 4;
      out.data[di] = rgb[0];
      out.data[di + 1] = rgb[1];
      out.data[di + 2] = rgb[2];
      out.data[di + 3] = a;
    }
  }
  return PNG.sync.write(out);
}

const FG = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const LEG = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const base = "android/app/src/main/res";

for (const [dpi, size] of Object.entries(FG)) {
  fs.writeFileSync(`${base}/drawable-${dpi}/ic_launcher_foreground.png`, makeForeground(size));
}
for (const [dpi, size] of Object.entries(LEG)) {
  fs.writeFileSync(`${base}/mipmap-${dpi}/ic_launcher.png`, makeComposite(size, 0.78, "rounded"));
  fs.writeFileSync(`${base}/mipmap-${dpi}/ic_launcher_round.png`, makeComposite(size, 0.78, "round"));
}
// ikona do Google Play (512×512, pełna, bez przezroczystości/zaokrągleń — Play dokłada)
fs.writeFileSync("Materiały robocze/Ikony/Android_Icons/GooglePlay_512x512.png", makeComposite(512, 0.74, "none"));

console.log("ikony Androida przebudowane z head.png (foreground = sama głowa 62%)");
