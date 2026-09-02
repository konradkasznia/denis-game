// Generuje ikony aplikacji (PWA / „Dodaj do ekranu początkowego" na iOS + ikona 1024 do sklepów).
// Gotowe pliki są w repo (public/icons/, art/icon-1024.png) — uruchamiaj tylko przy zmianie źródła.
//   npm i -D sharp && node tools/make-icons.mjs && npm rm -D sharp
// Źródło: public/assets/denis/denis-stage.png (render Funko Denisa).

import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = "public/icons"; // ikony ładowane przez przeglądarkę / iOS
const STORE = "art"; // duża ikona 1024 — tylko do wysyłki do App Store / Play
mkdirSync(OUT, { recursive: true });
mkdirSync(STORE, { recursive: true });

const S = 1024;
const bgSvg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="78%">
      <stop offset="0%" stop-color="#2a1f47"/>
      <stop offset="52%" stop-color="#150d28"/>
      <stop offset="100%" stop-color="#06050c"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="66%" r="46%">
      <stop offset="0%" stop-color="#ff9f43" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#ff9f43" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#g)"/>
  <rect width="${S}" height="${S}" fill="url(#glow)"/>
</svg>`;

const bg = await sharp(Buffer.from(bgSvg)).png().toBuffer();

// render Denisa ma własne (ciemne) tło sceny — kadrujemy na pełny kwadrat
// od góry (zachowujemy głowę, przycinamy podłogę), potem lekki gradientowy
// vignette z gry na wierzch, żeby zgrało się z brandem.
const denisSquare = await sharp("public/assets/denis/denis-stage.png")
  .resize(S, S, { fit: "cover", position: "top" })
  .toBuffer();

const vignette = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="v" cx="50%" cy="45%" r="72%">
    <stop offset="0%" stop-color="#000" stop-opacity="0"/>
    <stop offset="78%" stop-color="#0a0714" stop-opacity="0"/>
    <stop offset="100%" stop-color="#0a0714" stop-opacity="0.55"/>
  </radialGradient></defs>
  <rect width="${S}" height="${S}" fill="url(#v)"/>
</svg>`;

const base = await sharp(bg)
  .composite([
    { input: denisSquare, blend: "over" },
    { input: Buffer.from(vignette), blend: "over" },
  ])
  .png()
  .toBuffer();

const targets = [
  [STORE, "icon-1024.png", 1024],
  [OUT, "icon-512.png", 512],
  [OUT, "icon-192.png", 192],
  [OUT, "apple-touch-icon.png", 180],
  [OUT, "favicon-32.png", 32],
];

for (const [dir, name, size] of targets) {
  const buf = await sharp(base).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(`${dir}/${name}`, buf);
  console.log(`${dir}/${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} kB`);
}
console.log("gotowe");
