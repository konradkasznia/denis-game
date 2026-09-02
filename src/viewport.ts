// Wewnętrzna rozdzielczość gry (portret 9:16). Cały kod rysuje w tych
// współrzędnych, a viewport skaluje/centruje je do realnego okna.

export const VW = 720;
export const VH = 1280; // wysokość „bazowa" układu (projekt 9:16)

export const viewport = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dpr: 1,
  /** realna wysokość widoku w jednostkach gry (>= VH na wyższych telefonach) */
  vh: VH,
};

/** Przelicza punkt z układu ekranu (clientX/Y) na współrzędne gry. */
export function toGame(clientX: number, clientY: number, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left - viewport.offsetX) / viewport.scale;
  const y = (clientY - rect.top - viewport.offsetY) / viewport.scale;
  return { x, y };
}
