// Sklada animacje postaci z LUZNYCH PNG-ow + Twojej listy czasow.
//
//   1. Wrzuc klatki do:   public/assets/char/<utwor>/raw/
//      (dowolne nazwy; sortowane naturalnie: 1.png, 2.png, 10.png ...)
//   2. Czasy klatek podaj w:  public/assets/char/<utwor>/raw/times.txt
//      Jedna linia = jedna klatka, w kolejnosci plikow. Wystarczy liczba ms:
//         800
//         90
//         90
//      Albo z nazwa pliku (kolejnosc/pominiecia dowolne):
//         pose-01.png 800
//         pose-02.png = 90
//         # komentarz, puste linie ignorowane
//         * 100          <- domyslny czas dla niewymienionych
//      Brak times.txt -> wszystkie klatki po 100 ms.
//   3.  node tools/build-frames.mjs <utwor>
//
// Wynik: public/assets/char/<utwor>/{dance.png, anim.json, dance-preview.gif}
//
// Wyrownanie: jesli wszystkie PNG maja ten sam rozmiar -> uklada 1:1 (ufa Twojemu
// wyrownaniu). Jesli rozne -> kotwiczy po GLOWIE (czubek + srodek w tym samym
// miejscu na kazdej klatce), zeby postac nie skakala.

import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from "node:fs";

const ID = process.argv[2] || "pan-mlody";
const DIR = `public/assets/char/${ID}`;
const RAW = `${DIR}/raw`;
if (!fs.existsSync(RAW)) {
  console.error(`Brak folderu ${RAW}/ - wrzuc tam PNG-i i times.txt`);
  process.exit(1);
}

const files = fs
  .readdirSync(RAW)
  .filter((f) => /\.png$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!files.length) { console.error(`Brak PNG w ${RAW}/`); process.exit(1); }

// --- czasy ---
let times = files.map(() => 100);
const tPath = `${RAW}/times.txt`;
if (fs.existsSync(tPath)) {
  const lines = fs.readFileSync(tPath, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const byName = {};
  const positional = [];
  let deflt = null;
  for (const l of lines) {
    const m = l.match(/^(.*?)\s*[:=]?\s*(\d+)\s*(ms)?$/i);
    if (!m) continue;
    const key = m[1].trim();
    const ms = Number(m[2]);
    if (!key) positional.push(ms);
    else if (key === "*") deflt = ms;
    else byName[key.toLowerCase()] = ms;
  }
  const named = Object.keys(byName).length > 0;
  times = files.map((f, i) => {
    if (named) return byName[f.toLowerCase()] ?? deflt ?? 100;
    return positional[i] ?? deflt ?? positional[positional.length - 1] ?? 100;
  });
}
times = times.map((t) => Math.max(20, Math.round(t)));

// --- wczytaj PNG-i ---
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(`${RAW}/${f}`)));
const sameSize = imgs.every((p) => p.width === imgs[0].width && p.height === imgs[0].height);
const N = imgs.length;
console.log(`${ID}: ${N} klatek | ${sameSize ? "ten sam rozmiar -> 1:1" : "rozne rozmiary -> kotwica po glowie"}`);
console.log(`  czasy: [${times.join(", ")}] ms  (petla ${(times.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s)`);

// --- wyznacz kotwice (czubek + srodek glowy) dla trybu "rozne rozmiary" ---
const A_TH = 40;
function head(p) {
  const { width: W, height: H, data: D } = p;
  let top = H;
  for (let y = 0; y < H && top === H; y++)
    for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] >= A_TH) { top = y; break; }
  let sx = 0, cnt = 0;
  for (let y = top; y < Math.min(H, top + Math.round(H * 0.28)); y++)
    for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] >= A_TH) { sx += x; cnt++; }
  return { top, cx: cnt ? sx / cnt : W / 2 };
}

let FW, FH, place; // place(i) -> {ox, oy} lewy-gorny rog klatki i w jej komorce
if (sameSize) {
  FW = imgs[0].width;
  FH = imgs[0].height;
  place = () => ({ ox: 0, oy: 0 });
} else {
  const hs = imgs.map(head);
  const left = Math.max(...imgs.map((p, i) => hs[i].cx));
  const right = Math.max(...imgs.map((p, i) => p.width - hs[i].cx));
  const down = Math.max(...imgs.map((p, i) => p.height - hs[i].top));
  const PAD = 8;
  FW = Math.ceil(left + right) + PAD * 2;
  FH = Math.ceil(8 + down) + PAD;
  const anchorX = Math.ceil(left) + PAD;
  place = (i) => ({ ox: Math.round(anchorX - hs[i].cx), oy: Math.round(8 - hs[i].top) });
}

// --- zloz arkusz ---
const sheet = new PNG({ width: FW * N, height: FH });
sheet.data.fill(0);
imgs.forEach((p, i) => {
  const { ox, oy } = place(i);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const X = i * FW + ox + x, Y = oy + y;
      if (X < i * FW || X >= (i + 1) * FW || Y < 0 || Y >= FH) continue;
      const si = (y * p.width + x) * 4;
      const di = (Y * sheet.width + X) * 4;
      sheet.data[di] = p.data[si];
      sheet.data[di + 1] = p.data[si + 1];
      sheet.data[di + 2] = p.data[si + 2];
      sheet.data[di + 3] = p.data[si + 3];
    }
});

fs.writeFileSync(`${DIR}/dance.png`, PNG.sync.write(sheet));
const avgFps = Math.round(1000 / (times.reduce((a, b) => a + b, 0) / N));
fs.writeFileSync(
  `${DIR}/anim.json`,
  JSON.stringify({ type: "sheet", src: "dance.png", frames: N, cols: N, fps: avgFps, frameMs: times }, null, 2) + "\n",
);
console.log(`  -> ${DIR}/dance.png (${FW}x${FH}/klatka) + anim.json`);

// --- podglad GIF ---
{
  const PW = 300, PH = Math.round((FH / FW) * PW);
  const gif = GIFEncoder();
  for (let i = 0; i < N; i++) {
    const rgba = new Uint8Array(PW * PH * 4);
    for (let k = 0; k < rgba.length; k += 4) { rgba[k] = 18; rgba[k + 1] = 16; rgba[k + 2] = 26; rgba[k + 3] = 255; }
    for (let y = 0; y < PH; y++)
      for (let x = 0; x < PW; x++) {
        const sx = i * FW + Math.round((x / PW) * FW);
        const sy = Math.round((y / PH) * FH);
        const si = (sy * sheet.width + sx) * 4;
        const a = sheet.data[si + 3] / 255;
        if (a <= 0.02) continue;
        const di = (y * PW + x) * 4;
        rgba[di] = sheet.data[si] * a + rgba[di] * (1 - a);
        rgba[di + 1] = sheet.data[si + 1] * a + rgba[di + 1] * (1 - a);
        rgba[di + 2] = sheet.data[si + 2] * a + rgba[di + 2] * (1 - a);
      }
    const pal = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, pal), PW, PH, { palette: pal, delay: times[i] });
  }
  gif.finish();
  fs.writeFileSync(`${DIR}/dance-preview.gif`, gif.bytes());
  console.log(`  -> ${DIR}/dance-preview.gif`);
}
