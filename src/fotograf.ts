// @ts-nocheck — kod przeniesiony z prototypu (podgląd w artefakcie, public/proto/fotograf.html), rysowanie canvas
// Runda „Fotograf weselny": gracz jest fotografem na zatłoczonym weselu. 13 chwil,
// każda raz w rundzie; tapnięcie w szczycie akcji = perfekcyjne zdjęcie. Na koniec
// album z kadrów gracza. Runda działa jako nakładka DOM nad kanwą gry (własna
// kanwa 9:16 + ekran startu i albumu), bez muzyki rundy (gra muzyka menu).

export const FOTO_SONG = "fotograf-weselny";

const CSS = `#fg-root { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: #170b14; padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); box-sizing: border-box; touch-action: manipulation; font-family: var(--body); color: var(--fg); }
${"\n/* jeden ekran gry: kanwa 9:16 wpisana w ekran, nakładki startu i albumu */\n#fg-root { --bg: #170b14; --fg: #f6e9ef; --muted: #b99aac; --gold: #f2c45a; --display: \"Big Shoulders Display\", \"Arial Narrow\", Impact, sans-serif; --body: \"Manrope\", system-ui, sans-serif; color-scheme: dark; }\n#fg-root [hidden] { display: none !important; }\n#fg-root .screen { position: relative; height: 100%; max-height: 1280px; aspect-ratio: 9 / 16; max-width: 100%; overflow: hidden; background: #000; }\n#fg-root canvas { display: block; width: 100%; height: 100%; touch-action: manipulation; }\n#fg-root .overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 22px; background: rgba(14,6,12,.85); }\n#fg-root .overlay h2 { font-family: var(--display); font-weight: 900; font-size: 46px; line-height: .95; margin: 0; text-transform: uppercase; color: var(--gold); }\n#fg-root .overlay p { margin: 0; max-width: 30ch; font-size: 14px; line-height: 1.5; }\n#fg-root .btn { font-family: var(--display); font-weight: 900; font-size: 24px; letter-spacing: .06em; text-transform: uppercase; color: #2a1206; background: linear-gradient(#ffe08a, #f2b13a); border: 0; border-radius: 14px; padding: 12px 34px; cursor: pointer; box-shadow: 0 4px 0 #a8661b; text-decoration: none; }\n#fg-root .album { position: absolute; inset: 0; background: #1d0f1a; overflow-y: auto; padding: 18px 14px 22px; display: flex; flex-direction: column; gap: 12px; }\n#fg-root .album header { text-align: center; }\n#fg-root .album h3 { font-family: var(--display); font-weight: 900; font-size: 34px; margin: 0; color: var(--gold); text-transform: uppercase; }\n#fg-root .album .sum { color: var(--muted); font-size: 13px; }\n#fg-root .stars { font-size: 28px; letter-spacing: 6px; color: var(--gold); }\n#fg-root .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }\n#fg-root .pol { background: #fbf6ee; padding: 5px 5px 4px; border-radius: 2px; box-shadow: 0 3px 8px rgba(0,0,0,.45); color: #2b1a22; transform: rotate(var(--r)); margin: 0; }\n#fg-root .pol img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }\n#fg-root .pol b { display: block; font-size: 10px; line-height: 1.2; margin-top: 4px; font-weight: 800; }\n#fg-root .pol i { display: block; font-style: normal; font-size: 9px; font-weight: 600; color: #8b5a6e; }\n#fg-root .pol.blur img { filter: blur(2px) saturate(.6); }\n#fg-root .pol.miss { background: #3a2335; color: var(--muted); display: flex; flex-direction: column; justify-content: center; text-align: center; min-height: 100%; }\n#fg-root .pol.miss b { color: var(--muted); }\n#fg-root .album .btn { align-self: center; margin-top: 6px; }\n"}
#fg-root .fg-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
#fg-root .btn.dark { background: #3a2335; color: #f6e9ef; box-shadow: 0 4px 0 #1d0f1a; }
#fg-root .fg-x { position: absolute; left: 50%; top: 42px; transform: translateX(-50%); width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(10,4,9,.55); color: #fff; font: 700 16px system-ui, sans-serif; cursor: pointer; }`;
const FONTS = "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Great+Vibes&family=Manrope:wght@400;600;800&display=swap";

function ensureAssets() {
  if (document.getElementById("fg-css")) return;
  const st = document.createElement("style"); st.id = "fg-css"; st.textContent = CSS; document.head.appendChild(st);
  const ln = document.createElement("link"); ln.rel = "stylesheet"; ln.href = FONTS; document.head.appendChild(ln);
}

/** Otwiera rundę nad grą. onClose = powrót do slidera, onFinish = wynik rundy. */
export function openFotograf(cb: { onClose(): void; onFinish(score: number, stars: number): void }) {
  ensureAssets();
  const root = document.createElement("div");
  root.id = "fg-root";
  root.innerHTML = `<div class="screen">
    <canvas aria-label="Runda Fotograf weselny"></canvas>
    <div class="overlay" id="fg-intro">
      <h2>Fotograf<br>weselny</h2>
      <p>Sala pełna gości. Gdzieś w tłumie zaraz wydarzy się coś, czego para młoda nie może przegapić. Wypatrz to i zrób zdjęcie w najlepszym momencie.</p>
      <p style="color:var(--muted);font-size:13px">13 wyjątkowych chwil, każda tylko raz. Klisza: 20 klatek.</p>
      <div class="fg-row"><button class="btn" id="fg-start">Zaczynamy</button><button class="btn dark" id="fg-back">Wróć</button></div>
    </div>
    <div class="album" id="fg-album" hidden></div>
  </div>`;
  document.body.appendChild(root);
  let game = null;
  const close = () => { game?.destroy(); root.remove(); cb.onClose(); };
  game = core(root.querySelector("canvas"), { root, onClose: close, onFinish: cb.onFinish });
  return { close };
}

/** Stopklatka sali do karty na sliderze (rysowana raz, potem z bufora). */
let still: HTMLCanvasElement | null = null;
export function fotografStill(): HTMLCanvasElement {
  if (still) return still;
  still = document.createElement("canvas");
  core(still, { preview: true, dpr: 2 });
  return still;
}


function core(cv, ui) {
const W = 360, H = 640;
let alive = true;
let ctx = cv.getContext("2d");
function swapCtx(g) { ctx = g; }
let dpr = 1;
function resize() {
  if (ui.preview) dpr = ui.dpr;
  else { const r = cv.getBoundingClientRect(); dpr = Math.min(3, (window.devicePixelRatio || 1) * (r.width / W)) || 1; }
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
}
const ro = ui.preview ? null : new ResizeObserver(resize);
if (ro) ro.observe(cv);
resize();

const FILM = 20, RADIUS = 58, DENIS_AT = 21;
const opts = { hint: false, slow: false };
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function ease(k) { return 1 - Math.pow(1 - k, 3); }

// ---------- chwile: każda raz w rundzie ----------
// pos(e) = środek akcji (celujemy w to miejsce); dla wędrujących postaci zależy od czasu
const waiterX = () => 225 + Math.sin(now * .45) * 38;
const SPOTS = {
  kiss:    { name: "Gorzko, gorzko!",       pos: () => [120, 168] },
  denis:   { name: "Denis wchodzi na scenę", pos: () => [292, 186] },
  dance:   { name: "Pierwszy taniec",        pos: () => [184, 404] },
  bouquet: { name: "Rzut bukietem",          pos: () => [176, 440] },
  cake:    { name: "Tort w locie",           pos: () => [64, 300] },
  cork:    { name: "Korek w powietrzu",      pos: () => [300, 292] },
  waiter:  { name: "Kelner się potyka",      pos: e => [e && e.fx != null ? e.fx : waiterX(), 368] },
  grandma: { name: "Babcia w breakdance",    pos: () => [72, 458] },
  kid:     { name: "Wślizg na kolanach",     pos: e => [kidX(e), 506] },
  conga:   { name: "Pociąg weselny",         pos: e => [congaX(e), 352] },
  uncle:   { name: "Wujek na stole",         pos: () => [60, 570] },
  mother:  { name: "Teściowa się wzrusza",   pos: () => [180, 574] },
  toast:   { name: "Sto lat!",               pos: () => [300, 568] },
};
const ORDER_KEYS = Object.keys(SPOTS).filter(k => k !== "denis");
const COUPLE = ["kiss", "dance", "bouquet"];

let state = "intro", t0 = 0, now = 0, schedule = [], events = [], done = new Set(), roundEnd = 60;
let score = 0, film = FILM, streak = 0, combo = 1, photos = [], popups = [], flash = 0, finder = null, pendingShot = null;

function phases() { const k = opts.slow ? 1.3 : 1; return { b: 2.0 * k, p: .8 * k, a: .9 * k }; }
function phaseOf(e) { const d = now - e.t; if (d < 0) return ["w", 0]; if (d < e.b) return ["b", d / e.b]; if (d < e.b + e.p) return ["p", (d - e.b) / e.p]; if (d < e.b + e.p + e.a) return ["a", (d - e.b - e.p) / e.a]; return ["x", 1]; }
function active(k) { return events.find(e => e.k === k); }

function buildSchedule() {
  const keys = ORDER_KEYS.slice();
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  // dwie chwile pary młodej nie mogą iść jedna po drugiej (para jest w jednym miejscu naraz)
  for (let i = 1; i < keys.length; i++) if (COUPLE.includes(keys[i]) && COUPLE.includes(keys[i - 1])) {
    const j = keys.findIndex((k, n) => n > i && !COUPLE.includes(k) && !COUPLE.includes(keys[n - 1] || ""));
    if (j > 0) [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const gap = opts.slow ? 4.4 : 3.6;
  const out = []; let t = 1.5, denisIn = false;
  for (const k of keys) {
    if (!denisIn && t + 3.2 > DENIS_AT) { out.push({ k: "denis", t: DENIS_AT }); denisIn = true; t = Math.max(t, DENIS_AT + gap); }
    out.push({ k, t: t + Math.random() * .6 }); t += gap;
  }
  if (!denisIn) out.push({ k: "denis", t: DENIS_AT });
  out.sort((a, b) => a.t - b.t);
  const ph = phases();
  for (const s of out) Object.assign(s, s.k === "denis" ? { b: 2.2, p: ph.p + .2, a: ph.a } : ph, { shot: false });
  roundEnd = out[out.length - 1].t + 4.5;
  return out;
}

// ---------- tłum ----------
let seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
const SKIN = ["#f3c9a4", "#e2a77d", "#f7d6bc", "#c88a5f"];
const CLOTH = ["#3d4f8a", "#9a2f55", "#2f6b5a", "#b0802f", "#5a3b7a", "#c2445a", "#2f7a8a", "#7a7a2f"];
const HAIR = ["#3a2216", "#7a4a22", "#d9b05a", "#1b1410", "#a33a1c", "#8a8a8a"];
const DRESS = ["#c2445a", "#3d6fba", "#2f8a6a", "#e08a3a", "#8a3b9a", "#e8b0c8"];
function look(s) {
  const fem = s % 2 === 0;
  // kolejne cechy z różnych "cyfr" ziarna, żeby goście nie wyglądali jak klony
  const h = n => Math.floor(s / n) % 997;
  return { skin: SKIN[h(3) % 4], hair: HAIR[(h(5) + s) % 6], hairStyle: fem ? (h(7) % 3 === 0 ? "long" : "bun") : h(7) % 5 === 0 ? "bald" : "short",
    kind: fem ? "dress" : "suit", dress: DRESS[(h(2) + h(11)) % 6], cloth: CLOTH[(h(2) * 3 + h(13)) % 8], beard: !fem && h(4) % 3 === 1,
    tie: !fem ? ["#c2183c", "#e8c65a", "#3d4f8a", null][h(6) % 4] : null };
}
const crowd = [];
(function makeCrowd() {
  // tańczący na parkiecie, gęsto, z dala od stołu z tortem, baru i stałych postaci
  const avoid = [[64, 326, 52], [306, 322, 58], [72, 470, 22], [kidHomeX(), 512, 18]];
  let tries = 0;
  while (crowd.length < 38 && tries++ < 4000) {
    const x = 14 + rnd() * 332, y = 262 + rnd() * 270;
    if (avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < r)) continue;
    if (crowd.some(c => Math.hypot(c.x - x, (c.y - y) * 1.6) < 30)) continue;
    const s = 1 + Math.floor(rnd() * 5000);
    crowd.push({ x, y, s, ph: rnd() * 6, ...look(s) });
  }
})();
// goście przy stolikach (siedzą za stołem)
const TABLES = [[60, 606], [180, 612], [300, 606]];
const seated = [];
TABLES.forEach(([tx, ty], ti) => { for (let i = 0; i < 5; i++) { if (ti === 0 && i === 2) continue; if (ti === 1 && i === 2) continue; const a = Math.PI + .35 + i * .6; seated.push({ x: tx + Math.cos(a) * 46, y: ty + Math.sin(a) * 18 - 2, s: 11 + ti * 7 + i * 3, ti, i }); } });

// ---------- figurki: duża głowa z nosem, ustami i błyszczącymi oczami, małe ciało ----------
function rr(x, y, w, h, r, g = ctx) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); }
function shade(c, k) {
  const n = parseInt(c.slice(1), 16), f = v => clamp(Math.round(v + (k > 0 ? (255 - v) * k : v * k)), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function gloss(x, y, w, h, c, g = ctx) { const gr = g.createLinearGradient(x, y, x + w * .6, y + h); gr.addColorStop(0, shade(c, .35)); gr.addColorStop(.5, c); gr.addColorStop(1, shade(c, -.38)); return gr; }

// głowa jest najbardziej szczegółowa, więc rysujemy ją raz do bufora (4x) i potem tylko kopiujemy
const headCache = new Map();
function mouthType(m) { return !m ? "smile" : m >= 1 ? "open" : "o"; }
function headSprite(o, mt) {
  const key = [o.skin, o.hair, o.hairStyle, o.beard ? 1 : 0, o.mustache || "", o.glasses ? 1 : 0, o.headband || "", mt, o.kind === "dress" ? 1 : 0, o.tiara ? 1 : 0].join("|");
  let c = headCache.get(key);
  if (c) return c;
  const S = 4; c = document.createElement("canvas"); c.width = 52 * S; c.height = 56 * S;
  const g = c.getContext("2d"); g.scale(S, S); g.translate(26, 32);
  drawHead(g, o, mt);
  headCache.set(key, c);
  return c;
}
function drawHead(g, o, mt) {
  const sk = o.skin, hr = o.hair, fem = o.kind === "dress";
  if (o.hairStyle === "long") { g.fillStyle = gloss(-17, -17, 34, 38, hr, g); rr(-17, -16, 34, 36, 13, g); g.fill(); }
  if (o.hairStyle === "bun") { g.fillStyle = gloss(-7, -26, 14, 13, hr, g); g.beginPath(); g.arc(0, -18.5, 6.8, 0, 7); g.fill(); g.strokeStyle = shade(hr, .3); g.lineWidth = .7; g.beginPath(); g.arc(0, -18.5, 4, 3.6, 5.6); g.stroke(); }
  // uszy
  g.fillStyle = shade(sk, -.1); ell(g, -14.3, 1.5, 3, 4); ell(g, 14.3, 1.5, 3, 4);
  g.fillStyle = shade(sk, -.25); ell(g, -14.5, 1.8, 1.3, 2.2); ell(g, 14.5, 1.8, 1.3, 2.2);
  // twarz
  const fg = g.createRadialGradient(-4, -6, 1, 0, 0, 21);
  fg.addColorStop(0, shade(sk, .32)); fg.addColorStop(.55, sk); fg.addColorStop(1, shade(sk, -.22));
  g.fillStyle = fg; rr(-14.5, -13.5, 29, 27, 12, g); g.fill();
  // broda / zarost
  if (o.beard) {
    g.fillStyle = gloss(-14, 0, 28, 15, hr, g);
    g.beginPath(); g.moveTo(-14.4, -1); g.quadraticCurveTo(-14.6, 13.8, 0, 14.6); g.quadraticCurveTo(14.6, 13.8, 14.4, -1);
    g.quadraticCurveTo(12, 5, 8, 7.5); g.quadraticCurveTo(0, 6, -8, 7.5); g.quadraticCurveTo(-12, 5, -14.4, -1); g.fill();
  }
  // rumieńce
  g.fillStyle = fem ? "rgba(255,110,130,.28)" : "rgba(220,110,90,.14)"; ell(g, -9, 6.5, 3.2, 2); ell(g, 9, 6.5, 3.2, 2);
  // brwi
  g.strokeStyle = shade(hr === "#d0d0d0" || hr === "#8a8a8a" ? "#6a6a6a" : hr, -.35); g.lineWidth = 1.8; g.lineCap = "round";
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 9.2, -4); g.quadraticCurveTo(s * 6, -6.8, s * 2.6, -5); g.stroke(); }
  // oczy: duże, czarne, z dwoma odblaskami
  for (const ex of [-5.9, 5.9]) {
    const eg = g.createRadialGradient(ex - 1, 0, .5, ex, 1.3, 4.2); eg.addColorStop(0, "#3a3440"); eg.addColorStop(1, "#060509");
    g.fillStyle = eg; ell(g, ex, 1.3, 3.6, 4);
    g.fillStyle = "rgba(255,255,255,.95)"; ell(g, ex - 1.3, -.4, 1.3, 1.45);
    g.fillStyle = "rgba(255,255,255,.55)"; ell(g, ex + 1.2, 2.9, .6, .6);
  }
  if (fem) { g.strokeStyle = "#1a1016"; g.lineWidth = .9; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 9.2, -.3); g.lineTo(s * 10.6, -1.6); g.stroke(); } }
  // nos
  g.fillStyle = shade(sk, -.18); ell(g, 0, 6.6, 2.4, 1.7);
  g.fillStyle = shade(sk, .35); ell(g, -.6, 5.8, 1, .65);
  // wąsy
  const mc = o.mustache || (o.beard ? hr : null);
  if (mc) { g.fillStyle = gloss(-6, 7.6, 12, 3, mc, g); g.beginPath(); g.moveTo(-6.2, 10.2); g.quadraticCurveTo(-3, 7.4, 0, 8.6); g.quadraticCurveTo(3, 7.4, 6.2, 10.2); g.quadraticCurveTo(3, 9.6, 0, 10); g.quadraticCurveTo(-3, 9.6, -6.2, 10.2); g.fill(); }
  // usta
  const my = mc ? 11.2 : 10.2;
  if (mt === "smile") { g.strokeStyle = "#5a2420"; g.lineWidth = 1.15; g.beginPath(); g.moveTo(-3.6, my - .4); g.quadraticCurveTo(0, my + 2.6, 3.6, my - .4); g.stroke(); }
  else if (mt === "open") {
    g.fillStyle = "#4a1418"; g.beginPath(); g.moveTo(-4.2, my - .8); g.quadraticCurveTo(0, my + 6.4, 4.2, my - .8); g.closePath(); g.fill();
    g.save(); g.clip(); g.fillStyle = "#fff"; g.fillRect(-4.5, my - 1.2, 9, 1.8); g.fillStyle = "#e0627a"; ell(g, 0, my + 3.8, 2.4, 1.4); g.restore();
  } else { g.fillStyle = "#4a1418"; ell(g, 0, my + 1, 1.7, 2.1); }
  if (fem && mt === "smile") { g.strokeStyle = "rgba(200,60,90,.6)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-2.8, my); g.quadraticCurveTo(0, my + 2, 2.8, my); g.stroke(); }
  // włosy z przodu
  g.fillStyle = gloss(-15, -20, 30, 14, hr, g);
  if (o.hairStyle === "bald") {
    rr(-15.5, -5, 4.5, 10, 2.5, g); g.fill(); rr(11, -5, 4.5, 10, 2.5, g); g.fill();
    g.fillStyle = "rgba(255,255,255,.35)"; ell(g, -4, -10, 5, 2);
  } else if (fem) {
    g.beginPath(); g.moveTo(-15, 3); g.bezierCurveTo(-16.5, -14, -7, -19.5, 1, -18.5); g.bezierCurveTo(11, -18, 16.5, -11, 15, 3);
    g.bezierCurveTo(13, -4, 10, -8.5, 4, -9.5); g.bezierCurveTo(-2, -10.5, -9, -7, -12.5, -1); g.closePath(); g.fill();
  } else {
    g.beginPath(); g.moveTo(-14.8, -.5); g.bezierCurveTo(-16.5, -12, -10, -20.5, 0, -20); g.bezierCurveTo(10.5, -21, 16.5, -13, 14.8, -1.5);
    g.bezierCurveTo(13, -7.5, 9, -10.5, 3.5, -10); g.bezierCurveTo(-2.5, -9.5, -8.5, -9.8, -11.5, -6); g.closePath(); g.fill();
  }
  if (o.hairStyle !== "bald") {
    g.strokeStyle = shade(hr, .45); g.lineWidth = .8; g.globalAlpha = .7;
    for (const [a, b, c, d] of [[-9, -12, -2, -17], [-3, -12, 5, -17.5], [3, -11.5, 10, -15]]) { g.beginPath(); g.moveTo(a, b); g.quadraticCurveTo((a + c) / 2, d + 1, c, d); g.stroke(); }
    g.globalAlpha = 1;
  }
  if (o.tiara) { g.fillStyle = "#e8eef8"; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 3.4 - 1.4, -16); g.lineTo(i * 3.4, -19.5 + Math.abs(i) * .8); g.lineTo(i * 3.4 + 1.4, -16); g.fill(); } g.fillStyle = "#ff8ab0"; ell(g, 0, -18, 1, 1); }
  if (o.glasses) { g.strokeStyle = "#b8862e"; g.lineWidth = 1.1; for (const ex of [-5.9, 5.9]) { g.beginPath(); g.arc(ex, 1.3, 5.2, 0, 7); g.stroke(); } g.beginPath(); g.moveTo(-.7, 1); g.lineTo(.7, 1); g.stroke(); }
  if (o.headband) { g.fillStyle = gloss(-16, -10, 34, 6, o.headband, g); g.beginPath(); g.moveTo(-15.5, -7); g.lineTo(15, -10); g.lineTo(21, -3); g.lineTo(16, -6.5); g.lineTo(-15.5, -3); g.fill(); }
}

// o: { skin, hair, hairStyle: short|bun|bald|long, beard, mustache, kind: suit|dress|tux|vest, cloth, dress, tie, arm, arm2, mouth, glasses, headband, hold, after }
function funko(x, y, s, o, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  if (!o.noShadow) { ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(0, 0, 13, 3.2, 0, 0, 7); ctx.fill(); }
  const sleeve = o.kind === "dress" ? null : o.kind === "vest" ? "#f4f1ee" : o.cloth;
  if (o.kind === "dress") {
    const dc = o.dress || "#fbf5ee";
    ctx.fillStyle = gloss(-16, -22, 32, 22, dc);
    ctx.beginPath(); ctx.moveTo(-6, -15); ctx.lineTo(6, -15); ctx.bezierCurveTo(9, -9, 13, -4, 15.5, 0); ctx.quadraticCurveTo(0, 2.5, -15.5, 0); ctx.bezierCurveTo(-13, -4, -9, -9, -6, -15); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = .8;
    for (const fx of [-7, -2, 3, 8]) { ctx.beginPath(); ctx.moveTo(fx * .4, -13); ctx.quadraticCurveTo(fx * .8, -6, fx * 1.3, -.5); ctx.stroke(); }
    ctx.fillStyle = gloss(-6.5, -25, 13, 11, dc); rr(-6.5, -25, 13, 11, 4.5); ctx.fill();
    ctx.fillStyle = shade(dc, -.25); ctx.fillRect(-6.5, -15.5, 13, 1.6);
  } else {
    for (const sx of [-4.6, 4.6]) { ctx.fillStyle = "#121014"; ctx.beginPath(); ctx.ellipse(sx, -1.4, 4.2, 2.4, 0, 0, 7); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.ellipse(sx - 1.2, -2.3, 1.4, .6, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = gloss(-8, -8, 16, 7, o.kind === "vest" ? "#1e1a1e" : o.cloth); rr(-7.5, -8.5, 15, 7.5, 2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(-.5, -8, 1, 7);
    const body = o.kind === "vest" ? "#f4f1ee" : o.cloth;
    ctx.fillStyle = gloss(-9.5, -24, 19, 17, body); rr(-9.5, -24, 19, 17, 6); ctx.fill();
    if (o.kind === "vest") { ctx.fillStyle = gloss(-8, -21, 16, 14, "#1e1a1e"); ctx.beginPath(); ctx.moveTo(-8, -20); ctx.lineTo(-2.5, -20); ctx.lineTo(0, -12); ctx.lineTo(2.5, -20); ctx.lineTo(8, -20); ctx.lineTo(8, -8.5); ctx.lineTo(-8, -8.5); ctx.fill(); }
    else {
      ctx.fillStyle = "#f6f4f2"; ctx.beginPath(); ctx.moveTo(-3.6, -24); ctx.lineTo(3.6, -24); ctx.lineTo(0, -13.5); ctx.fill();
      ctx.fillStyle = o.kind === "tux" ? "#2c2a36" : shade(o.cloth, -.3);
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * 3.6, -24); ctx.lineTo(sd * 6.5, -23); ctx.lineTo(sd * 1.4, -13); ctx.lineTo(0, -13.5); ctx.fill(); }
      ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(0, -11, .9, 0, 7); ctx.fill();
    }
    if (o.kind === "tux") { ctx.fillStyle = "#111"; ctx.beginPath(); ctx.moveTo(-4.2, -23.4); ctx.lineTo(0, -21.6); ctx.lineTo(4.2, -23.4); ctx.lineTo(4.2, -19.6); ctx.lineTo(0, -21.4); ctx.lineTo(-4.2, -19.6); ctx.fill(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-6.2, -19, 1.7, 0, 7); ctx.fill(); ctx.fillStyle = "#7bb36a"; ctx.beginPath(); ctx.arc(-6.9, -17.6, .8, 0, 7); ctx.fill(); }
    if (o.tie) { ctx.fillStyle = gloss(-1.5, -23, 3, 9, o.tie); ctx.beginPath(); ctx.moveTo(-1.3, -23); ctx.lineTo(1.3, -23); ctx.lineTo(1.8, -15); ctx.lineTo(0, -13.5); ctx.lineTo(-1.8, -15); ctx.fill(); }
  }
  for (const [side, a] of [[1, o.arm], [-1, o.arm2]]) {
    if (a == null) continue;
    ctx.save(); ctx.translate(7.2 * side, -21); ctx.rotate(-a * 2.4 * side);
    if (sleeve) { ctx.fillStyle = gloss(-2.6, 0, 5.2, 10, sleeve); rr(-2.6, -1, 5.2, 11, 2.6); ctx.fill(); }
    else { ctx.fillStyle = o.skin; rr(-1.8, 0, 3.6, 10, 1.8); ctx.fill(); }
    ctx.fillStyle = gloss(-2.8, 9, 5.6, 5.6, o.skin); ctx.beginPath(); ctx.arc(0, 11.6, 2.8, 0, 7); ctx.fill();
    if (o.hold && side === 1) o.hold();
    ctx.restore();
  }
  const hy = -37;
  ctx.drawImage(headSprite(o, mouthType(o.mouth)), -26, hy - 32, 52, 56);
  if (o.after) o.after(hy);
  ctx.restore();
}
const GROOM = { skin: "#f3c9a4", hair: "#5a3520", hairStyle: "short", kind: "tux", cloth: "#1b1a22" };
const BRIDE = { skin: "#f7d6bc", hair: "#d9b05a", hairStyle: "bun", kind: "dress", tiara: true };
const GRANDMA = { skin: "#f3c9a4", hair: "#d0d0d0", hairStyle: "bun", kind: "dress", dress: "#7a3b8a", glasses: true };
const UNCLE = { skin: "#e2a77d", hair: "#8a8a8a", hairStyle: "bald", mustache: "#5a5a5a", kind: "suit", cloth: "#6b6f80", tie: "#c2183c" };
const MOTHER = { skin: "#f3c9a4", hair: "#8a3a1c", hairStyle: "bun", kind: "dress", dress: "#2f6b5a" };
const WAITER = { skin: "#e2a77d", hair: "#1b1410", hairStyle: "short", kind: "vest", cloth: "#1e1a1e" };
const KID = { skin: "#f7d6bc", hair: "#d9b05a", hairStyle: "short", kind: "suit", cloth: "#2f7a8a" };
// Denis: beżowy garnitur, rozpięta biała koszula, ciemna grzywka i broda, retro mikrofon na statywie
const DENIS = { skin: "#e3a77c", hair: "#2a1a12", hairStyle: "short", beard: true, kind: "suit", cloth: "#c8a37c" };
function retroMic(x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = "#1a1a1e"; ctx.beginPath(); ctx.ellipse(0, 0, 9, 2.6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = gloss(-1.2, -48, 2.4, 48, "#b8bcc6"); ctx.fillRect(-1.1, -46, 2.2, 46);
  ctx.fillStyle = "#3a3a42"; rr(-2, -26, 4, 3, 1); ctx.fill();
  ctx.fillStyle = "#3a3a42"; rr(-1.6, -49, 3.2, 4, 1); ctx.fill();
  const g = ctx.createLinearGradient(-5, 0, 5, 0); g.addColorStop(0, "#6c707a"); g.addColorStop(.35, "#f4f6fa"); g.addColorStop(.7, "#a8acb6"); g.addColorStop(1, "#4a4e58");
  ctx.fillStyle = g; rr(-5, -64, 10, 16, 5); ctx.fill();
  ctx.strokeStyle = "rgba(30,30,40,.55)"; ctx.lineWidth = .7; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-4.4, -60.5 + i * 2.4); ctx.lineTo(4.4, -60.5 + i * 2.4); ctx.stroke(); }
  ctx.fillStyle = "#d9dce4"; ctx.fillRect(-5, -56.5, 10, 1.3);
  ctx.restore();
}
function drawDenis(x, y, singing) {
  const bob = Math.sin(now * 8) * .8, sc = 1.25;
  retroMic(x - 24, y + 1, .82);
  funko(x, y + bob * .3, sc, { ...DENIS, mouth: singing ? 1.3 : (Math.sin(now * 9) > .3 ? .6 : 0), arm2: singing ? .62 : .5, arm: singing ? .95 : .05,
    hold: singing ? null : () => { ctx.fillStyle = gloss(-3, 8, 6, 6, DENIS.skin); ctx.beginPath(); ctx.arc(0, 11.6, 3, 0, 7); ctx.fill(); } });
  // dłoń na statywie
  ctx.fillStyle = gloss(x - 27, y - 33, 6, 6, DENIS.skin); ctx.beginPath(); ctx.arc(x - 24, y - 30 + bob * .3, 3.2, 0, 7); ctx.fill();
}
function groom(x, y, rot = 0, extra) { funko(x, y, 1.12, { ...GROOM, ...extra }, rot); }
function bride(x, y, rot = 0, extra) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  const vg = ctx.createLinearGradient(0, -58, 0, 0); vg.addColorStop(0, "rgba(255,255,255,.75)"); vg.addColorStop(1, "rgba(255,255,255,.15)");
  ctx.fillStyle = vg; ctx.beginPath(); ctx.moveTo(-4, -60); ctx.quadraticCurveTo(-28, -30, -20, 0); ctx.lineTo(-8, -2); ctx.quadraticCurveTo(-12, -30, 4, -58); ctx.fill();
  ctx.restore();
  funko(x, y, 1.12, { ...BRIDE, ...extra }, rot);
}
function heart(x, y, s, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "#ff4d7e"; ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.bezierCurveTo(-8, -3, -4, -9, 0, -4); ctx.bezierCurveTo(4, -9, 8, -3, 0, 4); ctx.fill(); ctx.restore();
}
function sparks(x, y, n, r, a, col = "255,226,140") {
  for (let i = 0; i < n; i++) { const an = i / n * 6.283 + now * 2; ctx.fillStyle = `rgba(${col},${a})`; ctx.beginPath(); ctx.arc(x + Math.cos(an) * r, y + Math.sin(an) * r, 2.2, 0, 7); ctx.fill(); }
}
function glass(x, y, a = 1) {
  ctx.fillStyle = `rgba(225,240,255,${.55 * a})`; ctx.beginPath(); ctx.moveTo(x - 3, y - 8); ctx.lineTo(x + 3, y - 8); ctx.quadraticCurveTo(x + 2.6, y - 1, x, y - .5); ctx.quadraticCurveTo(x - 2.6, y - 1, x - 3, y - 8); ctx.fill();
  ctx.fillStyle = `rgba(255,214,120,${.8 * a})`; ctx.beginPath(); ctx.moveTo(x - 2.4, y - 5); ctx.lineTo(x + 2.4, y - 5); ctx.quadraticCurveTo(x + 2, y - 1.2, x, y - 1); ctx.quadraticCurveTo(x - 2, y - 1.2, x - 2.4, y - 5); ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${.8 * a})`; ctx.fillRect(x - 2.4, y - 7.6, .9, 4);
  ctx.fillStyle = `rgba(225,240,255,${.7 * a})`; ctx.fillRect(x - .5, y - .5, 1, 4); ctx.fillRect(x - 2, y + 3.3, 4, .9);
}
function rose(x, y, r, c) {
  ctx.fillStyle = shade(c, -.2); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x - r * .15, y - r * .15, r * .75, 0, 7); ctx.fill();
  ctx.strokeStyle = shade(c, -.3); ctx.lineWidth = .6; ctx.beginPath(); ctx.arc(x, y, r * .45, 0, 4.5); ctx.stroke();
}
// tort na różowej paterze (jak w rundzie z tortem); y = blat stołu
function cakeShape(x, y, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = gloss(-12, -3, 24, 3, "#f08ab0"); ctx.beginPath(); ctx.ellipse(0, -1.5, 11, 2.6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = gloss(-3, -9, 6, 8, "#f08ab0"); ctx.beginPath(); ctx.moveTo(-2.5, -2); ctx.quadraticCurveTo(-1, -6, -3.5, -9); ctx.lineTo(3.5, -9); ctx.quadraticCurveTo(1, -6, 2.5, -2); ctx.fill();
  ctx.fillStyle = gloss(-25, -12, 50, 4, "#f7a3c4"); rr(-25, -12, 50, 4, 2); ctx.fill();
  const tiers = [[42, 15, -12], [31, 13, -27], [21, 11, -40]];
  for (const [w, h, b] of tiers) {
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, "#f3e6dc"); g.addColorStop(.35, "#fffaf6"); g.addColorStop(1, "#e2cfc2");
    ctx.fillStyle = g; rr(-w / 2, b - h, w, h, 3); ctx.fill();
    ctx.fillStyle = "#ffb3cd"; ctx.beginPath(); ctx.moveTo(-w / 2, b - h + 1); ctx.lineTo(w / 2, b - h + 1);
    for (let i = 0; i <= 6; i++) { const dx = w / 2 - i * w / 6, dd = 2.5 + ((i * 7) % 4); ctx.lineTo(dx, b - h + dd); ctx.lineTo(dx - w / 12, b - h + 2); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.55)"; for (let i = 0; i < w / 5; i++) { ctx.beginPath(); ctx.arc(-w / 2 + 2.5 + i * 5, b - 1.2, 1.1, 0, 7); ctx.fill(); }
  }
  rose(-14, -16, 3.2, "#ff6f9c"); rose(-10, -14, 2.4, "#ffffff"); rose(9, -30, 2.8, "#ff6f9c"); rose(12, -28, 2.2, "#ffd0e0");
  ctx.fillStyle = "#7bb36a"; ctx.beginPath(); ctx.ellipse(-17, -13, 2.4, 1, -.6, 0, 7); ctx.fill();
  ctx.strokeStyle = "#e8c65a"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -51); ctx.lineTo(0, -57); ctx.stroke();
  heart(0, -59, .6, 1);
  ctx.restore();
}
function label(t, x, y, a) { ctx.globalAlpha = a; ctx.font = "800 11px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(10,4,9,.65)"; const w = ctx.measureText(t).width + 10; rr(x - w / 2, y - 11, w, 15, 7); ctx.fill(); ctx.fillStyle = "#ffe9b0"; ctx.fillText(t, x, y); ctx.globalAlpha = 1; }

// okrągły stolik: obrus z fałdami, szarfa, kwiaty, świece, talerze
function roundTable(tx, ty) {
  const R = 52;
  const sg = ctx.createLinearGradient(0, ty, 0, ty + 26); sg.addColorStop(0, "#fbf7f2"); sg.addColorStop(1, "#d8cbc1");
  ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(tx - R, ty); ctx.lineTo(tx - R + 1, ty + 22);
  for (let i = 0; i <= 10; i++) { const x = tx - R + 1 + i * (2 * R - 2) / 10; ctx.quadraticCurveTo(x - (R - 1) / 10, ty + 27 + Math.sin(i) * 1.5, x, ty + 22 + (i % 2)); }
  ctx.lineTo(tx + R, ty); ctx.fill();
  ctx.strokeStyle = "rgba(160,130,120,.25)"; ctx.lineWidth = 1; for (let i = 1; i < 10; i++) { const x = tx - R + i * R / 5; ctx.beginPath(); ctx.moveTo(x, ty + 6 + Math.abs(i - 5) * 1.2); ctx.lineTo(x + (i - 5) * .4, ty + 23); ctx.stroke(); }
  ctx.fillStyle = "rgba(240,138,176,.85)"; ctx.beginPath(); ctx.moveTo(tx - 22, ty + 12); ctx.quadraticCurveTo(tx, ty + 20, tx + 22, ty + 12); ctx.lineTo(tx + 18, ty + 26); ctx.quadraticCurveTo(tx, ty + 30, tx - 18, ty + 26); ctx.fill();
  rose(tx, ty + 17, 3, "#ff6f9c");
  const tg = ctx.createRadialGradient(tx - 10, ty - 6, 2, tx, ty, R); tg.addColorStop(0, "#ffffff"); tg.addColorStop(1, "#ece2da");
  ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(tx, ty, R, 17, 0, 0, 7); ctx.fill();
  for (const [dx, dy] of [[-34, 0], [34, 0], [-18, 9], [18, 9], [0, 11]]) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(tx + dx, ty + dy, 6, 2.4, 0, 0, 7); ctx.fill(); ctx.strokeStyle = "#e8c65a"; ctx.lineWidth = .5; ctx.stroke(); }
  for (const dx of [-27, 25]) glass(tx + dx, ty + 1);
  for (const dx of [-12, 12]) { ctx.fillStyle = "#fffaf0"; ctx.fillRect(tx + dx - 1.5, ty - 12, 3, 10); const fl = 1 + Math.sin(now * 12 + dx) * .2; ctx.fillStyle = "rgba(255,200,90,.35)"; ctx.beginPath(); ctx.arc(tx + dx, ty - 14, 5 * fl, 0, 7); ctx.fill(); ctx.fillStyle = "#ffd36a"; ctx.beginPath(); ctx.ellipse(tx + dx, ty - 14, 1.3, 2.4 * fl, 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = "rgba(220,240,255,.45)"; rr(tx - 4, ty - 12, 8, 12, 2); ctx.fill();
  ctx.fillStyle = "#5f9a58"; for (const [dx, dy] of [[-9, -14], [9, -14], [-6, -19], [7, -19]]) { ctx.beginPath(); ctx.ellipse(tx + dx, ty + dy, 4, 1.8, dx * .06, 0, 7); ctx.fill(); }
  rose(tx - 5, ty - 17, 3.4, "#ff8ab0"); rose(tx + 4, ty - 18, 3.6, "#ffffff"); rose(tx, ty - 22, 3.2, "#ff6f9c"); rose(tx + 7, ty - 13, 2.6, "#ffd0e0"); rose(tx - 8, ty - 12, 2.6, "#ffffff");
}
// krzesło w pokrowcu z kokardą (za siedzącym gościem)
function chair(x, y) {
  ctx.fillStyle = gloss(x - 8, y - 32, 16, 22, "#f6f0ea"); rr(x - 8, y - 32, 16, 24, 6); ctx.fill();
  ctx.fillStyle = "#f08ab0"; ctx.fillRect(x - 8, y - 18, 16, 3);
  ctx.beginPath(); ctx.moveTo(x, y - 16.5); ctx.lineTo(x - 5, y - 20); ctx.lineTo(x - 5, y - 13); ctx.closePath(); ctx.moveTo(x, y - 16.5); ctx.lineTo(x + 5, y - 20); ctx.lineTo(x + 5, y - 13); ctx.closePath(); ctx.fill();
}

// ---------- tło sali: część stała rysowana raz do bufora, na wierzchu tylko to, co się rusza ----------
let bgCanvas = null, bgDpr = 0;
function hall() {
  if (!bgCanvas || bgDpr !== dpr) {
    bgCanvas = document.createElement("canvas"); bgCanvas.width = Math.round(W * dpr); bgCanvas.height = Math.round(H * dpr); bgDpr = dpr;
    const keep = ctx; const g = bgCanvas.getContext("2d"); g.scale(dpr, dpr);
    // rysujemy funkcjami opartymi na ctx, więc na chwilę podmieniamy kontekst
    swapCtx(g); hallStatic(); swapCtx(keep);
  }
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  hallLive();
}
function hallStatic() {
  // ściana: bordowe zasłony w fałdach
  let g = ctx.createLinearGradient(0, 0, 0, 236); g.addColorStop(0, "#22091c"); g.addColorStop(1, "#4d1a38");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 236);
  for (let i = 0; i < 18; i++) { const x = i * 20; const fg = ctx.createLinearGradient(x, 0, x + 20, 0); fg.addColorStop(0, "rgba(0,0,0,.22)"); fg.addColorStop(.5, "rgba(255,170,210,.07)"); fg.addColorStop(1, "rgba(0,0,0,.22)"); ctx.fillStyle = fg; ctx.fillRect(x, 0, 20, 236); }
  // podwieszone draperie u góry
  for (let i = 0; i < 6; i++) { const x = i * 60; const dg = ctx.createLinearGradient(0, 36, 0, 70); dg.addColorStop(0, "#f6e6ee"); dg.addColorStop(1, "#d9b8c8"); ctx.fillStyle = dg; ctx.beginPath(); ctx.moveTo(x, 36); ctx.quadraticCurveTo(x + 30, 82, x + 60, 36); ctx.quadraticCurveTo(x + 30, 60, x, 36); ctx.fill(); }
  // ścianka kwiatowa za stołem pary młodej
  const ax = 120, ay = 196;
  ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.beginPath(); ctx.ellipse(ax, ay, 98, 120, 0, Math.PI, 0); ctx.fill();
  let s = 3;
  const r2 = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 150; i++) {
    const a = Math.PI + r2() * Math.PI, rad = 90 + r2() * 14, x = ax + Math.cos(a) * rad, y = ay + Math.sin(a) * rad * 1.18;
    if (y > 190) continue;
    if (i % 3) { ctx.fillStyle = ["#4f8a4a", "#3d7040", "#6aa35e"][i % 3]; ctx.beginPath(); ctx.ellipse(x, y, 5, 2.4, a, 0, 7); ctx.fill(); }
    else rose(x, y, 3 + r2() * 2.5, ["#ff8ab0", "#ffffff", "#ffd0e0", "#ff6f9c"][i % 4]);
  }
  // neon z imionami
  ctx.save(); ctx.textAlign = "center"; ctx.font = "34px 'Great Vibes', 'Brush Script MT', cursive";
  ctx.shadowColor = "#ff5fa0"; ctx.shadowBlur = 14; ctx.fillStyle = "#ffd6e8"; ctx.fillText("Ania & Marek", ax, 104);
  ctx.shadowBlur = 0; ctx.font = "600 10px Manrope, sans-serif"; ctx.fillStyle = "rgba(255,214,232,.6)"; ctx.fillText("14 · 06 · 2026", ax, 118);
  ctx.restore();
  // scena: kratownica, ekran LED, głośniki, instrumenty
  ctx.fillStyle = "#12060f"; rr(224, 112, 136, 118, 6); ctx.fill();
  const lg = ctx.createLinearGradient(230, 124, 360, 190); lg.addColorStop(0, "#3a0f3a"); lg.addColorStop(.5, "#6a1a55"); lg.addColorStop(1, "#24104a");
  ctx.fillStyle = lg; rr(232, 124, 120, 70, 3); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.08)"; for (let x = 236; x < 352; x += 6) for (let y = 128; y < 192; y += 6) ctx.fillRect(x, y, 2, 2);
  ctx.strokeStyle = "#5a5a66"; ctx.lineWidth = 2; ctx.strokeRect(226, 114, 132, 6);
  ctx.lineWidth = .8; for (let x = 228; x < 358; x += 6) { ctx.beginPath(); ctx.moveTo(x, 114); ctx.lineTo(x + 6, 120); ctx.stroke(); }
  for (const x of [246, 280, 314, 344]) { ctx.fillStyle = "#1a1a1e"; rr(x - 5, 120, 10, 8, 2); ctx.fill(); }
  ctx.fillStyle = "#3b1530"; ctx.fillRect(222, 198, 138, 34);
  ctx.fillStyle = "#5a2048"; ctx.fillRect(222, 198, 138, 3);
  for (let x = 226; x < 360; x += 10) { ctx.fillStyle = "rgba(255,140,190,.35)"; ctx.beginPath(); ctx.arc(x, 214, 1.4, 0, 7); ctx.fill(); }
  for (const x of [228, 340]) { ctx.fillStyle = "#0d070c"; rr(x, 150, 18, 48, 3); ctx.fill(); ctx.fillStyle = "#26222a"; for (const [cy, cr] of [[162, 5], [184, 7]]) { ctx.beginPath(); ctx.arc(x + 9, cy, cr, 0, 7); ctx.fill(); } }
  ctx.fillStyle = "#2a2a30"; rr(250, 178, 26, 7, 2); ctx.fill(); ctx.fillStyle = "#eee"; ctx.fillRect(252, 179, 22, 3); ctx.fillStyle = "#555"; ctx.fillRect(262, 185, 2, 13);
  ctx.fillStyle = "#b03a4a"; ctx.beginPath(); ctx.ellipse(326, 190, 10, 7, 0, 0, 7); ctx.fill(); ctx.fillStyle = "#eee"; ctx.beginPath(); ctx.ellipse(326, 190, 6, 4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#e8c65a"; ctx.beginPath(); ctx.ellipse(314, 168, 8, 2, -.2, 0, 7); ctx.fill(); ctx.fillRect(313, 168, 1.5, 22);
  // parkiet: jodełka z połyskiem
  g = ctx.createLinearGradient(0, 232, 0, 548); g.addColorStop(0, "#4a2a1c"); g.addColorStop(1, "#8a5434");
  ctx.fillStyle = g; ctx.fillRect(0, 232, W, 316);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 232, W, 316); ctx.clip();
  for (let row = 0; row < 26; row++) {
    const y = 232 + row * 12.5;
    for (let col = -1; col < 20; col++) {
      const x = col * 20 + (row % 2) * 10;
      ctx.fillStyle = `rgba(${(col + row) % 3 ? "255,210,160" : "40,20,10"},${.035 + ((col * 7 + row * 3) % 5) * .012})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10, y + 6); ctx.lineTo(x + 10, y + 12.5); ctx.lineTo(x, y + 6.5); ctx.fill();
      ctx.strokeStyle = "rgba(30,12,6,.25)"; ctx.lineWidth = .5; ctx.stroke();
    }
  }
  const sh = ctx.createRadialGradient(180, 380, 10, 180, 380, 230); sh.addColorStop(0, "rgba(255,220,180,.16)"); sh.addColorStop(1, "rgba(255,220,180,0)");
  ctx.fillStyle = sh; ctx.fillRect(0, 232, W, 316);
  ctx.restore();
  // listwa i cień ściany
  ctx.fillStyle = "#2a0d20"; ctx.fillRect(0, 230, W, 5);
  g = ctx.createLinearGradient(0, 235, 0, 262); g.addColorStop(0, "rgba(0,0,0,.35)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 235, W, 27);
  // kwiatowe kolumny i balony przy ścianie
  for (const cx of [14, 346]) {
    ctx.fillStyle = gloss(cx - 4, 240, 8, 40, "#e8d9c8"); rr(cx - 4, 244, 8, 36, 2); ctx.fill(); ctx.fillStyle = "#f2e6d8"; rr(cx - 7, 278, 14, 4, 1); ctx.fill(); rr(cx - 7, 240, 14, 5, 1); ctx.fill();
    for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 4 + (i % 4) * 2.6; if (i % 3 === 0) { ctx.fillStyle = "#4f8a4a"; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * r, 232 + Math.sin(a) * r * .8, 4, 1.8, a, 0, 7); ctx.fill(); } else rose(cx + Math.cos(a) * r, 232 + Math.sin(a) * r * .8, 3.4, ["#ffffff", "#ff8ab0", "#ffd0e0"][i % 3]); }
  }
  const balloon = (x, y, c) => { ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.quadraticCurveTo(x + 3, y + 20, x, y + 30); ctx.stroke(); const bg = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 9); bg.addColorStop(0, shade(c, .5)); bg.addColorStop(1, c); ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(x, y, 7.5, 9, 0, 0, 7); ctx.fill(); };
  [[30, 206, "#f0b84a"], [42, 196, "#ff8ab0"], [22, 192, "#ffffff"], [210, 206, "#ff8ab0"], [200, 194, "#f0b84a"], [218, 190, "#ffffff"]].forEach(b => balloon(...b));
  // strefa stolików
  g = ctx.createLinearGradient(0, 548, 0, H); g.addColorStop(0, "#2b1222"); g.addColorStop(1, "#160710");
  ctx.fillStyle = g; ctx.fillRect(0, 548, W, H - 548);
  ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(0, 548, W, 3);
}
function hallLive() {
  // girlanda lampek
  ctx.strokeStyle = "rgba(255,230,180,.45)"; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, 50 + Math.sin(x / 60 * Math.PI) * 12);
  ctx.stroke();
  for (let x = 10; x < W; x += 20) {
    const y = 54 + Math.sin(x / 60 * Math.PI) * 12, tw = .6 + .4 * Math.sin(now * 3 + x);
    ctx.fillStyle = `rgba(255,214,140,${.22 * tw})`; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,236,190,${.7 + .3 * tw})`; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill();
  }
  // kula dyskotekowa i jej promienie
  const bx = 180, by = 78;
  ctx.strokeStyle = "#777"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, 36); ctx.lineTo(bx, by - 11); ctx.stroke();
  const bg = ctx.createRadialGradient(bx - 4, by - 4, 1, bx, by, 12); bg.addColorStop(0, "#ffffff"); bg.addColorStop(1, "#7a7a8a");
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, 11, 0, 7); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(bx, by, 11, 0, 7); ctx.clip();
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const on = (Math.floor(now * 8) + i * 3 + j * 5) % 7 === 0; ctx.fillStyle = on ? "rgba(255,255,255,.95)" : "rgba(40,40,60,.18)"; ctx.fillRect(bx + i * 3.4 + ((now * 6) % 3.4) - 1.5, by + j * 3.4 - 1.5, 2.6, 2.6); }
  ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const a = now * .5 + i * 1.57, tx = 180 + Math.cos(a) * 140, ty = 420 + Math.sin(a * 1.3) * 70;
    const lg = ctx.createLinearGradient(bx, by, tx, ty); lg.addColorStop(0, `hsla(${(i * 90 + now * 30) % 360},90%,70%,.10)`); lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx - 22, ty); ctx.lineTo(tx + 22, ty); ctx.fill();
  }
  for (let i = 0; i < 12; i++) {
    const a = now * .6 + i * .9, x = 180 + Math.cos(a) * (50 + i * 11), y = 400 + Math.sin(a * 1.3) * 120;
    ctx.fillStyle = `hsla(${(i * 50 + now * 40) % 360},90%,70%,.16)`; ctx.beginPath(); ctx.ellipse(x, y, 7, 3.5, 0, 0, 7); ctx.fill();
  }
  // światła sceny
  for (const [x, hue] of [[246, 320], [280, 40], [314, 200], [344, 280]]) {
    const sw = Math.sin(now * 1.4 + x) * 30;
    const lg = ctx.createLinearGradient(x, 128, x + sw, 230); lg.addColorStop(0, `hsla(${hue},90%,70%,.16)`); lg.addColorStop(1, `hsla(${hue},90%,70%,0)`);
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(x - 3, 128); ctx.lineTo(x + sw - 24, 232); ctx.lineTo(x + sw + 24, 232); ctx.lineTo(x + 3, 128); ctx.fill();
  }
  ctx.restore();
}
// front stołu pary młodej (zasłania nogi siedzących/stojących za nim)
function headTableFront() {
  const g = ctx.createLinearGradient(0, 184, 0, 222); g.addColorStop(0, "#fffaf6"); g.addColorStop(1, "#e2d4ca");
  ctx.fillStyle = g; rr(22, 186, 196, 34, 4); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillRect(22, 186, 196, 4);
  for (let i = 0; i < 6; i++) { const x = 22 + i * 32.6; ctx.fillStyle = "rgba(240,138,176,.85)"; ctx.beginPath(); ctx.moveTo(x, 190); ctx.quadraticCurveTo(x + 16.3, 212, x + 32.6, 190); ctx.quadraticCurveTo(x + 16.3, 202, x, 190); ctx.fill(); }
  for (let i = 0; i <= 6; i++) { const x = 22 + i * 32.6; rose(x, 191, 3.4, i % 2 ? "#ffffff" : "#ff8ab0"); ctx.fillStyle = "#4f8a4a"; ctx.beginPath(); ctx.ellipse(x - 5, 193, 3.5, 1.5, .4, 0, 7); ctx.fill(); }
  for (const x of [40, 200]) { ctx.fillStyle = "#fffaf0"; ctx.fillRect(x - 1.5, 172, 3, 14); const fl = 1 + Math.sin(now * 11 + x) * .2; ctx.fillStyle = "rgba(255,200,90,.35)"; ctx.beginPath(); ctx.arc(x, 170, 6 * fl, 0, 7); ctx.fill(); ctx.fillStyle = "#ffd36a"; ctx.beginPath(); ctx.ellipse(x, 170, 1.4, 2.6 * fl, 0, 0, 7); ctx.fill(); }
}
// bar: lada z panelami, półka z butelkami, wiaderko z lodem
function barBack() {
  ctx.fillStyle = "#2a160e"; rr(268, 276, 84, 6, 1); ctx.fill();
  const cols = ["#2f6b3a", "#8a3a1c", "#d9c27a", "#3a3a8a", "#2f6b3a", "#a33a5a", "#d9d9e0"];
  for (let i = 0; i < 7; i++) { const x = 274 + i * 11; ctx.fillStyle = gloss(x - 3, 258, 6, 18, cols[i]); rr(x - 3, 264, 6, 12, 2); ctx.fill(); ctx.fillRect(x - 1.2, 257, 2.4, 8); }
}
function barFront() {
  const g = ctx.createLinearGradient(0, 322, 0, 368); g.addColorStop(0, "#6a3a22"); g.addColorStop(1, "#2e170c");
  ctx.fillStyle = g; rr(258, 324, 98, 44, 4); ctx.fill();
  ctx.fillStyle = gloss(256, 320, 102, 7, "#d4a64a"); rr(256, 320, 102, 7, 3); ctx.fill();
  ctx.strokeStyle = "rgba(255,210,150,.18)"; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { rr(264 + i * 23, 332, 18, 28, 2); ctx.stroke(); }
  ctx.fillStyle = "rgba(255,120,180,.6)"; ctx.fillRect(258, 364, 98, 2);
  ctx.fillStyle = gloss(330, 306, 16, 16, "#c9c9d2"); ctx.beginPath(); ctx.moveTo(331, 308); ctx.lineTo(345, 308); ctx.lineTo(343, 321); ctx.lineTo(333, 321); ctx.fill();
  ctx.fillStyle = "#1f4a2a"; ctx.save(); ctx.translate(339, 306); ctx.rotate(.3); rr(-2.5, -12, 5, 12, 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = "rgba(230,245,255,.8)"; for (const [x, y] of [[334, 309], [341, 310], [337, 311]]) { ctx.fillRect(x, y, 3, 2.5); }
}

// ---------- rysowanie z głębią (sortowanie po y) ----------
let layer = [];
function put(y, f) { layer.push({ y, f }); }

function kidHomeX() { return 262; }
function kidX(e) { if (!e) return kidHomeX(); const [ph, k] = phaseOf(e); return ph === "b" ? kidHomeX() + 40 * Math.sin(k * Math.PI) * (k < .5 ? 1 : 0) : ph === "p" ? kidHomeX() - 20 - k * 120 : kidHomeX() - 140; }
function congaX(e) { const [ph, k] = phaseOf(e); return ph === "b" ? -40 + k * 200 : ph === "p" ? 160 + k * 50 : 210 + k * 220; }

function sceneObjects() {
  const ev = Object.fromEntries(events.map(e => [e.k, e]));
  const P = e => e ? phaseOf(e) : ["x", 0];
  const coupleAway = COUPLE.some(k => ev[k]);

  // para młoda przy stole + Gorzko
  {
    const e = ev.kiss, [ph, k] = P(e);
    if (e) {
      const lean = ph === "b" ? k * 4 : ph === "p" ? 6 : 6 * (1 - k);
      put(196, () => { groom(132 - lean, 196); bride(108 + lean, 196); });
      if (ph === "b") put(999, () => { label("GORZKO!", 54, 156 - k * 6, Math.min(1, k * 2)); label("GORZKO!", 196, 146 - k * 4, Math.min(1, k * 2 - .4)); });
      if (ph === "p") put(999, () => { for (let i = 0; i < 5; i++) heart(96 + i * 12, 130 - k * 18 - (i % 2) * 8, 1.1, 1); });
    } else if (!coupleAway) put(196, () => { groom(132, 196); bride(108, 196); });
    put(201, headTableFront);
    // świadkowie przy stole
    put(195, () => { funko(48, 196, 1, look(14)); funko(78, 196, 1, look(9)); funko(162, 196, 1, look(22)); funko(192, 196, 1, look(5)); });
  }
  // Denis: jedno wejście, potem zostaje
  if (now >= DENIS_AT) put(222, () => {
    const e = ev.denis, [ph, k] = P(e);
    const glow = e ? (ph === "b" ? k : ph === "p" ? 1 : 1 - k * .6) : .4;
    ctx.fillStyle = `rgba(255,230,160,${.2 * glow})`; ctx.beginPath(); ctx.moveTo(282, 128); ctx.lineTo(256, 222); ctx.lineTo(328, 222); ctx.lineTo(302, 128); ctx.fill();
    const x = e && ph === "b" ? 362 - 70 * ease(k) : 292;
    drawDenis(x, 222, e && ph === "p");
    if (e && ph === "p") for (const fx of [236, 348]) for (let i = 0; i < 14; i++) { const hh = (k * 70 + i * 9) % 70; ctx.fillStyle = `rgba(255,${190 + i * 4},120,${1 - hh / 70})`; ctx.beginPath(); ctx.arc(fx + Math.sin(i * 3 + now * 9) * 6, 200 - hh, 2.3, 0, 7); ctx.fill(); }
  });
  // stół z tortem
  put(360, () => {
    { const tg = ctx.createLinearGradient(0, 324, 0, 364); tg.addColorStop(0, "#fffaf6"); tg.addColorStop(1, "#d8cbc1"); ctx.fillStyle = tg; rr(20, 324, 88, 40, 4); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillRect(20, 324, 88, 4);
      for (let i = 0; i < 3; i++) { const x = 20 + i * 29.3; ctx.fillStyle = "rgba(240,138,176,.85)"; ctx.beginPath(); ctx.moveTo(x, 328); ctx.quadraticCurveTo(x + 14.6, 348, x + 29.3, 328); ctx.quadraticCurveTo(x + 14.6, 339, x, 328); ctx.fill(); }
      for (let i = 0; i <= 3; i++) rose(20 + i * 29.3, 329, 3.2, i % 2 ? "#ffffff" : "#ff8ab0"); }
    const e = ev.cake, [ph, k] = P(e);
    if (!e && !done.has("cake")) cakeShape(64, 326, 0);
    else if (e && ph === "b") cakeShape(64, 326, Math.sin(now * 22) * (.03 + k * .14));
    else if (e && ph === "p") { cakeShape(84 + k * 18, 302 - Math.sin(k * Math.PI) * 26, .7 + k * .6); sparks(96, 282, 6, 30, .6, "255,255,255"); }
    else { ctx.fillStyle = "#fff4f7"; ctx.beginPath(); ctx.ellipse(110, 372, 24, 7, 0, 0, 7); ctx.fill(); ctx.fillStyle = "#ff9cc0"; ctx.beginPath(); ctx.ellipse(106, 370, 8, 3, 0, 0, 7); ctx.fill(); }
  });
  // bar, barman, szampan
  put(366, () => {
    barBack();
    funko(326, 326, .95, { ...WAITER, mustache: "#1b1410", arm: .5 });
    barFront();
    for (let i = 0; i < 3; i++) glass(270 + i * 11, 321);
    const e = ev.cork, [ph, k] = P(e);
    const bx = 304, by = 321, shake = e && ph === "b" ? Math.sin(now * 40) * k * 3 : 0;
    ctx.save(); ctx.translate(bx + shake, by); ctx.rotate(-.35);
    ctx.fillStyle = "#1f4a2a"; rr(-6, -26, 12, 26, 4); ctx.fill(); ctx.fillRect(-2.5, -37, 5, 12);
    ctx.fillStyle = "#e8c65a"; ctx.fillRect(-3.5, -40, 7, 6);
    if (!done.has("cork") && !(e && ph !== "b")) { ctx.fillStyle = "#d9b27a"; ctx.fillRect(-2.5, -44, 5, 5); }
    ctx.restore();
    if (e && (ph === "p" || ph === "a")) {
      const f = ph === "p" ? k : 1;
      for (let i = 0; i < 14; i++) { const sp = f * (20 + i * 4); ctx.fillStyle = `rgba(255,248,215,${ph === "p" ? .9 : .5 * (1 - k)})`; ctx.beginPath(); ctx.arc(bx - 12 - sp * .5 + Math.sin(i) * 6, by - 36 - sp * .8 + Math.cos(i * 2) * 6, 3 - i * .12, 0, 7); ctx.fill(); }
      if (ph === "p") { const cx = bx - 26 - k * 30, cy = by - 62 - k * 36; ctx.fillStyle = "#d9b27a"; ctx.save(); ctx.translate(cx, cy); ctx.rotate(now * 12); ctx.fillRect(-4, -3, 8, 6); ctx.restore(); sparks(cx, cy, 6, 12, .9); }
    }
  });
  // kelner z tacą krąży po sali
  {
    const e = ev.waiter, [ph, k] = P(e);
    let x = e ? e.fx : waiterX();
    if (e && e.fx == null) e.fx = x = waiterX();
    const fallen = done.has("waiter") && !e;
    if (!fallen) put(372, () => {
      let rot = 0, trayY = -34, trayX = 12, flying = false;
      if (e && ph === "b") rot = Math.sin(now * 18) * k * .25;
      if (e && ph === "p") { rot = -.5 - k * .3; flying = true; }
      if (e && ph === "a") rot = -.9;
      funko(x, 372, 1, { ...WAITER, arm: .75 }, rot);
      if (!flying && !(e && ph === "a")) { ctx.fillStyle = "#c9c9d2"; ctx.beginPath(); ctx.ellipse(x + trayX, 372 + trayY, 11, 3, 0, 0, 7); ctx.fill(); for (let i = -1; i <= 1; i++) glass(x + trayX + i * 6, 372 + trayY - 1); }
      if (flying) { const up = Math.sin(k * Math.PI) * 30; ctx.save(); ctx.translate(x + 14, 330 - up); ctx.rotate(k * 3); ctx.fillStyle = "#c9c9d2"; ctx.beginPath(); ctx.ellipse(0, 0, 11, 3, 0, 0, 7); ctx.fill(); ctx.restore(); for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(x + 2 + i * 9, 318 - up - i * 4); ctx.rotate(now * 8 + i); glass(0, 0); ctx.restore(); } sparks(x + 14, 318 - up, 7, 18, .8, "220,240,255"); }
      if (e && ph === "a") { ctx.fillStyle = "rgba(215,240,255,.7)"; for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.arc(x + 4 + i * 4, 378 + (i % 3), 1.5, 0, 7); ctx.fill(); } }
    });
    else put(372, () => { funko(e ? x : SPOTS.waiter.pos({ fx: lastWaiterX })[0], 372, 1, { ...WAITER, arm: .2, mouth: .6 }); });
    if (e) lastWaiterX = x;
  }
  // babcia
  {
    const e = ev.grandma, [ph, k] = P(e);
    put(470, () => {
      if (e && ph === "p") { funko(72, 452, 1, { ...GRANDMA, arm: 1, arm2: 1, noShadow: true }, Math.PI + now * 14); ctx.strokeStyle = "rgba(255,236,190,.7)"; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(72, 446, 18 + i * 6, now * 8 + i, now * 8 + i + 1.4); ctx.stroke(); } }
      else if (e && ph === "b") funko(72, 470 - k * 4, 1, { ...GRANDMA, arm: .2 + k * .8, arm2: .2 + k * .8 }, Math.sin(now * 10) * .15 * k);
      else funko(72, 470 + (Math.abs(Math.sin(now * 5)) * -3), 1, { ...GRANDMA, arm: .4 + Math.abs(Math.sin(now * 5)) * .4, arm2: .3, mouth: e ? 1.2 : 0 });
    });
  }
  // dzieciak
  {
    const e = ev.kid, [ph, k] = P(e);
    const x = kidX(done.has("kid") && !e ? { t: -99, b: 1, p: 1, a: 1 } : e);
    put(512, () => {
      if (e && ph === "p") { funko(x, 512, .72, { ...KID, arm: 1, arm2: 1, mouth: 1.3 }, -.35); ctx.strokeStyle = "rgba(255,236,190,.75)"; ctx.lineWidth = 2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 18 + i * 4, 496 + i * 5); ctx.lineTo(x + 40 + i * 6, 496 + i * 5); ctx.stroke(); } }
      else funko(x, 512, .72, { ...KID, arm: e && ph === "b" ? .8 : .3, arm2: e && ph === "b" ? .8 : .3 });
    });
  }
  // pociąg weselny
  {
    const e = ev.conga;
    if (e) { const [ph, k] = P(e); const lx = congaX(e);
      for (let i = 0; i < 7; i++) { const x = lx - i * 24, y = 360 + Math.sin(now * 8 + i) * 2; const kick = ph === "p" && i % 2 === (Math.floor(now * 6) % 2);
        put(y, () => funko(x, y - (kick ? 4 : 0), .95, { ...look(30 + i * 5), arm: ph === "p" ? 1 : .6, arm2: ph === "p" ? 1 : .6, headband: i === 0 ? "#c2183c" : null, mouth: i === 0 ? 1.2 : 0 })); }
      if (ph === "p") put(999, () => label("CIUCH CIUCH!", lx, 290, 1 - k * .5));
    }
  }
  // pierwszy taniec i bukiet (para na parkiecie)
  {
    const e = ev.dance;
    if (e) { const [ph, k] = P(e), x = 184, y = 404;
      put(y, () => {
        if (ph === "b") { const a = now * 6; groom(x + Math.cos(a) * 10, y + Math.sin(a) * 3); bride(x - Math.cos(a) * 10, y - Math.sin(a) * 3); }
        else if (ph === "p") { groom(x + 10, y, -.12, { arm: .6 }); bride(x - 8, y + 4, -.9); for (let i = 0; i < 4; i++) heart(x - 20 + i * 14, y - 64 - k * 22 - (i % 2) * 8, 1.2, 1 - k * .3); }
        else { groom(x + 10, y); bride(x - 10, y); }
      });
    }
  }
  {
    const e = ev.bouquet;
    if (e) { const [ph, k] = P(e), x = 176, y = 470;
      put(y, () => {
        const arm = ph === "b" ? k : ph === "p" ? 1 : 1 - k;
        bride(x, y, 0, { arm });
        let bx = x + (6 + Math.sin(arm * 2.4) * 12) * 1.12, by = y + (-18 + Math.cos(arm * 2.4) * 12) * 1.12;
        if (ph === "p") { bx = x + 4; by = y - 76 - Math.sin(k * Math.PI) * 30; sparks(bx, by, 8, 16, .9); }
        else if (ph === "a") { bx = x + 30 * k; by = y - 76 + k * 50; }
        ctx.fillStyle = "#3f8a4a"; ctx.beginPath(); ctx.arc(bx, by + 2, 5, 0, 7); ctx.fill();
        for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? "#ff6f9c" : "#fff"; ctx.beginPath(); ctx.arc(bx + Math.cos(i * 1.26) * 5, by - 3 + Math.sin(i * 1.26) * 3, 3.5, 0, 7); ctx.fill(); }
      });
    }
  }
  // tłum na parkiecie: tańczy, a przy trwającej chwili robi trochę miejsca
  const centers = events.filter(e => phaseOf(e)[0] !== "w").map(e => SPOTS[e.k].pos(e));
  for (const c of crowd) {
    let x = c.x, y = c.y;
    for (const [cx, cy] of centers) { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy * 1.4) || 1; if (d < 40) { x += dx / d * (40 - d) * .8; y += dy / d * (40 - d) * .5; } }
    const b = Math.abs(Math.sin(now * 5 + c.ph));
    put(y, () => funko(x + Math.sin(now * 2.5 + c.ph) * 2, y - b * 3, .82, { ...c, arm: .2 + b * .6, arm2: .3 + (1 - b) * .4 }));
  }
  // stoliki z gośćmi
  TABLES.forEach(([tx, ty]) => put(ty, () => roundTable(tx, ty)));
  const toast = ev.toast, [tph, tk] = P(toast);
  for (const g of seated) put(g.y, () => {
    let o = look(g.s), yy = g.y;
    if (g.ti === 2 && toast) { const up = tph === "b" ? tk : tph === "p" ? 1 : 1 - tk; yy -= up * 8; o = { ...o, arm: .3 + up * .7, mouth: tph === "p" ? 1.2 : 0, hold: () => glass(0, 12) }; }
    chair(g.x, g.y);
    funko(g.x, yy, .82, o);
  });
  if (toast) {
    if (tph === "b") put(999, () => label("STO LAT!", 300, 528 - tk * 6, Math.min(1, tk * 2)));
    if (tph === "p") put(999, () => { sparks(300, 552, 10, 10 + tk * 14, 1); label("STO LAT!", 300, 524, 1); });
  }
  // wujek
  {
    const e = ev.uncle, [ph, k] = P(e);
    put(e ? 620 : 600, () => {
      if (!e) { funko(60, 598, .95, { ...UNCLE, arm: done.has("uncle") ? .3 : .15, headband: done.has("uncle") ? "#c2183c" : null }); return; }
      let uy = 598 - (ph === "b" ? ease(k) * 14 : 14), rot = 0;
      if (ph === "p") { uy -= Math.sin(k * Math.PI) * 30; rot = Math.sin(k * 12) * .15; }
      const up = ph === "p" ? 1 : ph === "b" ? k : .4;
      funko(60, uy, 1.05, { ...UNCLE, headband: ph !== "b" ? "#c2183c" : null, tie: ph !== "b" ? null : UNCLE.tie, arm: .3 + up * .7, arm2: .3 + up * .7, mouth: ph === "p" ? 1.4 : 0 }, rot);
      if (ph === "p") { ctx.strokeStyle = "rgba(255,236,190,.7)"; ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(60 + i * 14, uy + 6); ctx.lineTo(60 + i * 16, uy + 20); ctx.stroke(); } }
    });
  }
  // teściowa
  {
    const e = ev.mother, [ph, k] = P(e);
    put(598, () => {
      const tears = e && ph === "p";
      funko(180, 598, .95, { ...MOTHER, arm: e && ph !== "p" ? .9 : .2, mouth: tears ? 1.5 : e ? .8 : 0, hold: e && ph !== "p" ? () => { ctx.fillStyle = "#fff"; ctx.fillRect(-3, 9, 7, 6); } : null,
        after: tears ? hy => { for (const sd of [-1, 1]) for (let i = 0; i < 8; i++) { const t = (k * 3 + i / 8) % 1; ctx.fillStyle = `rgba(120,200,255,${1 - t})`; ctx.beginPath(); ctx.arc(sd * (6 + t * 26), hy + 3 - Math.sin(t * Math.PI) * 16 + t * 14, 2, 0, 7); ctx.fill(); } } : null });
    });
  }
}
let lastWaiterX = 225;

// ---------- HUD ----------
function hud() {
  ctx.fillStyle = "rgba(10,4,9,.6)"; ctx.fillRect(0, 0, W, 34);
  ctx.textAlign = "left"; ctx.font = "900 20px 'Big Shoulders Display', Impact, sans-serif"; ctx.fillStyle = "#f2c45a";
  ctx.fillText(String(score).padStart(5, "0"), 12, 24);
  ctx.textAlign = "center"; ctx.font = "800 11px Manrope, sans-serif"; ctx.fillStyle = combo > 1 ? "#ff7aa8" : "rgba(255,255,255,.6)";
  const caught = new Set(photos.filter(p => p.grade === "Perfekcyjne" || p.grade === "Kadr idealny").map(p => p.k)).size;
  ctx.fillText(combo > 1 ? `COMBO ×${combo}` : `chwile ${caught}/13`, 180, 22);
  ctx.textAlign = "right"; ctx.fillStyle = film <= 4 ? "#ff7a7a" : "#fff"; ctx.font = "800 12px Manrope, sans-serif";
  ctx.fillText(`${film}/${FILM}`, W - 12, 22);
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5; rr(W - 72, 11, 22, 15, 3); ctx.stroke(); ctx.beginPath(); ctx.arc(W - 61, 18.5, 4.2, 0, 7); ctx.stroke(); ctx.fillRect(W - 68, 8, 6, 3);
  const left = clamp(1 - now / roundEnd, 0, 1);
  ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(0, 34, W, 3);
  ctx.fillStyle = left < .2 ? "#ff7a7a" : "#f2c45a"; ctx.fillRect(0, 34, W * left, 3);
}

// ---------- strzał ----------
// Punkty, w które można celować: postać ORAZ to, co akurat leci (korek, bukiet, tort, taca).
// Wcześniej liczył się tylko środek postaci, a latający przedmiot bywał 60-80 px dalej.
function hitPoints(e) {
  const [ph, k] = phaseOf(e), p = ph === "p", s = Math.sin(k * Math.PI);
  const [x, y] = SPOTS[e.k].pos(e), pts = [[x, y]];
  switch (e.k) {
    case "cake": pts.push([64, 326 - 24]); if (p) pts.push([84 + k * 18, 302 - s * 26 - 22]); if (ph === "a") pts.push([110, 370]); break;
    case "cork": pts.push([310, 312], [330, 300]); if (p) pts.push([284 - k * 30, 264 - k * 36], [276 - k * 15, 270 - k * 20]); break;
    case "bouquet": pts.push([176, 450]); if (p) pts.push([180, 394 - s * 30]); if (ph === "a") pts.push([176 + 30 * k, 394 + k * 50]); break;
    case "waiter": if (p) pts.push([x + 14, 330 - s * 30]); break;
    case "dance": pts.push([184, 384]); break;
    case "conga": for (let i = 1; i < 7; i++) pts.push([x - i * 24, 340]); break;
    case "toast": pts.push([270, 584], [330, 584]); break;
    case "uncle": if (ph !== "b") pts.push([60, 584 - (p ? s * 30 : 0) - 34]); break;
    case "denis": pts.push([292, 200], [270, 160]); break;
  }
  return pts;
}
function shoot(px, py) {
  if (state !== "play" || film <= 0) return;
  film--; flash = 1; finder = { x: px, y: py, t: now };
  shutter();
  let best = null, bd = 1e9;
  for (const e of events) {
    const ph = phaseOf(e)[0]; if (ph === "w" || ph === "x" || e.best >= 100) continue;
    for (const [sx, sy] of hitPoints(e)) { const d = Math.hypot(px - sx, py - sy); if (d < RADIUS && d < bd) { bd = d; best = e; } }
  }
  let text, pts = 0, grade;
  if (!best) { text = "Pusta klatka"; streak = 0; combo = 1; grade = "pusta"; }
  else {
    const [ph, k] = phaseOf(best);
    // szczyt z małym zapasem po obu stronach (palec jest wolniejszy niż oko)
    const early = ph === "b" && k > 1 - .15 / best.b, late = ph === "a" && k < .15 / best.a;
    if (ph === "p" || early || late) {
      streak++; combo = Math.min(4, 1 + Math.floor(streak / 3));
      pts = 100 * combo; grade = "Perfekcyjne"; text = "PERFEKCYJNE!";
      if (bd < 22) { pts += 25; grade = "Kadr idealny"; text = "KADR IDEALNY!"; }
    } else { pts = 20; grade = ph === "b" ? "Za wcześnie" : "Spóźnione"; text = grade + (ph === "b" ? ", czekaj!" : ""); }
    // zdjęcie za wcześnie nie zamyka chwili: można strzelić jeszcze raz w szczycie, liczy się najlepsze
    const prev = best.best || 0;
    best.shot = true; best.best = Math.max(prev, pts);
    pts = Math.max(0, pts - prev);
  }
  score += pts;
  popups.push({ x: clamp(px, 60, W - 60), y: py - 30, t: now, text, pts, good: grade === "Perfekcyjne" || grade === "Kadr idealny" });
  pendingShot = { x: px, y: py, k: best ? best.k : null, caption: best ? SPOTS[best.k].name : "Pusta sala", grade, pts: best ? best.best : 0 };
  if (film === 0) setTimeout(() => state === "play" && end(), 700);
}
let ac;
function shutter() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const n = ac.createBuffer(1, ac.sampleRate * .08, ac.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) * (i < d.length * .25 || i > d.length * .55 ? 1 : .2);
    const src = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = 1800; g.gain.value = .35;
    src.buffer = n; src.connect(f).connect(g).connect(ac.destination); src.start();
  } catch (_) {}
}
function capture(s) {
  const size = 132, c = document.createElement("canvas");
  c.width = c.height = 220;
  const sx = clamp(s.x - size / 2, 0, W - size), sy = clamp(s.y - size / 2 - 10, 38, H - size);
  c.getContext("2d").drawImage(cv, sx * dpr, sy * dpr, size * dpr, size * dpr, 0, 0, 220, 220);
  photos.push({ src: c.toDataURL("image/jpeg", .82), k: s.k, caption: s.caption, grade: s.grade, pts: s.pts });
}

// ---------- pętla ----------
let last = performance.now();
function frame(ts) {
  const dt = Math.min(.05, (ts - last) / 1000); last = ts;
  if (state === "play") {
    now = (ts - t0) / 1000;
    while (schedule.length && schedule[0].t <= now) events.push(schedule.shift());
    for (const e of events) if (phaseOf(e)[0] === "x") {
      done.add(e.k);
      if (!e.shot) { streak = 0; combo = 1; const [x, y] = SPOTS[e.k].pos(e); popups.push({ x: clamp(x, 60, W - 60), y: y - 40, t: now, text: "Przegapione", pts: 0, good: false, dim: true }); }
    }
    events = events.filter(e => phaseOf(e)[0] !== "x");
    if (now >= roundEnd) end();
  } else if (state === "intro") now = ui.preview ? 30 : ts / 1000;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hall();
  layer = []; sceneObjects();
  layer.sort((a, b) => a.y - b.y).forEach(l => l.f());
  if (opts.hint) for (const e of events) { const [ph, k] = phaseOf(e); if (ph === "b" && k < .3) { const [x, y] = SPOTS[e.k].pos(e); ctx.strokeStyle = `rgba(255,255,255,${.5 * (1 - k / .3)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 16 + k * 120, 0, 7); ctx.stroke(); } }
  if (pendingShot) { capture(pendingShot); pendingShot = null; }
  if (state !== "intro") hud();
  if (finder && now - finder.t < .45) {
    const a = 1 - (now - finder.t) / .45, f = finder, r = 30;
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 2.5;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.beginPath(); ctx.moveTo(f.x + sx * r, f.y + sy * (r - 10)); ctx.lineTo(f.x + sx * r, f.y + sy * r); ctx.lineTo(f.x + sx * (r - 10), f.y + sy * r); ctx.stroke(); }
  }
  for (const p of popups) {
    const a = 1 - (now - p.t) / .9; if (a <= 0) continue;
    ctx.globalAlpha = a; ctx.textAlign = "center";
    ctx.font = `900 ${p.good ? 22 : 16}px 'Big Shoulders Display', Impact, sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(20,8,16,.7)"; ctx.strokeText(p.text, p.x, p.y - (1 - a) * 20);
    ctx.fillStyle = p.good ? "#f2c45a" : p.dim ? "rgba(255,255,255,.75)" : "#ffb3c8";
    ctx.fillText(p.text, p.x, p.y - (1 - a) * 20);
    if (p.pts) { ctx.font = "800 12px Manrope, sans-serif"; ctx.fillText(`+${p.pts}`, p.x, p.y + 14 - (1 - a) * 20); }
    ctx.globalAlpha = 1;
  }
  popups = popups.filter(p => now - p.t < .9);
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * .75})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 6); }
  if (alive && !ui.preview) requestAnimationFrame(frame);
}
if (ui.preview) {
  // stopklatka na kartę slidera: sala w środku wesela, Denis już na scenie
  state = "intro"; frame(30000);
  return { destroy() {} };
}
requestAnimationFrame(frame);
if (document.fonts) document.fonts.ready.then(() => { bgCanvas = null; headCache.clear(); }); // neon z imionami w docelowym kroju

cv.addEventListener("pointerdown", ev => {
  const r = cv.getBoundingClientRect();
  shoot((ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * H);
});

const $ = id => ui.root.querySelector("#" + id);
const intro = $("fg-intro"), album = $("fg-album");
function start() {
  intro.hidden = true; album.hidden = true;
  state = "play"; t0 = performance.now(); now = 0; events = []; done = new Set(); schedule = buildSchedule();
  score = 0; film = FILM; streak = 0; combo = 1; photos = []; popups = []; lastWaiterX = 225;
  shutter();
}
function end() {
  state = "end"; events = []; schedule = [];
  const good = photos.filter(p => p.grade === "Perfekcyjne" || p.grade === "Kadr idealny").length;
  const stars = score >= 2500 ? 3 : score >= 1400 ? 2 : score >= 600 ? 1 : 0;
  // album: najlepsze zdjęcie każdej chwili, przegapione zostają pustym miejscem
  const all = Object.keys(SPOTS).map(k => { const ps = photos.filter(p => p.k === k).sort((a, b) => b.pts - a.pts); return ps[0] || { k, miss: true, caption: SPOTS[k].name }; });
  all.sort((a, b) => (a.miss ? 1 : 0) - (b.miss ? 1 : 0) || b.pts - a.pts);
  album.innerHTML = `<header><h3>Album Ani i Marka</h3><div class="stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>
    <div class="sum">${score} pkt · ${good}/13 chwil uchwyconych perfekcyjnie · ${photos.filter(p => p.grade === "pusta").length} pustych klatek</div></header>
    <div class="grid">${all.map((p, i) => p.miss
      ? `<figure class="pol miss" style="--r:${((i * 37) % 7 - 3) * .8}deg"><b>${p.caption}</b><i>przegapione</i></figure>`
      : `<figure class="pol ${p.grade === "Perfekcyjne" || p.grade === "Kadr idealny" ? "" : "blur"}" style="--r:${((i * 37) % 7 - 3) * .8}deg"><img src="${p.src}" alt="${p.caption}"><b>${p.caption}</b><i>${p.grade} · +${p.pts}</i></figure>`).join("")}</div>
    <div class="fg-row"><button class="btn" id="fg-again">Jeszcze raz</button><button class="btn dark" id="fg-back2">Wróć</button></div>`;
  album.hidden = false;
  $("fg-again").onclick = start;
  $("fg-back2").onclick = ui.onClose;
  ui.onFinish(score, stars);
}
$("fg-start").onclick = start;
$("fg-back").onclick = ui.onClose;

return { destroy() { alive = false; if (ro) ro.disconnect(); } };
}
