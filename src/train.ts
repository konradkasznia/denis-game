// @ts-nocheck — kod przeniesiony 1:1 z prototypu (public/proto/pociag.js), rysowanie canvas
// Runda „Pociąg weselny" (POCIĄG WESELNY, „A Ty teraz tańcz!"): Snake na sali weselnej.
// Denis prowadzi pociąg gości; runda trwa tyle co piosenka albo do zderzenia.
// Moneta co 5 gości (+5 monet, 5 s na złapanie), flaszka co 10 gości (5 s na
// złapanie; po złapaniu 4 s odwróconego sterowania, a w rankingu liczy się na plus).
//
// Moduł niczego nie wie o grze: dostaje zegar/odtwarzanie muzyki przez `deps`
// i oddaje wynik przez `deps.onFinish`. Układ 720×1280 (jak reszta gry);
// game.ts rysuje go w swojej ramce i przekazuje stuknięcia we współrzędnych gry.

export interface TrainResult {
  /** zebrani goście (bez Denisa) */
  len: number;
  /** złapane flaszki */
  flasks: number;
  /** sekunda piosenki, w której pociąg osiągnął końcową długość (ms) */
  timeMs: number;
  /** monety z rundy (złapane monety × 5) */
  coins: number;
  /** dojechał do końca piosenki (bez zderzenia) */
  survived: boolean;
}

export interface TrainDeps {
  /** czas piosenki (s) */
  time(): number;
  /** długość piosenki (s); 0 = nieznana */
  duration(): number;
  /** start muzyki od początku */
  play(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  haptic(kind: "tick" | "hit" | "miss"): void;
  onFinish(r: TrainResult): void;
  /** „wróć do menu" z podsumowania */
  onExit(): void;
  /** „zagraj jeszcze raz" z podsumowania — gra pobiera opłatę i woła restart() */
  onAgain(): void;
  /** „WYNIKI" z podsumowania */
  onBoard(): void;
  /** czy da się zagrać ponownie: darmowe próby (left > 0), płatna (cost) albo nic */
  againInfo(): { free: number; cost: number; canPay: boolean };
}

export function createTrainRound(deps: TrainDeps) {
const W = 720, H = 1280, C = 48, COLS = 15, ROWS = 22, BY = 186;
const HEAD_FONT = '"Roboto","Trebuchet MS","Segoe UI",system-ui,sans-serif';
let x = null; // kontekst canvasu podawany w draw()
let vTop = 0, vH = H; // widoczny obszar (wyższe telefony: sala sięga dalej w górę i w dół)

// ---- grafiki Denisa z gry (głowa + oczy z animacji Pana Młodego) ----
const img = (src) => { const i = new Image(); i.src = src; return i; };
const HEAD = img("assets/train/denis-head.webp"), EYE_L = img("assets/train/denis-eye-l.webp"), EYE_R = img("assets/train/denis-eye-r.webp");
const ready = (i) => i.complete && i.naturalWidth > 0;

// ---- plansza ----
const TABLES = [[1, 4], [12, 4], [1, 10], [12, 10], [1, 16], [12, 16]];
const HEAD_TABLE = [5, 9], HEAD_ROW = 2; // stół Pary Młodej: kolumny 5-9, rząd 2 (rzędy 0-1 wolne, da się go obejść)
const blocked = new Set();
for (const [c, r] of TABLES) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) blocked.add(c + a + "," + (r + b));
for (let c = HEAD_TABLE[0]; c <= HEAD_TABLE[1]; c++) blocked.add(c + "," + HEAD_ROW);
const GROOM_AT = { c: 6, r: HEAD_ROW + 1 }, BRIDE_AT = { c: 8, r: HEAD_ROW + 1 };
const DF = [4, 4, 7, 12]; // parkiet: kolumna, rząd, szer., wys.

const SKIN = "#f1c39c", SKIN_D = "#d99f76";
const GUESTS = [
  { body: "#c0182c", hair: "#4a2c1a", long: 1, dress: 1 },
  { body: "#2b5fd9", hair: "#e3b86a", long: 1, dress: 1 },
  { body: "#e36aa6", hair: "#2a1a12", long: 1, dress: 1 },
  { body: "#2b3a55", hair: "#5a3a22", suit: 1, tie: "#9b1b30" },
  { body: "#3e7d4a", hair: "#cfcfcf", bald: 1, suit: 1, tie: "#d4a017" },
  { body: "#7a4fb5", hair: "#dedede", dress: 1, bun: 1 },
  { body: "#5b3a1e", hair: "#1e1410", suit: 1, tie: "#2b5fd9", beard: 1 },
  { body: "#3a9bb3", hair: "#8a5530", long: 1, dress: 1 },
];
const DENIS = { denis: 1, body: "#18161d", suit: 1, bow: 1, hair: "#2a1c14", beard: 1 }; // hair/beard: zapas, gdy grafika głowy jeszcze się nie wczytała
const BRIDE = { body: "#fbf7ef", hair: "#6b4426", long: 1, dress: 1, veil: 1 };
const GROOM = { body: "#22304d", hair: "#3b2416", suit: 1, tie: "#d4a017", flower: 1 };

let snake, dir, queue, food, couple, state, tick, acc, last = 0, shake = 0, overAt = 0, fx = [], lost = [];
let items = [], coins = 0, drunkUntil = 0, flasks = 0, lastCatchT = 0;
let waiting = true; // Denis stoi, dopóki gracz nie wciśnie pierwszej strzałki // moneta (+5) i flaszka (odwrócone sterowanie)
const ITEM_MS = 5000, DRUNK_MS = 4000, COIN_VALUE = 5;

function reset() {
  snake = [{ c: 7, r: 11, o: DENIS }]; // na start sam Denis
  snake.forEach((s) => { s.pc = s.c; s.pr = s.r; });
  dir = [0, -1]; queue = []; tick = 230; acc = 0; food = null; lost = [];
  items = []; coins = 0; drunkUntil = 0; flasks = 0; lastCatchT = 0; waiting = true;
  couple = [{ ...GROOM_AT, o: GROOM }, { ...BRIDE_AT, o: BRIDE }];
  spawn();
}
const taken = (c, r) => snake.some((s) => s.c === c && s.r === r) || couple.some((p) => p.c === c && p.r === r) ||
  items.some((it) => it.c === c && it.r === r) || (!!food && food.c === c && food.r === r);
function freeCell() {
  let c, r, k = 0;
  do { c = Math.floor(Math.random() * COLS); r = 1 + Math.floor(Math.random() * (ROWS - 1)); k++; }
  while ((blocked.has(c + "," + r) || taken(c, r) || underPad(c, r) || nearChairs(c, r)) && k < 500);
  return { c, r };
}
/** Pole przy krzesłach stołu — da się przejść, ale gość by na nich stał. */
function nearChairs(c, r) { return TABLES.some(([tc, tr]) => Math.hypot(px(c) - (tc + 1) * C, py(r) - (BY + (tr + 1) * C)) < 78); }
function spawn() { food = { ...freeCell(), o: GUESTS[Math.floor(Math.random() * GUESTS.length)] }; }
function spawnItem(kind) { items.push({ ...freeCell(), kind, born: performance.now() }); }
/** Pole pod krzyżakiem — tam nie stawiamy gości (pociąg może tamtędy przejechać). */
function underPad(c, r) { return Math.hypot(px(c) - DP.cx, py(r) - DP.cy) < DP.d + DP.s * 0.95; }
function step() {
  for (const s of snake) { s.pc = s.c; s.pr = s.r; }
  if (waiting) return; // odliczanie / czekamy na pierwszy ruch
  if (queue.length) dir = queue.shift();
  const h = snake[0], nc = h.c + dir[0], nr = h.r + dir[1];
  const hitSelf = snake.slice(0, -1).some((s) => s.c === nc && s.r === nr);
  if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || blocked.has(nc + "," + nr) || hitSelf) {
    // zderzenie (ściana, stół, własny pociąg) = koniec zabawy
    shake = 20; buzz(80); deps.haptic("miss"); finish(false);
    return;
  }
  // moneta / flaszka pod głową pociągu
  const ii = items.findIndex((it) => it.c === nc && it.r === nr);
  if (ii >= 0) {
    const it = items.splice(ii, 1)[0];
    if (it.kind === "coin") { coins += COIN_VALUE; fx.push({ x: px(nc), y: py(nr) - 40, vx: 0, vy: -90, t: 0, txt: "+" + COIN_VALUE }); buzz(20); }
    else { flasks++; drunkUntil = performance.now() + DRUNK_MS; queue = []; for (let i = 0; i < 8; i++) fx.push({ x: px(nc), y: py(nr) - 40, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 90, t: 0, bubble: 1 }); buzz(40); }
  }
  let got = null;
  if (food && food.c === nc && food.r === nr) { got = food; food = null; }
  const ci = couple.findIndex((p) => p.c === nc && p.r === nr);
  if (ci >= 0) { got = couple[ci]; couple.splice(ci, 1); }
  if (got) { const t = snake[snake.length - 1]; snake.push({ c: t.c, r: t.r, pc: t.c, pr: t.r, o: got.o }); }
  for (let i = snake.length - 1 - (got ? 1 : 0); i > 0; i--) { snake[i].c = snake[i - 1].c; snake[i].r = snake[i - 1].r; }
  h.c = nc; h.r = nr;
  if (got) {
    const big = got.o === BRIDE || got.o === GROOM;
    for (let i = 0; i < (big ? 16 : 7); i++) fx.push({ x: px(nc), y: py(nr) - 50, vx: (Math.random() - 0.5) * 140, vy: -70 - Math.random() * 100, t: 0, heart: big });
    tick = Math.max(125, tick - 5); buzz(15); lastCatchT = deps.time();
    if (!food) spawn();
    const n = snake.length - 1;
    if (n % 5 === 0) spawnItem("coin"); // co 5 gości moneta
    if (n % 10 === 0) spawnItem("vodka"); // co 10 gości flaszka
  }
}
function finish(survived) {
  if (state !== "play") return;
  state = "done"; overAt = performance.now(); queue = []; pressed.clear(); deps.stop();
  deps.onFinish({ len: snake.length - 1, flasks, timeMs: Math.round(Math.max(0, lastCatchT) * 1000), coins, survived });
}
const px = (c) => (c + 0.5) * C, py = (r) => BY + (r + 0.5) * C;
const buzz = (ms) => { if (ms >= 15) deps.haptic(ms >= 60 ? "miss" : "hit"); };

// ---- postacie (styl figurek z gry: duża, szeroka głowa, wysokie błyszczące oczy) ----
function rr(x0, y0, w, h, r) { x.beginPath(); x.roundRect(x0, y0, w, h, r); }
function eye(ex, ey, w, h) {
  const g = x.createRadialGradient(ex - w * 0.3, ey - h * 0.35, 0.5, ex, ey, h);
  g.addColorStop(0, "#5a5a5a"); g.addColorStop(0.35, "#141010"); g.addColorStop(1, "#050404");
  x.fillStyle = g; x.beginPath(); x.ellipse(ex, ey, w, h, 0, 0, 7); x.fill();
  x.fillStyle = "rgba(255,255,255,0.85)"; x.beginPath(); x.ellipse(ex - w * 0.35, ey - h * 0.45, w * 0.28, h * 0.18, -0.3, 0, 7); x.fill();
}
function figure(cx, cy, o, f, t, ph, arms, scale = 1) {
  const bob = Math.abs(Math.sin(t * 0.012 + ph)) * 4;
  x.save(); x.translate(cx, cy); x.scale(scale, scale);
  // cień
  x.fillStyle = "rgba(0,0,0,0.28)"; x.beginPath(); x.ellipse(0, 4, 24, 9, 0, 0, 7); x.fill();
  // buty
  const st = Math.sin(t * 0.012 + ph) * 3;
  for (const s of [-1, 1]) {
    const g = x.createLinearGradient(0, -6, 0, 6); g.addColorStop(0, "#3a3438"); g.addColorStop(1, "#0b0a0c");
    x.fillStyle = g; rr(s * 9 - 7, -6 + s * st * 0.5, 14, 10, 5); x.fill();
  }
  x.translate(0, -bob);
  // tułów
  const tg = x.createLinearGradient(-16, -40, 16, 0);
  tg.addColorStop(0, shade(o.body, 30)); tg.addColorStop(1, shade(o.body, -25));
  x.fillStyle = tg;
  if (o.dress) { x.beginPath(); x.moveTo(-20, -2); x.quadraticCurveTo(-16, -30, -12, -38); x.lineTo(12, -38); x.quadraticCurveTo(16, -30, 20, -2); x.quadraticCurveTo(0, 4, -20, -2); x.fill(); }
  else { rr(-16, -40, 32, 36, 11); x.fill(); }
  if (f !== "U") {
    if (o.suit) {
      x.fillStyle = "#f7f4ef"; x.beginPath(); x.moveTo(-6, -40); x.lineTo(6, -40); x.lineTo(0, -24); x.fill();
      if (o.bow) { x.fillStyle = "#0c0b0e"; x.beginPath(); x.moveTo(0, -36); x.lineTo(-7, -40); x.lineTo(-7, -32); x.closePath(); x.moveTo(0, -36); x.lineTo(7, -40); x.lineTo(7, -32); x.fill(); }
      else if (o.tie) { x.fillStyle = o.tie; rr(-2.5, -37, 5, 13, 2); x.fill(); }
      if (o.flower || o.denis) { x.fillStyle = "#fff"; x.beginPath(); x.arc(-10, -30, 3.4, 0, 7); x.fill(); x.fillStyle = "#4f8a3a"; x.beginPath(); x.arc(-12.5, -27.5, 1.8, 0, 7); x.fill(); }
    } else if (o.dress && !o.veil) { x.fillStyle = "rgba(255,255,255,0.18)"; x.beginPath(); x.ellipse(-5, -30, 4, 7, 0.4, 0, 7); x.fill(); }
  }
  // ręce
  const armCol = o.dress ? SKIN : o.body;
  x.lineCap = "round"; x.lineWidth = 8; x.strokeStyle = armCol;
  let hands;
  if (arms) { hands = [[-13 + arms[0] * 22, -36 + arms[1] * 14 - 6], [13 + arms[0] * 22, -36 + arms[1] * 14 - 6]]; }
  else { const w = Math.sin(t * 0.015 + ph) * 7; hands = [[-26, -52 + w], [26, -52 - w]]; }
  x.beginPath(); x.moveTo(-14, -34); x.lineTo(...hands[0]); x.moveTo(14, -34); x.lineTo(...hands[1]); x.stroke();
  x.fillStyle = SKIN; for (const hnd of hands) { x.beginPath(); x.arc(hnd[0], hnd[1], 5, 0, 7); x.fill(); }
  // głowa
  const hy = -66;
  if (o.denis && ready(HEAD)) { denisHead(hy, f); x.restore(); return; }
  drawHead(o, f, hy);
  x.restore();
}
function denisHead(hy, f) {
  const w = 66, h = w * HEAD.naturalHeight / HEAD.naturalWidth, k = w / HEAD.naturalWidth;
  const flip = f === "L" ? -1 : 1;
  x.save(); x.translate(0, hy); x.scale(flip, 1);
  x.drawImage(HEAD, -w / 2, -h / 2 - 4, w, h);
  if (f === "U") { // tył głowy: włosy
    const g = x.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, "#3a2a1e"); g.addColorStop(1, "#1d140e");
    x.fillStyle = g; x.beginPath(); x.roundRect(-w * 0.44, -h / 2 - 2, w * 0.88, h * 0.92, w * 0.32); x.fill();
  }
  if (f !== "U" && ready(EYE_L) && ready(EYE_R)) {
    // pozycje oczu z animacji Pana Młodego (współrzędne w pliku głowy)
    x.drawImage(EYE_L, -w / 2 + 83 * k, -h / 2 - 4 + 339 * k, 123 * k, 128 * k);
    x.drawImage(EYE_R, -w / 2 + 379 * k, -h / 2 - 4 + 373 * k, 128 * k, 127 * k);
  }
  x.restore();
}
function drawHead(o, f, hy) {
  const hw = 27, hh = 24, sx = f === "L" ? -6 : f === "R" ? 6 : 0;
  // długie włosy z tyłu
  if (o.long) { x.fillStyle = shade(o.hair, -10); rr(-hw - 2, hy - 6, hw * 2 + 4, f === "U" ? 46 : 42, 18); x.fill(); }
  if (o.veil) { x.fillStyle = "rgba(255,255,255,0.8)"; rr(-hw - 6, hy - 10, hw * 2 + 12, 58, 22); x.fill(); }
  // uszy
  if (f !== "U") { x.fillStyle = SKIN_D; x.beginPath(); x.ellipse(-hw + (f === "R" ? 4 : 0), hy + 4, 5, 7, 0, 0, 7); x.ellipse(hw + (f === "L" ? -4 : 0), hy + 4, 5, 7, 0, 0, 7); x.fill(); }
  // twarz (szeroka, zaokrąglony kwadrat)
  const sg = x.createRadialGradient(-10, hy - 10, 4, 0, hy, 34);
  sg.addColorStop(0, "#ffdcbc"); sg.addColorStop(0.6, SKIN); sg.addColorStop(1, SKIN_D);
  x.fillStyle = sg; rr(-hw, hy - hh, hw * 2, hh * 2, 20); x.fill();
  // włosy
  const hg = x.createLinearGradient(0, hy - hh - 6, 0, hy);
  hg.addColorStop(0, shade(o.hair, 25)); hg.addColorStop(1, shade(o.hair, -20));
  x.fillStyle = hg;
  if (f === "U") { if (!o.bald) { rr(-hw - 1, hy - hh - 3, hw * 2 + 2, hh * 2 + 4, 21); x.fill(); } else { x.fillStyle = "rgba(255,255,255,0.25)"; x.beginPath(); x.ellipse(-6, hy - 10, 10, 6, -0.4, 0, 7); x.fill(); } }
  else if (o.bald) { x.beginPath(); x.ellipse(-hw + 2, hy - 2, 5, 11, 0, 0, 7); x.ellipse(hw - 2, hy - 2, 5, 11, 0, 0, 7); x.fill(); }
  else {
    x.beginPath(); x.moveTo(-hw - 1, hy + 2); x.lineTo(-hw - 1, hy - hh + 12);
    x.quadraticCurveTo(-hw, hy - hh - 8, 0, hy - hh - 8); x.quadraticCurveTo(hw, hy - hh - 8, hw + 1, hy - hh + 12); x.lineTo(hw + 1, hy + 2);
    x.quadraticCurveTo(hw - 4, hy - 8, hw - 10, hy - 10); x.quadraticCurveTo(sx + 6, hy - 6, sx - 2, hy - 13); x.quadraticCurveTo(-hw + 6, hy - 9, -hw - 1, hy + 2); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.18)"; x.lineWidth = 2;
    for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(i * 8 - 3, hy - hh - 4); x.quadraticCurveTo(i * 8 + 4, hy - hh + 2, i * 8 + 2, hy - 14); x.stroke(); }
  }
  if (o.bun) { x.fillStyle = hg; x.beginPath(); x.arc(0, hy - hh - 8, 11, 0, 7); x.fill(); }
  if (o.veil) { for (const [a, b] of [[-14, -22], [-5, -26], [5, -26], [14, -22]]) { x.fillStyle = "#fff"; x.beginPath(); x.arc(a, hy + b, 4.5, 0, 7); x.fill(); x.fillStyle = "#f3c6d6"; x.beginPath(); x.arc(a, hy + b, 1.8, 0, 7); x.fill(); } }
  if (f === "U") return;
  // brwi, oczy, nos
  const ex = f === "D" ? [-11, 11] : f === "L" ? [-17, 1] : [-1, 17];
  x.strokeStyle = shade(o.hair === "#cfcfcf" || o.hair === "#dedede" ? "#8a8a8a" : o.hair, -20); x.lineWidth = 3.5; x.lineCap = "round";
  for (const e of ex) { x.beginPath(); x.moveTo(e - 6, hy - 5); x.quadraticCurveTo(e, hy - 9, e + 6, hy - 6); x.stroke(); }
  for (const e of ex) eye(e, hy + 4, 4.6, 7.4);
  x.fillStyle = SKIN_D; x.beginPath(); x.ellipse(sx, hy + 11, 2.6, 2, 0, 0, 7); x.fill();
  if (o.beard) { x.fillStyle = shade(o.hair, -5); x.beginPath(); x.moveTo(-hw + 2, hy + 2); x.quadraticCurveTo(-hw + 2, hy + hh + 2, 0, hy + hh + 3); x.quadraticCurveTo(hw - 2, hy + hh + 2, hw - 2, hy + 2); x.quadraticCurveTo(hw - 6, hy + 14, sx, hy + 15); x.quadraticCurveTo(-hw + 6, hy + 14, -hw + 2, hy + 2); x.fill(); }
  else if (!o.long || o.veil || true) { x.fillStyle = "rgba(230,110,110,0.22)"; x.beginPath(); x.arc(ex[0] - 3, hy + 13, 4.5, 0, 7); x.arc(ex[1] + 3, hy + 13, 4.5, 0, 7); x.fill(); }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// ---- sala ----
function chair(cx, cy, ang) {
  // krzesło bankietowe z pokrowcem i złotą kokardą; oparcie od strony zewnętrznej
  x.save(); x.translate(cx, cy); x.rotate(ang);
  x.fillStyle = "rgba(0,0,0,0.22)"; rr(-9, -6, 20, 18, 6); x.fill();
  const g = x.createLinearGradient(0, -9, 0, 9); g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#e4dccb");
  x.fillStyle = g; rr(-10, -9, 20, 15, 6); x.fill();
  x.fillStyle = "#efe6d2"; rr(-11, 5, 22, 6, 3); x.fill();
  x.fillStyle = "#e0b54a"; x.beginPath(); x.ellipse(-3, 8, 3, 2, 0, 0, 7); x.ellipse(3, 8, 3, 2, 0, 0, 7); x.fill();
  x.restore();
}
function table(cx, cy, front) {
  const chairs = [];
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + Math.PI / 8; chairs.push({ x: cx + Math.cos(a) * 60, y: cy + Math.sin(a) * 45, a: a - Math.PI / 2 }); }
  if (!front) {
    for (const c of chairs) if (c.y <= cy) chair(c.x, c.y, c.a);
    x.fillStyle = "rgba(0,0,0,0.3)"; x.beginPath(); x.ellipse(cx + 3, cy + 12, 50, 36, 0, 0, 7); x.fill();
    x.fillStyle = "#e6d8bd"; x.beginPath(); x.ellipse(cx, cy + 7, 48, 35, 0, 0, 7); x.fill();
    const g = x.createRadialGradient(cx - 14, cy - 12, 4, cx, cy, 52); g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#f3ead7");
    x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, 48, 33, 0, 0, 7); x.fill();
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + Math.PI / 8; const pxx = cx + Math.cos(a) * 33, pyy = cy + Math.sin(a) * 22; x.fillStyle = "#fff"; x.beginPath(); x.ellipse(pxx, pyy, 7.5, 5.5, 0, 0, 7); x.fill(); x.strokeStyle = "#d8cfbd"; x.lineWidth = 1.2; x.stroke(); x.fillStyle = "#e9c46a"; x.beginPath(); x.ellipse(pxx, pyy, 3, 2, 0, 0, 7); x.fill(); }
    x.fillStyle = "#6fae52"; x.beginPath(); x.ellipse(cx, cy, 15, 10, 0, 0, 7); x.fill();
    for (const [a, b, col] of [[-5, -3, "#ff8fb3"], [5, -2, "#ffffff"], [0, 3, "#e85d8a"], [-8, 3, "#ffd1df"], [8, 4, "#ff8fb3"]]) { x.fillStyle = col; x.beginPath(); x.arc(cx + a, cy + b, 4.5, 0, 7); x.fill(); }
  } else {
    for (const c of chairs) if (c.y > cy) chair(c.x, c.y, c.a);
  }
}
function headTable() {
  const x0 = HEAD_TABLE[0] * C + 6, w = (HEAD_TABLE[1] - HEAD_TABLE[0] + 1) * C - 12, y0 = BY + HEAD_ROW * C + 4, h = C - 12;
  x.fillStyle = "rgba(0,0,0,0.3)"; rr(x0 + 3, y0 + 8, w, h, 10); x.fill();
  x.fillStyle = "#fffaf0"; rr(x0, y0, w, h, 10); x.fill();
  x.fillStyle = "#f3c6d6"; rr(x0, y0 + h - 12, w, 12, 6); x.fill();
  for (let i = 0; i < 7; i++) { const gx = x0 + 16 + i * (w - 32) / 6; x.fillStyle = "#f6d9a8"; x.beginPath(); x.arc(gx, y0 + h - 6, 5, 0, 7); x.fill(); x.fillStyle = i % 2 ? "#e85d8a" : "#ffffff"; x.beginPath(); x.arc(gx, y0 + h - 6, 2.5, 0, 7); x.fill(); }
  // tort
  const tx = x0 + w / 2;
  x.fillStyle = "#fff7ec"; x.beginPath(); x.ellipse(tx, y0 + 16, 18, 11, 0, 0, 7); x.fill();
  x.fillStyle = "#f3c6d6"; x.beginPath(); x.ellipse(tx, y0 + 12, 12, 7, 0, 0, 7); x.fill();
  x.fillStyle = "#fff"; x.beginPath(); x.ellipse(tx, y0 + 9, 6, 4, 0, 0, 7); x.fill();
  for (const s of [-1, 1]) { x.fillStyle = "rgba(220,240,255,0.9)"; x.beginPath(); x.ellipse(tx + s * 46, y0 + 16, 5, 7, 0, 0, 7); x.fill(); }
}
function stage(now) {
  // podest orkiestry (część sali, bez odcięcia)
  const y0 = 108, y1 = BY - 6;
  x.fillStyle = "rgba(0,0,0,0.35)"; rr(150, y0 + 6, 420, y1 - y0, 16); x.fill();
  const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, "#6b3f22"); g.addColorStop(1, "#4a2a16");
  x.fillStyle = g; rr(150, y0, 420, y1 - y0, 16); x.fill();
  x.strokeStyle = "#d4a017"; x.lineWidth = 3; rr(150, y0, 420, y1 - y0, 16); x.stroke();
  // głośniki
  for (const sx of [170, 520]) { x.fillStyle = "#1b1719"; rr(sx, y0 + 10, 30, 52, 6); x.fill(); x.fillStyle = "#3a3438"; x.beginPath(); x.arc(sx + 15, y0 + 26, 8, 0, 7); x.arc(sx + 15, y0 + 48, 10, 0, 7); x.fill(); }
  // klawisze
  x.fillStyle = "#1d1a20"; rr(230, y0 + 24, 110, 26, 5); x.fill();
  x.fillStyle = "#f4f1ea"; for (let i = 0; i < 12; i++) x.fillRect(236 + i * 8.4, y0 + 30, 7, 16);
  // perkusja
  for (const [dx, dy, r] of [[420, 30, 16], [452, 26, 12], [470, 46, 14], [438, 52, 10]]) { x.fillStyle = "#c0182c"; x.beginPath(); x.arc(dx, y0 + dy, r, 0, 7); x.fill(); x.fillStyle = "#f2efe8"; x.beginPath(); x.arc(dx, y0 + dy, r - 3, 0, 7); x.fill(); }
  x.fillStyle = "#d4a017"; x.beginPath(); x.ellipse(400, y0 + 14, 11, 5, 0, 0, 7); x.fill();
  // wielkie kolumny w górnych rogach (tam nie da się wejść)
  for (const sx of [12, W - 136]) bigSpeaker(sx, 100, now);
  // nutki nad sceną
  x.font = `900 22px ${HEAD_FONT}`; x.textAlign = "center";
  for (let i = 0; i < 3; i++) { const t = ((now * 0.0004 + i / 3) % 1); x.globalAlpha = 1 - t; x.fillStyle = "#ffd24c"; x.fillText("♪", 300 + i * 50, y0 + 6 - t * 40); }
  x.globalAlpha = 1;
}
function bigSpeaker(x0, y0, now) {
  const w = 124, h = BY - y0 - 4;
  x.fillStyle = "rgba(0,0,0,0.4)"; rr(x0 + 4, y0 + 8, w, h, 12); x.fill();
  const g = x.createLinearGradient(x0, 0, x0 + w, 0); g.addColorStop(0, "#2a2428"); g.addColorStop(0.5, "#1b171a"); g.addColorStop(1, "#0e0c0d");
  x.fillStyle = g; rr(x0, y0, w, h, 12); x.fill();
  x.strokeStyle = "#d4a017"; x.lineWidth = 3; rr(x0, y0, w, h, 12); x.stroke();
  const pulse = 1 + Math.max(0, Math.sin(now * 0.016)) * 0.08;
  for (const [cx, cy, r] of [[x0 + w / 2 - 30, y0 + h / 2 + 4, 22], [x0 + w / 2 + 26, y0 + h / 2 + 4, 26]]) {
    x.fillStyle = "#0a0809"; x.beginPath(); x.arc(cx, cy, r + 4, 0, 7); x.fill();
    const cg = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r * pulse); cg.addColorStop(0, "#5a5458"); cg.addColorStop(1, "#1a1618");
    x.fillStyle = cg; x.beginPath(); x.arc(cx, cy, r * pulse, 0, 7); x.fill();
    x.fillStyle = "#2e292c"; x.beginPath(); x.arc(cx, cy, r * 0.32, 0, 7); x.fill();
  }
  for (let i = 0; i < 4; i++) { const on = Math.sin(now * 0.01 + i + x0) > 0; x.fillStyle = on ? ["#ff4f8b", "#4fa3ff", "#ffd24c", "#7dff9a"][i] : "#3a3438"; x.beginPath(); x.arc(x0 + 22 + i * 27, y0 + 11, 4, 0, 7); x.fill(); }
}
function hall(now) {
  // podłoga: deski na całym ekranie (jak tła w innych rundach — bez czarnego paska)
  x.fillStyle = "#9c6537"; x.fillRect(0, vTop, W, vH);
  const PL = 32;
  for (let r = Math.floor(vTop / PL); r * PL < vTop + vH; r++) {
    const off = (r * 37) % 120;
    for (let c = -1; c * 120 < W + 120; c++) {
      const tone = ((r * 7 + c * 13) % 5);
      x.fillStyle = ["#a8703f", "#b17a47", "#a16a3a", "#b88250", "#ab7443"][tone];
      x.fillRect(c * 120 + off, r * PL, 118, PL - 2);
    }
  }
  x.fillStyle = "rgba(60,30,10,0.18)"; for (let r = Math.floor(vTop / PL); r * PL < vTop + vH; r++) x.fillRect(0, r * PL + PL - 2, W, 2);
  // parkiet
  const dx = DF[0] * C, dy = BY + DF[1] * C, dw = DF[2] * C, dh = DF[3] * C;
  for (let r = 0; r < DF[3] * 2; r++) for (let c = 0; c < DF[2] * 2; c++) { x.fillStyle = (r + c) % 2 ? "#ecd6aa" : "#e2c891"; x.fillRect(dx + c * C / 2, dy + r * C / 2, C / 2, C / 2); }
  const sh = x.createLinearGradient(dx, dy, dx + dw, dy + dh); sh.addColorStop(0, "rgba(255,255,255,0.28)"); sh.addColorStop(0.5, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(255,255,255,0.12)");
  x.fillStyle = sh; x.fillRect(dx, dy, dw, dh);
  x.strokeStyle = "#d4a017"; x.lineWidth = 6; x.strokeRect(dx, dy, dw, dh);
  // światła z góry
  for (let i = 0; i < 5; i++) {
    const lx = 60 + i * 150, ly = 120 + Math.sin(now * 0.0011 + i) * 30;
    const g = x.createRadialGradient(lx, ly + 420, 0, lx, ly + 420, 260);
    const col = ["255,80,140", "80,160,255", "255,210,80", "170,90,255", "80,255,190"][i];
    const a = 0.1 + 0.05 * Math.sin(now * 0.003 + i);
    g.addColorStop(0, `rgba(${col},${a.toFixed(3)})`); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(lx - 260, ly + 160, 520, 520);
  }
  // przyciemnienie krawędzi (winieta jak w innych rundach)
  const vg = x.createRadialGradient(W / 2, H * 0.45, 300, W / 2, H * 0.45, 820);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(10,4,0,0.55)");
  x.fillStyle = vg; x.fillRect(0, vTop, W, vH);
  // listwa pod salą (poza planszą, nie da się tam wejść)
  const by = BY + ROWS * C;
  x.fillStyle = "rgba(20,10,4,0.55)"; x.fillRect(0, by, W, vTop + vH - by); x.fillStyle = "#3a2214"; x.fillRect(0, by, W, 30); x.fillStyle = "#d4a017"; x.fillRect(0, by, W, 4);
  stage(now);
}

// ---- interfejs ----
const DP = { cx: W / 2, cy: 1110, s: 104, d: 108 };
const PAD = [
  { k: [0, -1], x: DP.cx, y: DP.cy - DP.d, rot: 0 },
  { k: [0, 1], x: DP.cx, y: DP.cy + DP.d, rot: Math.PI },
  { k: [-1, 0], x: DP.cx - DP.d, y: DP.cy, rot: -Math.PI / 2 },
  { k: [1, 0], x: DP.cx + DP.d, y: DP.cy, rot: Math.PI / 2 },
];
const pressed = new Map();
function goldBtn(cxx, cyy, w, h, r, down) {
  const lift = down ? 2 : 7;
  x.fillStyle = "rgba(0,0,0,0.35)"; rr(cxx - w / 2, cyy - h / 2 + 9, w, h, r); x.fill();
  x.fillStyle = "#9a5d12"; rr(cxx - w / 2, cyy - h / 2 + lift - 2 + (down ? 5 : 0), w, h, r); x.fill();
  const g = x.createLinearGradient(0, cyy - h / 2, 0, cyy + h / 2);
  g.addColorStop(0, down ? "#f2c75a" : "#ffe28a"); g.addColorStop(0.55, down ? "#e0a52e" : "#f4bd3d"); g.addColorStop(1, "#d99a22");
  x.fillStyle = g; rr(cxx - w / 2, cyy - h / 2 + (down ? 5 : 0), w, h, r); x.fill();
  x.fillStyle = "rgba(255,255,255,0.35)"; rr(cxx - w / 2 + 8, cyy - h / 2 + 6 + (down ? 5 : 0), w - 16, h * 0.28, r * 0.6); x.fill();
  return down ? 5 : 0;
}
function arrow(cxx, cyy, rot, s) {
  x.save(); x.translate(cxx, cyy); x.rotate(rot);
  x.fillStyle = "#4a2408"; x.beginPath(); x.moveTo(0, -s); x.lineTo(s * 0.95, s * 0.6); x.lineTo(-s * 0.95, s * 0.6); x.closePath(); x.fill();
  x.restore();
}
function dpad() {
  // w trakcie gry krzyżak półprzezroczysty — sala i postacie widać pod spodem
  x.save(); x.globalAlpha = state === "play" ? 0.42 : 0.85;
  x.fillStyle = "rgba(20,10,4,0.45)"; x.beginPath(); x.arc(DP.cx, DP.cy, DP.d + DP.s * 0.75, 0, 7); x.fill();
  x.strokeStyle = "rgba(230,169,46,0.55)"; x.lineWidth = 3; x.stroke();
  for (const b of PAD) {
    const down = [...pressed.values()].includes(b);
    x.globalAlpha = down ? 0.95 : state === "play" ? 0.42 : 0.85;
    const o = goldBtn(b.x, b.y, DP.s, DP.s, 26, down);
    arrow(b.x, b.y + o, b.rot, 24);
  }
  const g = x.createRadialGradient(DP.cx - 6, DP.cy - 6, 2, DP.cx, DP.cy, 30); g.addColorStop(0, "#3a2414"); g.addColorStop(1, "#1a0e06");
  x.globalAlpha = state === "play" ? 0.42 : 0.85;
  x.fillStyle = g; x.beginPath(); x.arc(DP.cx, DP.cy, 26, 0, 7); x.fill();
  x.restore();
}
function counter() {
  const label = `Liczba osób w pociągu: ${snake.length - 1}`;
  x.font = `900 30px ${HEAD_FONT}`;
  const w = x.measureText(label).width + 56, h = 62, x0 = (W - w) / 2, y0 = 30;
  x.fillStyle = "rgba(0,0,0,0.4)"; rr(x0, y0 + 4, w, h, h / 2); x.fill();
  const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, "#251b11"); g.addColorStop(1, "#130c06");
  x.fillStyle = g; rr(x0, y0, w, h, h / 2); x.fill();
  x.strokeStyle = "#e6a92e"; x.lineWidth = 3.5; rr(x0, y0, w, h, h / 2); x.stroke();
  x.textAlign = "center"; x.textBaseline = "middle";
  x.lineWidth = 5; x.strokeStyle = "rgba(0,0,0,0.5)"; x.strokeText(label, W / 2, y0 + h / 2 + 1);
  x.fillStyle = "#fff7ec"; x.fillText(label, W / 2, y0 + h / 2 + 1);
  x.textBaseline = "alphabetic";
  // postęp piosenki (bez napisów)
  const p = deps.duration() ? Math.min(1, deps.time() / deps.duration()) : 0;
  const bw = 420, bx = (W - bw) / 2, by = y0 + h + 12;
  x.fillStyle = "rgba(0,0,0,0.45)"; rr(bx, by, bw, 10, 5); x.fill();
  const pg = x.createLinearGradient(bx, 0, bx + bw, 0); pg.addColorStop(0, "#ffe28a"); pg.addColorStop(1, "#e6a92e");
  x.fillStyle = pg; rr(bx, by, Math.max(10, bw * p), 10, 5); x.fill();
}
function monetyWord(n) {
  if (n === 1) return "monetę";
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? "monety" : "monet";
}
function plural(n) {
  if (n === 1) return "osoba";
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? "osoby" : "osób";
}
function summary(now) {
  x.fillStyle = "rgba(10,5,2,0.6)"; x.fillRect(0, vTop, W, vH);
  const info = deps.againInfo(), canAgain = info.free > 0 || info.canPay;
  const pw = 620, ph = canAgain ? 960 : 840, x0 = (W - pw) / 2, y0 = Math.round((H - ph) / 2) - 20;
  x.fillStyle = "rgba(0,0,0,0.45)"; rr(x0, y0 + 8, pw, ph, 32); x.fill();
  const g = x.createLinearGradient(0, y0, 0, y0 + ph); g.addColorStop(0, "#2a1d12"); g.addColorStop(1, "#150d07");
  x.fillStyle = g; rr(x0, y0, pw, ph, 32); x.fill();
  x.strokeStyle = "#e6a92e"; x.lineWidth = 4; rr(x0, y0, pw, ph, 32); x.stroke();
  figure(W / 2, y0 + 190, DENIS, "D", now, 0, null, 1.6);
  const n = snake.length - 1;
  x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `900 34px ${HEAD_FONT}`; x.fillStyle = "#fff7ec"; const pl = plural(n); x.fillText("Do pociągu " + (pl === "osoba" ? "dołączyła" : pl === "osoby" ? "dołączyły" : "dołączyło"), W / 2, y0 + 270);
  x.font = `900 110px ${HEAD_FONT}`; x.lineWidth = 8; x.strokeStyle = "rgba(0,0,0,0.5)"; x.strokeText(String(n), W / 2, y0 + 360);
  const ng = x.createLinearGradient(0, y0 + 310, 0, y0 + 410); ng.addColorStop(0, "#ffe28a"); ng.addColorStop(1, "#e6a92e");
  x.fillStyle = ng; x.fillText(String(n), W / 2, y0 + 360);
  x.font = `900 34px ${HEAD_FONT}`; x.fillStyle = "#fff7ec"; x.fillText(plural(n) + "!", W / 2, y0 + 440);
  // monety
  const label = `Zebrałeś ${coins} ${monetyWord(coins)}`;
  x.font = `900 36px ${HEAD_FONT}`; const lw = x.measureText(label).width, lx = W / 2 - (lw + 56) / 2;
  coinIcon(lx + 22, y0 + 532, 0);
  const fl = `Złapane flaszki: ${flasks}`;
  x.font = `900 32px ${HEAD_FONT}`; const fw = x.measureText(fl).width, fx0 = W / 2 - (fw + 50) / 2;
  x.save(); x.translate(fx0 + 18, y0 + 600); x.scale(0.7, 0.7); bottleIcon(0, 8, 0); x.restore();
  x.textAlign = "left"; x.textBaseline = "middle"; x.fillStyle = "#bfe6ff"; x.fillText(fl, fx0 + 50, y0 + 598);
  x.font = `900 36px ${HEAD_FONT}`;
  x.textAlign = "left"; x.textBaseline = "middle"; x.fillStyle = "#ffd24c"; x.fillText(label, lx + 56, y0 + 530); x.textAlign = "center";
  x.textBaseline = "alphabetic";
  // ZAGRAJ PONOWNIE (darmowa próba / 15 monet) | WYNIKI | WRÓĆ
  let by = y0 + 680;
  BTN_AGAIN = null;
  if (canAgain) {
    const r = { x: W / 2 - 260, y: by, w: 520, h: 118 };
    BTN_AGAIN = r;
    goldBtn(W / 2, by + r.h / 2, r.w, r.h, 28, false);
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#4a2408";
    if (info.free > 0) {
      x.font = `900 38px ${HEAD_FONT}`; x.fillText("ZAGRAJ PONOWNIE", W / 2, by + 44);
      x.font = `900 22px ${HEAD_FONT}`; x.fillText(`(${freeLeftText(info.free)})`, W / 2, by + 84);
    } else {
      x.font = `900 36px ${HEAD_FONT}`; x.fillText(`ZAGRAJ PONOWNIE (${info.cost} MONET)`, W / 2, by + r.h / 2 + 2);
    }
    by += r.h + 30;
  }
  BTN_BOARD = { x: W / 2 - 260, y: by, w: 250, h: 92 };
  BTN_MENU = { x: W / 2 + 10, y: by, w: 250, h: 92 };
  darkBtn(BTN_BOARD, "WYNIKI");
  darkBtn(BTN_MENU, "WRÓĆ");
  x.textBaseline = "alphabetic";
}
function freeLeftText(n) {
  if (n === 1) return "została Ci 1 darmowa próba";
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? `zostały Ci ${n} darmowe próby` : `zostało Ci ${n} darmowych prób`;
}
/** Ciemny przycisk ze złotą ramką (jak WYNIKI / NAGRODY na karuzeli). */
function darkBtn(r, label) {
  x.fillStyle = "rgba(0,0,0,0.4)"; rr(r.x, r.y + 6, r.w, r.h, 22); x.fill();
  const g = x.createLinearGradient(0, r.y, 0, r.y + r.h); g.addColorStop(0, "#2a1d12"); g.addColorStop(1, "#140c06");
  x.fillStyle = g; rr(r.x, r.y, r.w, r.h, 22); x.fill();
  x.strokeStyle = "#e6a92e"; x.lineWidth = 3.5; rr(r.x, r.y, r.w, r.h, 22); x.stroke();
  x.font = `900 34px ${HEAD_FONT}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#fff7ec";
  x.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 2);
}
const inR = (r, mx, my) => r && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
function bigIcon(kind, now) {
  x.fillStyle = "rgba(10,5,2,0.45)"; x.fillRect(0, vTop, W, vH);
  const p = 1 + Math.sin(now * 0.006) * 0.05;
  x.save(); x.translate(W / 2, BY + 7 * C); x.scale(p, p);
  goldBtn(0, 0, 170, 170, 85, false);
  x.fillStyle = "#4a2408";
  if (kind === "play") { x.beginPath(); x.moveTo(-26, -40); x.lineTo(44, 0); x.lineTo(-26, 40); x.closePath(); x.fill(); }
  else { x.strokeStyle = "#4a2408"; x.lineWidth = 16; x.lineCap = "round"; x.beginPath(); x.arc(0, 0, 40, -Math.PI * 0.2, Math.PI * 1.45); x.stroke(); x.beginPath(); x.moveTo(30, -46); x.lineTo(46, -14); x.lineTo(12, -16); x.closePath(); x.fill(); }
  x.restore();
}

// ---- przedmioty ----
function coinIcon(cx, cy, now) {
  const sx = Math.abs(Math.cos(now * 0.005)) * 0.8 + 0.2; // obrót monety
  x.fillStyle = "rgba(255,210,80,0.35)"; x.beginPath(); x.ellipse(cx, cy + 14, 26, 10, 0, 0, 7); x.fill();
  x.save(); x.translate(cx, cy - 10 + Math.sin(now * 0.006) * 4); x.scale(sx, 1);
  x.fillStyle = "#a8650e"; x.beginPath(); x.arc(0, 3, 22, 0, 7); x.fill();
  const g = x.createRadialGradient(-7, -8, 2, 0, 0, 24); g.addColorStop(0, "#fff3b0"); g.addColorStop(0.5, "#ffcf3a"); g.addColorStop(1, "#d48a14");
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 22, 0, 7); x.fill();
  x.strokeStyle = "#b8730f"; x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 15, 0, 7); x.stroke();
  x.fillStyle = "#b8730f"; x.font = `900 20px ${HEAD_FONT}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("5", 0, 1); x.textBaseline = "alphabetic";
  x.restore();
}
function bottleIcon(cx, cy, now) {
  x.fillStyle = "rgba(180,220,255,0.35)"; x.beginPath(); x.ellipse(cx, cy + 14, 24, 9, 0, 0, 7); x.fill();
  x.save(); x.translate(cx, cy - 8); x.rotate(Math.sin(now * 0.005) * 0.12);
  const g = x.createLinearGradient(-14, 0, 14, 0); g.addColorStop(0, "rgba(200,225,240,0.95)"); g.addColorStop(0.35, "rgba(255,255,255,0.98)"); g.addColorStop(1, "rgba(170,200,220,0.95)");
  x.fillStyle = g; x.beginPath(); x.moveTo(-13, 26); x.lineTo(-13, -4); x.quadraticCurveTo(-13, -12, -6, -16); x.lineTo(-5, -30); x.lineTo(5, -30); x.lineTo(6, -16); x.quadraticCurveTo(13, -12, 13, -4); x.lineTo(13, 26); x.quadraticCurveTo(0, 30, -13, 26); x.fill();
  x.strokeStyle = "rgba(120,150,170,0.8)"; x.lineWidth = 1.5; x.stroke();
  x.fillStyle = "#c0182c"; rr(-6, -38, 12, 9, 2); x.fill();
  x.fillStyle = "#fffaf0"; rr(-11, 2, 22, 16, 3); x.fill();
  x.fillStyle = "#c0182c"; rr(-8, 6, 16, 3, 1); x.fill(); x.fillStyle = "#d4a017"; rr(-8, 11, 16, 2, 1); x.fill();
  x.fillStyle = "rgba(255,255,255,0.8)"; rr(-10, -6, 4, 24, 2); x.fill();
  x.restore();
}
/** Po flaszce: ikonka butelki z kurczącym się kółkiem czasu (bez napisów). */
function drunkBadge(now) {
  const left = Math.max(0, (drunkUntil - now) / DRUNK_MS), cx = W - 70, cy = 230;
  x.fillStyle = "rgba(120,200,120,0.07)"; x.fillRect(0, vTop, W, vH);
  x.fillStyle = "rgba(20,10,4,0.7)"; x.beginPath(); x.arc(cx, cy, 40, 0, 7); x.fill();
  x.strokeStyle = "#7fd4ff"; x.lineWidth = 6; x.beginPath(); x.arc(cx, cy, 40, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); x.stroke();
  x.save(); x.translate(cx, cy + 8); x.scale(0.75, 0.75); bottleIcon(0, 0, now); x.restore();
}

// ---- pętla ----
function frame(now) {
  const dt = Math.min(50, now - (last || now)); last = now;
  if (state === "play") { const d = deps.duration(), t = deps.time(); if (d > 0 && t > 0 && t >= d - 0.05) finish(true); }
  if (state === "play") { acc += dt; while (acc >= tick && state === "play") { acc -= tick; step(); } }
  const k = state === "play" ? Math.min(1, acc / tick) : 1;
  x.save();
  if (shake > 0) { x.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.86; if (shake < 0.5) shake = 0; }
  const drunk = now < drunkUntil;
  if (drunk) { const a = Math.sin(now * 0.004) * 0.025; x.translate(W / 2, H / 2); x.rotate(a); x.scale(1.03, 1.03); x.translate(-W / 2, -H / 2); }
  hall(now);
  if (state === "play") items = items.filter((it) => now - it.born < ITEM_MS);
  for (const [c, r] of TABLES) table((c + 1) * C, BY + (r + 1) * C, false);
  const draw = [];
  if (food) { const fxp = px(food.c), fyp = py(food.r); draw.push({ y: fyp, f: () => { const q = 1 + Math.sin(now * 0.008) * 0.14; x.fillStyle = "rgba(255,210,80,0.38)"; x.beginPath(); x.ellipse(fxp, fyp + 10, 32 * q, 14 * q, 0, 0, 7); x.fill(); figure(fxp, fyp + 12, food.o, "D", now, 0, null, 0.82); } }); }
  for (const p of couple) { const fxp = px(p.c), fyp = py(p.r); draw.push({ y: fyp, f: () => { const q = 1 + Math.sin(now * 0.008) * 0.14; x.fillStyle = "rgba(255,255,255,0.4)"; x.beginPath(); x.ellipse(fxp, fyp + 10, 34 * q, 15 * q, 0, 0, 7); x.fill(); figure(fxp, fyp + 12, p.o, "D", now, p.c, null, 0.82); } }); }
  const pos = snake.map((s) => ({ x: px(s.pc + (s.c - s.pc) * k), y: py(s.pr + (s.r - s.pr) * k) }));
  snake.forEach((s, i) => {
    const p = pos[i], q = i > 0 ? pos[i - 1] : { x: p.x + dir[0], y: p.y + dir[1] };
    let dx = q.x - p.x, dy = q.y - p.y; if (Math.hypot(dx, dy) < 1) { dx = dir[0]; dy = dir[1]; }
    const f = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy < 0 ? "U" : "D";
    const l = Math.hypot(dx, dy) || 1;
    draw.push({ y: p.y, f: () => figure(p.x, p.y + 12, s.o, f, now, i * 0.8, i > 0 ? [dx / l, dy / l] : null, 0.82) });
  });
  for (const [c, r] of TABLES) { const ty = BY + (r + 1) * C; draw.push({ y: ty + 30, f: () => table((c + 1) * C, ty, true) }); }
  draw.push({ y: BY + HEAD_ROW * C + C - 6, f: headTable });
  for (const it of items) {
    const left = ITEM_MS - (now - it.born);
    if (left < 1500 && Math.floor(now / 120) % 2) continue; // miga przed zniknięciem
    const ix = px(it.c), iy = py(it.r);
    draw.push({ y: iy, f: () => (it.kind === "coin" ? coinIcon(ix, iy, now) : bottleIcon(ix, iy, now)) });
  }
  draw.sort((a, b) => a.y - b.y).forEach((d) => d.f());
  lost = lost.filter((l) => l.t < 1);
  for (const l of lost) { l.t += dt / 700; l.x += l.vx * dt / 1000; l.vy += 600 * dt / 1000; l.y += l.vy * dt / 1000; x.globalAlpha = 1 - l.t; figure(l.x, l.y, l.o, "D", now, 0, null, 0.82); x.globalAlpha = 1; }
  fx = fx.filter((n) => n.t < 1);
  x.font = `900 32px ${HEAD_FONT}`; x.textAlign = "center";
  for (const n of fx) {
    n.t += dt / 900; n.x += n.vx * dt / 1000; n.y += n.vy * dt / 1000; x.globalAlpha = 1 - n.t;
    if (n.txt) { x.font = `900 44px ${HEAD_FONT}`; x.lineWidth = 7; x.strokeStyle = "rgba(60,30,0,0.7)"; x.strokeText(n.txt, n.x, n.y); x.fillStyle = "#ffd24c"; x.fillText(n.txt, n.x, n.y); x.font = `900 32px ${HEAD_FONT}`; }
    else if (n.bubble) { x.strokeStyle = "rgba(220,240,255,0.9)"; x.lineWidth = 3; x.beginPath(); x.arc(n.x, n.y, 6 + n.t * 8, 0, 7); x.stroke(); }
    else { x.fillStyle = n.heart ? "#ff6f9f" : "#ffd24c"; x.fillText(n.heart ? "♥" : "♪", n.x, n.y); }
    x.globalAlpha = 1;
  }
  x.restore();
  if (drunk && state === "play") drunkBadge(now);
  counter();
  dpad();
  if (state === "paused") bigIcon("play", now);
  if (state === "play") countdown(now);
  if (state === "loading") loadingIcon(now);
  if (state === "done" && now - overAt > 650) summary(now);
}
/** 3-2-1 jak w innych rundach, potem podpowiedź: stuknij strzałkę, żeby ruszyć. */
function countdown(now) {
  const t = deps.time();
  if (t < 0) {
    const n = Math.min(3, Math.ceil(-t));
    const f = -t - Math.floor(-t); // 1 → 0 w ramach sekundy
    const sc = 1 + (1 - f) * 0.25;
    x.save(); x.translate(W / 2, BY + 7 * C); x.scale(sc, sc);
    x.font = `900 190px ${HEAD_FONT}`; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = 14; x.strokeStyle = "rgba(40,20,0,0.75)"; x.strokeText(String(n), 0, 0);
    const g = x.createLinearGradient(0, -90, 0, 90); g.addColorStop(0, "#ffe28a"); g.addColorStop(1, "#e6a92e");
    x.fillStyle = g; x.fillText(String(n), 0, 0);
    x.restore(); x.textBaseline = "alphabetic";
  } else if (waiting) {
    // pulsujące strzałki wokół Denisa — „ruszaj!"
    const h = snake[0], cx = px(h.c), cy = py(h.r) - 30, a = 0.5 + 0.5 * Math.sin(now * 0.008);
    x.save(); x.globalAlpha = 0.45 + 0.55 * a;
    for (const [dx, dy, rot] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2]]) {
      x.save(); x.translate(cx + dx * 70, cy + dy * 70); x.rotate(rot);
      x.fillStyle = "#ffd24c"; x.strokeStyle = "rgba(60,30,0,0.8)"; x.lineWidth = 4;
      x.beginPath(); x.moveTo(0, -16); x.lineTo(16, 10); x.lineTo(-16, 10); x.closePath(); x.fill(); x.stroke();
      x.restore();
    }
    x.restore();
  }
}
function loadingIcon(now) {
  x.fillStyle = "rgba(10,5,2,0.45)"; x.fillRect(0, vTop, W, vH);
  x.save(); x.translate(W / 2, BY + 7 * C); x.rotate(now * 0.006);
  x.strokeStyle = "#ffd24c"; x.lineWidth = 12; x.lineCap = "round"; x.beginPath(); x.arc(0, 0, 50, 0, Math.PI * 1.4); x.stroke();
  x.restore();
}
let BTN_AGAIN = null, BTN_MENU = null, BTN_BOARD = null;

// ---- sterowanie: krzyżak (+ strzałki na klawiaturze) ----
function turn(d) {
  if (deps.time() < 0) return; // trwa odliczanie 3-2-1
  if (waiting) { waiting = false; dir = d; queue = []; acc = 0; buzz(15); return; } // pierwszy ruch: dowolny kierunek
  if (performance.now() < drunkUntil) d = [-d[0], -d[1]]; // po flaszce: lewo i prawo, góra i dół zamienione
  const lastDir = queue.length ? queue[queue.length - 1] : dir;
  if (d[0] === lastDir[0] && d[1] === lastDir[1]) return;
  if (d[0] === -lastDir[0] && d[1] === -lastDir[1]) return; // zawrócenie w siebie — ignoruj
  if (queue.length < 2) { queue.push(d); buzz(8); }
}
/** Kierunek z krzyżaka: cały krąg dzielony na 4 ćwiartki (nie trzeba trafiać w sam przycisk). */
function padAt(mx, my) {
  const dx = mx - DP.cx, dy = my - DP.cy, d = Math.hypot(dx, dy);
  // cały dół ekranu działa jak krzyżak: przyciski wyglądają tak samo, ale łapią dużo szerzej
  if (d < 10 || (d > 330 && my < DP.cy - 230)) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? PAD[3] : PAD[2];
  return dy > 0 ? PAD[1] : PAD[0];
}

state = "loading"; reset();
const near = (b, mx, my) => b && Math.hypot(mx - b.x, my - b.y) < 80;

return {
  /** muzyka wczytana — pokaż przycisk startu */
  loaded() { if (state === "loading") { reset(); state = "play"; acc = 0; deps.play(); } },
  isPlaying() { return state === "play"; },
  draw(ctx, now, top, vh) { x = ctx; vTop = top; vH = vh; frame(now); },
  /** stuknięcie we współrzędnych gry (układ 720×1280) */
  tap(mx, my) {
    if (state === "loading") return;
    if (state === "paused") { state = "play"; acc = 0; deps.resume(); return; }
    if (state === "done") {
      if (performance.now() - overAt < 900) return;
      if (inR(BTN_MENU, mx, my)) { deps.onExit(); return; }
      if (inR(BTN_BOARD, mx, my)) { deps.onBoard(); return; }
      if (inR(BTN_AGAIN, mx, my)) deps.onAgain();
      return;
    }
    const b = padAt(mx, my);
    if (b) { pressed.set(0, b); turn(b.k); setTimeout(() => pressed.delete(0), 120); }
  },
  /** klawiatura: 0 lewo, 1 góra, 2 dół, 3 prawo */
  key(k) {
    const d = [[-1, 0], [0, -1], [0, 1], [1, 0]][k];
    if (!d) return;
    if (state === "play") turn(d); else this.tap(-1, -1);
  },
  /** nowa gra od razu (po opłacie) */
  restart() { reset(); state = "play"; acc = 0; deps.play(); },
  /** apka w tle — pauza */
  pause() { if (state === "play") { state = "paused"; deps.pause(); } },
  /** wyjście z rundy (wstecz) — bez wyniku */
  abort() { if (state === "play" || state === "paused") deps.stop(); state = "loading"; },
};
}
