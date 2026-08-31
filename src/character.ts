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

import { clamp } from "./ui.ts";

interface AnimMeta {
  type?: "sheet" | "frames";
  src: string;
  frames: number;
  cols?: number;
  rows?: number;
  fps: number;
  pad?: number;
}

interface LoadedAnim {
  meta: AnimMeta;
  sheet?: HTMLImageElement;
  frameImgs?: HTMLImageElement[];
  fw: number;
  fh: number;
  ready: boolean;
}

export interface CharSegment {
  /** od której sekundy utworu ta animacja jest aktywna */
  at: number;
  /** folder assetu, np. "assets/char/pan-mlody-1" */
  sprite: string;
}

const CROSSFADE = 0.4;

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
    const entry: LoadedAnim = { meta, fw: 0, fh: 0, ready: false };
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
      const drew = this.drawAnim(ctx, this.anims.get(seg.sprite), x, y, t, targetH, fade || 1);
      if (drew) this.shadow(ctx, x, groundY, bob, targetH);
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
      this.shadow(ctx, x, groundY, bob, targetH);
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
    const f = Math.floor(t * a.meta.fps) % a.meta.frames;
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

  private shadow(
    ctx: CanvasRenderingContext2D,
    x: number,
    groundY: number,
    bob: number,
    targetH: number,
  ) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, groundY + 6, targetH * 0.22 - bob * 0.5, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
