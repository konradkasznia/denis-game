// Odchudza `dist/` przed spakowaniem do APK / wgraniem na Vercel.
//
// Vite kopiuje CAŁE `public/` do `dist/` (niezależnie od .gitignore), więc lądują
// tam pliki robocze animacji: surowe rendery `magnific_*`, pojedyncze klatki
// `1..9.png`, `scenario.txt`, podglądowe `dance-preview.gif`, PSD/ZIP.
// W apce potrzebne są TYLKO arkusze `dance.png` + `anim.json`.
//
// Uruchamiane automatycznie na końcu `npm run build`.

import { readdirSync, statSync, rmSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "dist";
const CHAR_DIR = join(DIST, "assets", "char");

// w dist/assets/char zostawiamy wyłącznie to, czego używa silnik w runtime
const CHAR_KEEP = new Set(["dance.png", "anim.json"]);

// pliki robocze do usunięcia w dowolnym miejscu pod dist/assets
const JUNK_RE =
  /^(magnific_|chatgpt|src\.png$|_)|\.(psd|zip|gif)$|^scenario\.txt$|^dance-preview\./i;

let freed = 0;
let removed = 0;

function walk(dir, inChar) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, inChar || p.startsWith(CHAR_DIR));
      // sprzątnij pusty katalog
      try {
        if (readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      continue;
    }
    const name = e.name;
    const underChar = inChar || dir.startsWith(CHAR_DIR);
    const drop = underChar
      ? !CHAR_KEEP.has(name)
      : JUNK_RE.test(name) || extname(name).toLowerCase() === ".psd";
    if (drop) {
      let size = 0;
      try {
        size = statSync(p).size;
      } catch {
        /* ignore */
      }
      try {
        rmSync(p, { force: true });
        freed += size;
        removed++;
      } catch {
        /* ignore */
      }
    }
  }
}

walk(join(DIST, "assets"), false);

const mb = (freed / 1024 / 1024).toFixed(1);
console.log(`prune-dist: usunięto ${removed} plików roboczych, ${mb} MB mniej w dist/`);
