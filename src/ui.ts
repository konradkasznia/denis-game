// Drobne pomocniki do rysowania na canvasie.

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Rodzina Roboto Black do nagłówków (ładowana w main.ts; fallback do sans). */
export const HEAD_FONT = '"Roboto", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export interface TextShadow {
  dx: number;
  dy: number;
  blur?: number;
  color: string;
}

export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    color?: string;
    align?: CanvasTextAlign;
    weight?: string;
    font?: string;
    glow?: string;
    glowBlur?: number;
    letterSpacing?: string;
    /** twarde warstwy cienia rysowane pod głównym tekstem (kolejność: od spodu) */
    shadows?: TextShadow[];
    /** obrys tekstu */
    stroke?: string;
    strokeWidth?: number;
  } = {},
) {
  const {
    size = 32,
    color = "#fff",
    align = "center",
    weight = "700",
    font = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
    glow,
    glowBlur = 18,
    letterSpacing,
    shadows,
    stroke,
    strokeWidth = 6,
  } = opts;
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (letterSpacing) (ctx as any).letterSpacing = letterSpacing;

  if (shadows) {
    for (const s of shadows) {
      ctx.save();
      ctx.shadowColor = s.blur ? s.color : "transparent";
      ctx.shadowBlur = s.blur ?? 0;
      ctx.fillStyle = s.color;
      ctx.fillText(str, x + s.dx, y + s.dy);
      ctx.restore();
    }
  }
  if (stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
  }
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = glowBlur;
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
}

/** Domyślny zestaw cieni dla nagłówków w stylu makiety (twardy ciemny cień). */
export const HEAD_SHADOWS: TextShadow[] = [
  { dx: 0, dy: 6, blur: 0, color: "rgba(0,0,0,0.55)" },
  { dx: 0, dy: 3, blur: 0, color: "rgba(0,0,0,0.9)" },
];

// ---- obrazy: cache + wersja czarno-biała -------------------------------

const imgCache = new Map<string, HTMLImageElement>();

/** Leniwie ładuje obraz z `src` (z cache). Zwraca element (może być jeszcze niegotowy). */
export function loadImg(src: string): HTMLImageElement {
  let img = imgCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imgCache.set(src, img);
  }
  return img;
}

export function imgReady(img: HTMLImageElement | null | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

const grayCache = new Map<HTMLImageElement, HTMLCanvasElement>();

/** Czarno-biała wersja obrazu (offscreen canvas, cache). */
export function desaturated(img: HTMLImageElement): HTMLCanvasElement {
  let c = grayCache.get(img);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d")!;
  try {
    (g as any).filter = "grayscale(1) brightness(0.85)";
    g.drawImage(img, 0, 0);
    (g as any).filter = "none";
  } catch {
    g.drawImage(img, 0, 0);
  }
  // ręczny fallback / wzmocnienie: nadpisz luminancją
  try {
    const d = g.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const l = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) * 0.85;
      p[i] = p[i + 1] = p[i + 2] = l;
    }
    g.putImageData(d, 0, 0);
  } catch {
    /* getImageData może rzucić przy tainted canvas — zostaje wynik filtra */
  }
  grayCache.set(img, c);
  return c;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Dzieli tekst na linie po ~maxChars znaków (po słowach). */
export function wrapText(str: string, maxChars: number): string[] {
  const words = str.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Rozjaśnia (amt > 0) lub przyciemnia (amt < 0) kolor #rrggbb. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) + amt), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) + amt), 0, 255);
  const b = clamp(Math.round((n & 255) + amt), 0, 255);
  return `rgb(${r},${g},${b})`;
}

