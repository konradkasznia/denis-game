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
  } = opts;
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (letterSpacing) (ctx as any).letterSpacing = letterSpacing;
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = glowBlur;
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
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

