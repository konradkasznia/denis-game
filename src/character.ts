// Postać na ekranie gry — pętla animacji zsynchronizowana z bitem.
//
// Ruch jest ten sam niezależnie od trafień/pudeł: tylko podskok i kołysanie
// do tempa. Można ustawić kilka animacji na osi czasu utworu (np. inna postać
// od 30. sekundy) — przełączają się z krótkim przenikaniem.
//
// Formaty animacji (folder `public/assets/char/<nazwa>/` + `anim.json`):
//   sprite sheet:  { "type": "sheet",  "src": "sheet.png", "frames": 24, "cols": 6, "fps": 18 }
//   sekwencja PNG: { "type": "frames", "src": "f-{}.png",  "frames": 24, "fps": 18, "pad": 2 }
// Pojedynczy statyczny PNG (bez folderu) też działa — jest animowany proceduralnie.
//
// Różny czas klatek (np. dłuższe zatrzymanie na pozie): dodaj do anim.json
//   "holds":   [4,1,1,3,1,1]      — krotność taktu 1000/fps na krok, albo
//   "frameMs": [800,90,90,500,90,90]  — dokładny czas kroku w ms (ważniejsze niż fps).
// Powtarzanie/skoki klatek bez duplikowania grafiki:
//   "sequence": [0,1,2,3,2,1,4]   — który obraz z arkusza pokazać w danym kroku.
//   Arkusz trzyma tylko unikalne klatki; długość frameMs/holds = długość sequence.

import { clamp } from "./ui.ts";

interface AnimMeta {
  type?: "sheet" | "frames";
  src: string;
  frames: number;
  cols?: number;
  rows?: number;
  fps: number;
  pad?: number;
  /** czas trwania każdego KROKU w ms (długość = sequence albo frames). Ma pierwszeństwo przed fps/holds. */
  frameMs?: number[];
  /** krotność bazowego taktu (1000/fps) dla każdego kroku, np. [1,1,4,1] = 3. krok x4 dłużej. */
  holds?: number[];
  /** kolejność odtwarzania klatek z arkusza (indeksy 0..frames-1), z powtórzeniami/skokami.
   *  Bez tego pola: kroki = klatki po kolei. Arkusz trzyma tylko unikalne klatki. */
  sequence?: number[];
}

interface LoadedAnim {
  meta: AnimMeta;
  sheet?: HTMLImageElement;
  frameImgs?: HTMLImageElement[];
  fw: number;
  fh: number;
  ready: boolean;
  /** rozkład czasu klatek: skumulowane końce (ms) + suma; null = równe klatki wg fps */
  timing: { ends: number[]; total: number } | null;
}

export interface CharSegment {
  /** od której sekundy utworu ta animacja jest aktywna */
  at: number;
  /** folder assetu, np. "assets/char/pan-mlody-1" */
  sprite: string;
}

const CROSSFADE = 0.4;

/** Zamienia frameMs / holds z anim.json na skumulowane końce kroków w ms. */
function buildTiming(meta: AnimMeta): { ends: number[]; total: number } | null {
  const steps = meta.sequence?.length ?? meta.frames;
  let ms: number[] | null = null;
  if (meta.frameMs?.length === steps) {
    ms = meta.frameMs.slice();
  } else if (meta.holds?.length === steps && meta.fps > 0) {
    const base = 1000 / meta.fps;
    ms = meta.holds.map((h) => Math.max(1, h) * base);
  }
  if (!ms) return null;
  const ends: number[] = [];
  let acc = 0;
  for (const v of ms) {
    acc += Math.max(1, v);
    ends.push(acc);
  }
  return { ends, total: acc };
}

export class Character {
  private anims = new Map<string, LoadedAnim>();
  private segments: CharSegment[] = [];
  private single: HTMLImageElement | null = null;
  private singleReady = false;

  reset() {
    this.anims.clear();
    this.segments = [];
    this.single = null;
    this.singleReady = false;
  }

  load(opts: { character?: string; characters?: CharSegment[] }) {
    this.reset();
    if (opts.characters?.length) {
      this.segments = [...opts.characters].sort((a, b) => a.at - b.at);
      for (const s of this.segments) if (!this.anims.has(s.sprite)) void this.loadAnim(s.sprite);
    } else if (opts.character) {
      const img = new Image();
      img.onload = () => {
        this.singleReady = true;
      };
      img.src = opts.character;
      this.single = img;
    }
  }

  hasContent() {
    return this.singleReady || [...this.anims.values()].some((a) => a.ready);
  }

  private async loadAnim(dir: string) {
    let meta: AnimMeta;
    try {
      meta = (await (await fetch(`${dir}/anim.json`)).json()) as AnimMeta;
      if (!meta || !meta.src || !meta.frames) return;
    } catch {
      return;
    }
    const entry: LoadedAnim = { meta, fw: 0, fh: 0, ready: false, timing: buildTiming(meta) };
    this.anims.set(dir, entry);

    if ((meta.type ?? "sheet") === "frames") {
      const pad = meta.pad ?? 0;
      const imgs: HTMLImageElement[] = [];
      let done = 0;
      for (let i = 1; i <= meta.frames; i++) {
        const n = pad ? String(i).padStart(pad, "0") : String(i);
        const im = new Image();
        im.onload = () => {
          if (++done >= meta.frames) {
            entry.fw = imgs[0].width;
            entry.fh = imgs[0].height;
            entry.ready = true;
          }
        };
        im.src = `${dir}/${meta.src.replace("{}", n)}`;
        imgs.push(im);
      }
      entry.frameImgs = imgs;
    } else {
      const cols = meta.cols ?? meta.frames;
      const rows = meta.rows ?? Math.ceil(meta.frames / cols);
      const img = new Image();
      img.onload = () => {
        entry.fw = img.width / cols;
        entry.fh = img.height / rows;
        entry.ready = true;
      };
      img.src = `${dir}/${meta.src}`;
      entry.sheet = img;
    }
  }

  /** Rysuje aktywną animację. Zwraca false, gdy nic nie wczytane (placeholder). */
  draw(
    ctx: CanvasRenderingContext2D,
    cx: number,
    groundY: number,
    songTime: number,
    bpm: number,
    targetH: number,
  ): boolean {
    const beat = 60 / bpm;
    const t = Math.max(songTime, 0);
    const phase = (t % beat) / beat;
    const bob = -Math.abs(Math.sin(phase * Math.PI)) * 14;
    const sway = Math.sin((t / beat) * Math.PI) * 10;
    const x = cx + sway;
    const y = groundY + bob;

    if (this.segments.length) {
      const idx = this.activeIdx(t);
      const seg = this.segments[idx];
      const fade = clamp((t - seg.at) / CROSSFADE, 0, 1);
      if (idx > 0 && fade < 1) {
        this.drawAnim(ctx, this.anims.get(this.segments[idx - 1].sprite), x, y, t, targetH, 1 - fade);
      }
      this.drawAnim(ctx, this.anims.get(seg.sprite), x, y, t, targetH, fade || 1);
      return this.hasContent();
    }

    if (this.single && this.singleReady) {
      const land = Math.pow(Math.max(0, -Math.sin(phase * Math.PI * 2)), 1.4);
      const w = (this.single.width / this.single.height) * targetH;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 + land * 0.06, 1 - land * 0.06);
      ctx.drawImage(this.single, -w / 2, -targetH, w, targetH);
      ctx.restore();
      return true;
    }
    return false;
  }

  private activeIdx(t: number) {
    let i = 0;
    for (let k = 0; k < this.segments.length; k++) if (t >= this.segments[k].at) i = k;
    return i;
  }

  private drawAnim(
    ctx: CanvasRenderingContext2D,
    a: LoadedAnim | undefined,
    x: number,
    y: number,
    t: number,
    targetH: number,
    alpha: number,
  ): boolean {
    if (!a || !a.ready) return false;
    const seq = a.meta.sequence;
    const steps = seq?.length ?? a.meta.frames;
    let step: number;
    if (a.timing) {
      const x = ((t * 1000) % a.timing.total + a.timing.total) % a.timing.total;
      step = a.timing.ends.findIndex((e) => x < e);
      if (step < 0) step = steps - 1;
    } else {
      step = Math.floor(t * a.meta.fps) % steps;
    }
    const f = seq ? clamp(seq[step] ?? 0, 0, a.meta.frames - 1) : step;
    const w = (a.fw / a.fh) * targetH;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (a.frameImgs) {
      ctx.drawImage(a.frameImgs[f], x - w / 2, y - targetH, w, targetH);
    } else if (a.sheet) {
      const cols = a.meta.cols ?? a.meta.frames;
      const sx = (f % cols) * a.fw;
      const sy = Math.floor(f / cols) * a.fh;
      ctx.drawImage(a.sheet, sx, sy, a.fw, a.fh, x - w / 2, y - targetH, w, targetH);
    }
    ctx.restore();
    return true;
  }
}
