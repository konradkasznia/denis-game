import "./style.css";
import { Game } from "./game.ts";
import { initInput } from "./input.ts";
import { VH, VW, viewport } from "./viewport.ts";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  const scale = Math.min(availW / VW, availH / VH);
  const cssW = VW * scale;
  const cssH = VH * scale;

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  // viewport.scale jest w jednostkach CSS (do przeliczania dotyku)
  viewport.scale = scale;
  viewport.offsetX = 0;
  viewport.offsetY = 0;
  viewport.dpr = dpr;

  // kontekst rysuje w jednostkach gry; dpr obsłużony tutaj
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.imageSmoothingQuality = "high";
}

window.addEventListener("resize", resize);
resize();

const game = new Game();
initInput(canvas, (e) => game.onTap(e));

if (import.meta.env.DEV) (window as any).__game = game;

let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt, now);
  ctx.save();
  game.render(ctx);
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
