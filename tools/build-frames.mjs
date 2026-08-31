// Sklada animacje postaci z LUZNYCH PNG + scenariusza czasow.
//
//   node tools/build-frames.mjs <src> [out]
//     <src>  = folder z klatkami PNG (+ opcjonalnie scenario.txt / times.txt)
//              albo samo id utworu -> public/assets/char/<id>/raw
//     [out]  = folder wynikowy (domyslnie: folder <src>, a dla trybu id: char/<id>)
//
// Klatki: dowolne nazwy, sort naturalny (1.png, 2.png, 10.png ...).
//
// scenario.txt / times.txt  (jedna linia = jeden krok animacji):
//     3 - 06f            <- pokaz klatke nr 3 przez 6 klatek osi czasu
//     1 - 100ms
//     2 - 0.1
//     5 - 8              <- samo "8" = 8 klatek osi czasu
//   Prosta lista bez numerow (kolejnosc = pliki, bez powtorzen) tez dziala:
//     06f
//     06f
//     12f
//   "* - 06f" ustawia domyslny czas. "#" = komentarz.
//   "# fps 25"  w pliku -> przelicza klatki osi czasu wg 25 fps (domyslnie 30).
//
// Jednostki czasu: "100ms" / "0.1" (s) / "0.1s" / "3f" | "03f" | "3"
//   ("Nf" i gole liczby <=30 = klatki osi czasu Photoshopa, domyslnie 1f = 1/30 s).
// Brak pliku scenariusza -> kazda klatka 100 ms.
//
// Wynik: <out>/{dance.png, anim.json (z frameMs), dance-preview.gif}

import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from "node:fs";
import path from "node:path";

const arg1 = process.argv[2] || "pan-mlody";
let SRC, OUT;
if (fs.existsSync(arg1) && fs.statSync(arg1).isDirectory()) {
  SRC = arg1;
  OUT = process.argv[3] || arg1;
} else {
  SRC = `public/assets/char/${arg1}/raw`;
  OUT = process.argv[3] || `public/assets/char/${arg1}`;
}
if (!fs.existsSync(SRC)) { console.error(`Brak folderu: ${SRC}`); process.exit(1); }

const files = fs.readdirSync(SRC).filter((f) => /\.png$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!files.length) { console.error(`Brak PNG w ${SRC}`); process.exit(1); }

// --- czas: "06f" / "0.06" / "60ms" / "6" -> ms  (TL_FPS = fps osi czasu) ---
let TL_FPS = 30;
function parseMs(tok) {
  tok = tok.trim().toLowerCase();
  const perF = 1000 / TL_FPS;
  let m;
  if ((m = tok.match(/^(\d+(?:\.\d+)?)\s*ms$/))) return Math.round(+m[1]);
  if ((m = tok.match(/^(\d+(?:\.\d+)?)\s*s$/))) return Math.round(+m[1] * 1000);
  if ((m = tok.match(/^0?\.\d+$/))) return Math.round(parseFloat(tok) * 1000);
  if ((m = tok.match(/^(\d+)\s*f$/))) return Math.round(+m[1] * perF);      // klatki osi czasu
  if ((m = tok.match(/^(\d+)$/))) return +m[1] <= 30 ? Math.round(+m[1] * perF) : +m[1];
  return null;
}

// --- scenariusz ---
const scPath = [`${SRC}/scenario.txt`, `${SRC}/times.txt`].find((p) => fs.existsSync(p));
let seq = []; // [{fi, ms}]
if (scPath) {
  const raw = fs.readFileSync(scPath, "utf8").split(/\r?\n/).map((l) => l.trim());
  const fpsLine = raw.find((l) => /^#\s*fps\s+\d+/i.test(l));
  if (fpsLine) { TL_FPS = +fpsLine.match(/(\d+)/)[1]; console.log(`  os czasu: ${TL_FPS} fps`); }
  const lines = raw.filter((l) => l && !l.startsWith("#"));
  let deflt = 100;
  const steps = [];
  for (const l of lines) {
    let m = l.match(/^(\*|\d+)\s*[-:=]\s*(.+)$/);       // "3 - 06f"
    if (m) {
      const ms = parseMs(m[2]);
      if (ms == null) { console.warn(`  (pomijam: ${l})`); continue; }
      if (m[1] === "*") { deflt = ms; continue; }
      steps.push({ fi: +m[1] - 1, ms });
      continue;
    }
    const ms = parseMs(l);                              // sama wartosc -> kolejna klatka
    if (ms != null) steps.push({ fi: steps.length, ms });
    else console.warn(`  (pomijam: ${l})`);
  }
  seq = steps.map((s) => ({ fi: s.fi, ms: s.ms || deflt }));
} else {
  seq = files.map((_, i) => ({ fi: i, ms: 100 }));
}
seq = seq.filter((s) => s.fi >= 0 && s.fi < files.length).map((s) => ({ fi: s.fi, ms: Math.max(20, s.ms) }));
if (!seq.length) { console.error("Pusty scenariusz."); process.exit(1); }

const total = seq.reduce((a, s) => a + s.ms, 0);
console.log(`${path.basename(OUT)}: ${files.length} zdjec -> ${seq.length} krokow, petla ${(total / 1000).toFixed(2)}s`);
console.log(`  ${seq.map((s) => `#${s.fi + 1}:${s.ms}ms`).join("  ")}`);

// --- wczytaj PNG, wyrownaj ---
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(`${SRC}/${f}`)));
const sameSize = imgs.every((p) => p.width === imgs[0].width && p.height === imgs[0].height);
const A_TH = 40;
function head(p) {
  const { width: W, height: H, data: D } = p;
  let top = H;
  for (let y = 0; y < H && top === H; y++) for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] >= A_TH) { top = y; break; }
  let sx = 0, cnt = 0;
  for (let y = top; y < Math.min(H, top + Math.round(H * 0.28)); y++)
    for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] >= A_TH) { sx += x; cnt++; }
  return { top, cx: cnt ? sx / cnt : W / 2 };
}
let FW, FH, place;
if (sameSize) {
  FW = imgs[0].width; FH = imgs[0].height;
  place = () => ({ ox: 0, oy: 0 });
  console.log(`  wyrownanie: 1:1 (${FW}x${FH})`);
} else {
  const hs = imgs.map(head);
  const left = Math.max(...imgs.map((p, i) => hs[i].cx));
  const right = Math.max(...imgs.map((p, i) => p.width - hs[i].cx));
  const down = Math.max(...imgs.map((p, i) => p.height - hs[i].top));
  FW = Math.ceil(left + right) + 16; FH = Math.ceil(8 + down) + 8;
  const ax = Math.ceil(left) + 8;
  place = (i) => ({ ox: Math.round(ax - hs[i].cx), oy: Math.round(8 - hs[i].top) });
  console.log(`  wyrownanie: kotwica po glowie (${FW}x${FH})`);
}

// --- arkusz: TYLKO unikalne klatki (bez duplikatow), scenariusz = "sequence" ---
const uniq = [...new Set(seq.map((s) => s.fi))].sort((a, b) => a - b);
const cellOf = new Map(uniq.map((fi, i) => [fi, i]));
const NF = uniq.length;
const sequence = seq.map((s) => cellOf.get(s.fi));
const frameMs = seq.map((s) => s.ms);

const sheet = new PNG({ width: FW * NF, height: FH });
sheet.data.fill(0);
uniq.forEach((fi, k) => {
  const p = imgs[fi];
  const { ox, oy } = place(fi);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const X = k * FW + ox + x, Y = oy + y;
      if (X < k * FW || X >= (k + 1) * FW || Y < 0 || Y >= FH) continue;
      const si = (y * p.width + x) * 4, di = (Y * sheet.width + X) * 4;
      sheet.data[di] = p.data[si]; sheet.data[di + 1] = p.data[si + 1];
      sheet.data[di + 2] = p.data[si + 2]; sheet.data[di + 3] = p.data[si + 3];
    }
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/dance.png`, PNG.sync.write(sheet));
const fps = Math.round(1000 / (total / seq.length));
const linear = sequence.every((v, i) => v === i);
const meta = { type: "sheet", src: "dance.png", frames: NF, cols: NF, fps, frameMs };
if (!linear) meta.sequence = sequence;
fs.writeFileSync(`${OUT}/anim.json`, JSON.stringify(meta, null, 2) + "\n");
console.log(`  -> ${OUT}/dance.png (${NF} unikalnych klatek) + anim.json`);
if (!linear) console.log(`  sequence: [${sequence.join(",")}]`);

// --- podglad GIF ---
{
  const PW = 300, PH = Math.round((FH / FW) * PW);
  const gif = GIFEncoder();
  for (let step = 0; step < seq.length; step++) {
    const cell = sequence[step];
    const rgba = new Uint8Array(PW * PH * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 18; rgba[i + 1] = 16; rgba[i + 2] = 26; rgba[i + 3] = 255; }
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const sx = cell * FW + Math.round((x / PW) * FW), sy = Math.round((y / PH) * FH);
      const si = (sy * sheet.width + sx) * 4, a = sheet.data[si + 3] / 255;
      if (a <= 0.02) continue;
      const di = (y * PW + x) * 4;
      rgba[di] = sheet.data[si] * a + rgba[di] * (1 - a);
      rgba[di + 1] = sheet.data[si + 1] * a + rgba[di + 1] * (1 - a);
      rgba[di + 2] = sheet.data[si + 2] * a + rgba[di + 2] * (1 - a);
    }
    const pal = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, pal), PW, PH, { palette: pal, delay: frameMs[step] });
  }
  gif.finish();
  fs.writeFileSync(`${OUT}/dance-preview.gif`, gif.bytes());
  console.log(`  -> ${OUT}/dance-preview.gif`);
}
