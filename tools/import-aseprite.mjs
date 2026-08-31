// Bierze eksport z Aseprite / LibreSprite (Export Sprite Sheet -> JSON Data)
// i sklada z niego gotowy folder postaci dla gry:
//   public/assets/char/<utwor>/{dance.png, anim.json, dance-preview.gif}
// Czas kazdej klatki (ustawiony w timeline Aseprite) laduje w anim.json jako "frameMs".
//
//   node tools/import-aseprite.mjs <sciezka-do-eksportu.json> [utwor]
//     domyslny utwor: pan-mlody
//
// W Aseprite: File -> Export Sprite Sheet -> zaznacz "JSON Data" (Array albo Hash),
// "Item Filename" moze byc dowolny. PNG i JSON zapisz obok siebie.

import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from "node:fs";
import path from "node:path";

const JSON_PATH = process.argv[2];
const ID = process.argv[3] || "pan-mlody";
if (!JSON_PATH || !fs.existsSync(JSON_PATH)) {
  console.error("Podaj sciezke do pliku .json z eksportu Aseprite.");
  process.exit(1);
}
const jdir = path.dirname(JSON_PATH);
const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));

// --- klatki w kolejnosci ---
let list;
if (Array.isArray(data.frames)) {
  list = data.frames;
} else {
  list = Object.entries(data.frames)
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([, v]) => v);
}
const N = list.length;
if (!N) { console.error("Brak klatek w JSON."); process.exit(1); }

// --- arkusz PNG ---
const sheetName = data.meta?.image || path.basename(JSON_PATH).replace(/\.json$/i, ".png");
const sheetPath = path.join(jdir, sheetName);
if (!fs.existsSync(sheetPath)) { console.error(`Nie znaleziono arkusza: ${sheetPath}`); process.exit(1); }
const sheet = PNG.sync.read(fs.readFileSync(sheetPath));

// --- wytnij klatki, wyrownaj do wspolnego plotna (srodek w poziomie, dol do dolu) ---
const rects = list.map((f) => f.frame);
const FW = Math.max(...rects.map((r) => r.w));
const FH = Math.max(...rects.map((r) => r.h));
const durs = list.map((f) => Math.max(20, Math.round(f.duration ?? 100)));

const out = new PNG({ width: FW * N, height: FH });
out.data.fill(0);
rects.forEach((r, i) => {
  const dx0 = i * FW + Math.round((FW - r.w) / 2);
  const dy0 = FH - r.h; // dol do dolu
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const si = ((r.y + y) * sheet.width + (r.x + x)) * 4;
      const di = ((dy0 + y) * out.width + (dx0 + x)) * 4;
      out.data[di] = sheet.data[si];
      out.data[di + 1] = sheet.data[si + 1];
      out.data[di + 2] = sheet.data[si + 2];
      out.data[di + 3] = sheet.data[si + 3];
    }
});

const DIR = `public/assets/char/${ID}`;
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/dance.png`, PNG.sync.write(out));

const avgFps = Math.round(1000 / (durs.reduce((a, b) => a + b, 0) / N));
const meta = { type: "sheet", src: "dance.png", frames: N, cols: N, fps: avgFps, frameMs: durs };
fs.writeFileSync(`${DIR}/anim.json`, JSON.stringify(meta, null, 2) + "\n");

console.log(`${ID}: ${N} klatek ${FW}x${FH}, petla ${(durs.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`);
console.log(`  frameMs: [${durs.join(", ")}]`);
console.log(`  -> ${DIR}/dance.png + anim.json`);

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
        const si = (sy * out.width + sx) * 4;
        const a = out.data[si + 3] / 255;
        if (a <= 0.02) continue;
        const di = (y * PW + x) * 4;
        rgba[di] = out.data[si] * a + rgba[di] * (1 - a);
        rgba[di + 1] = out.data[si + 1] * a + rgba[di + 1] * (1 - a);
        rgba[di + 2] = out.data[si + 2] * a + rgba[di + 2] * (1 - a);
      }
    const pal = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, pal), PW, PH, { palette: pal, delay: durs[i] });
  }
  gif.finish();
  fs.writeFileSync(`${DIR}/dance-preview.gif`, gif.bytes());
  console.log(`  -> ${DIR}/dance-preview.gif`);
}
