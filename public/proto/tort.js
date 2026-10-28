
(() => {
const W = 720, H = 1280, TH = 74, BASE_Y = 1000, MIN_W = 130;
const cv = document.getElementById("tc"), x = cv.getContext("2d");
const COLORS = [["#fff8ee", "#f1e2c8"], ["#fbd3df", "#eeb3c6"], ["#fff1d6", "#ecd6a8"], ["#e9f3ff", "#c9dcf0"]];
let conf = [];
const CONF_COLORS = ["#ffd24c", "#ff8fb3", "#ffffff", "#f3c6d6", "#bfe6ff", "#e6a92e"];
function confetti(cx, cy, w) {
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 260 + Math.random() * 260;
    conf.push({ x: cx + (Math.random() - 0.5) * w * 0.6, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: CONF_COLORS[i % CONF_COLORS.length], t: 0 });
  }
}
const bokeh = Array.from({ length: 26 }, (_, i) => ({ x: Math.random() * 720, y: Math.random() * 1280, r: 6 + Math.random() * 22, sp: 6 + Math.random() * 14, ph: Math.random() * 7, c: ["255,214,120", "255,170,200", "255,255,255", "190,220,255"][i % 4] }));
const hearts = [];
function backdrop(now, dt, cam) {
  const p = cam * 0.25;
  const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#241318"); bg.addColorStop(0.55, "#2e1a14"); bg.addColorStop(1, "#3a2416");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  for (const side of [0, 1]) {
    x.save(); if (side) { x.translate(W, 0); x.scale(-1, 1); }
    for (let i = 0; i < 4; i++) {
      const g = x.createLinearGradient(i * 26, 0, i * 26 + 30, 0); g.addColorStop(0, "rgba(120,28,48,0.9)"); g.addColorStop(0.5, "rgba(170,52,74,0.9)"); g.addColorStop(1, "rgba(110,24,42,0.9)");
      x.fillStyle = g; x.beginPath(); x.moveTo(i * 26, 0); x.quadraticCurveTo(i * 26 + 18 + Math.sin(now * 0.0008 + i) * 3, 640, i * 22 + 8, 1280); x.lineTo(i * 22 + 38, 1280); x.quadraticCurveTo(i * 26 + 46, 640, i * 26 + 32, 0); x.fill();
    }
    x.restore();
  }
  for (let row = 0; row < 2; row++) {
    const y0 = 290 + row * 110 + p;
    x.strokeStyle = "rgba(60,40,30,0.8)"; x.lineWidth = 2; x.beginPath();
    for (let xx = 0; xx <= W; xx += 12) { const yy = y0 + Math.sin((xx / W) * Math.PI * 3 + row) * 30; if (xx) x.lineTo(xx, yy); else x.moveTo(xx, yy); }
    x.stroke();
    for (let k = 0; k < 14; k++) {
      const xx = 20 + k * 52 + row * 26, yy = y0 + Math.sin((xx / W) * Math.PI * 3 + row) * 30 + 8;
      const tw = 0.55 + 0.45 * Math.sin(now * 0.004 + k * 1.7 + row * 2);
      const g = x.createRadialGradient(xx, yy, 0, xx, yy, 22); g.addColorStop(0, "rgba(255,214,120," + (0.55 * tw).toFixed(3) + ")"); g.addColorStop(1, "rgba(255,214,120,0)");
      x.fillStyle = g; x.fillRect(xx - 22, yy - 22, 44, 44);
      x.fillStyle = "rgba(255,236,170," + (0.6 + 0.4 * tw).toFixed(3) + ")"; x.beginPath(); x.ellipse(xx, yy, 4, 5.5, 0, 0, 7); x.fill();
    }
  }
  x.save(); x.translate(W / 2, 150 + p); x.rotate(Math.sin(now * 0.0009) * 0.03);
  x.strokeStyle = "rgba(230,190,110,0.7)"; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -40); x.lineTo(0, 30); x.stroke();
  x.fillStyle = "rgba(230,180,90,0.9)"; x.beginPath(); x.ellipse(0, 40, 70, 14, 0, 0, 7); x.fill();
  for (let k = -3; k <= 3; k++) {
    const sx = k * 20, len = 34 + (3 - Math.abs(k)) * 10, sp = 0.5 + 0.5 * Math.sin(now * 0.006 + k);
    x.strokeStyle = "rgba(255,240,210,0.55)"; x.beginPath(); x.moveTo(sx, 44); x.lineTo(sx, 44 + len); x.stroke();
    x.fillStyle = "rgba(255,250,235," + (0.6 + 0.4 * sp).toFixed(3) + ")"; x.beginPath(); x.moveTo(sx, 44 + len + 10); x.lineTo(sx - 4, 44 + len); x.lineTo(sx + 4, 44 + len); x.fill();
  }
  const cg = x.createRadialGradient(0, 60, 0, 0, 60, 200); cg.addColorStop(0, "rgba(255,220,150,0.22)"); cg.addColorStop(1, "rgba(255,220,150,0)"); x.fillStyle = cg; x.fillRect(-200, -140, 400, 400);
  x.restore();
  for (const b of bokeh) {
    b.y -= b.sp * dt; if (b.y < -40) { b.y = H + 40; b.x = Math.random() * W; }
    const a = 0.08 + 0.07 * Math.sin(now * 0.002 + b.ph);
    const g = x.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r); g.addColorStop(0, "rgba(" + b.c + "," + a.toFixed(3) + ")"); g.addColorStop(1, "rgba(" + b.c + ",0)");
    x.fillStyle = g; x.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  }
  if (Math.random() < dt * 0.6) hearts.push({ x: 80 + Math.random() * (W - 160), y: H + 20, s: 14 + Math.random() * 14, t: 0, ph: Math.random() * 7 });
  for (let i = hearts.length - 1; i >= 0; i--) {
    const h = hearts[i]; h.t += dt; h.y -= 40 * dt; const xx = h.x + Math.sin(h.t * 2 + h.ph) * 16;
    if (h.y < 300) { hearts.splice(i, 1); continue; }
    x.globalAlpha = Math.min(0.35, (H - h.y) / 600) * Math.min(1, (h.y - 300) / 200);
    x.fillStyle = "#ff8fb3"; x.font = "900 " + h.s + "px sans-serif"; x.textAlign = "center"; x.fillText("♥", xx, h.y); x.globalAlpha = 1;
  }
}
let tiers = [{ x: 150, w: 420, c: 0 }], cur, state = "ready", cam = 0, camT = 0, falling = [], perfects = 0, fx = [], overAt = 0, speed;
function reset() { conf = [];
  tiers = [{ x: 150, w: 420, c: 0 }];
  speed = 260; perfects = 0; falling = []; fx = []; cam = camT = 0;
  spawn(); state = "play";
}
function spawn() {
  const top = tiers[tiers.length - 1];
  const fromLeft = tiers.length % 2 === 1;
  cur = { x: fromLeft ? -top.w : W, w: top.w, c: tiers.length % COLORS.length, dir: fromLeft ? 1 : -1 };
}
function drop() {
  const top = tiers[tiers.length - 1];
  const a = Math.max(cur.x, top.x), b = Math.min(cur.x + cur.w, top.x + top.w);
  const ov = b - a;
  const ty = BASE_Y - tiers.length * TH;
  if (ov < MIN_W) { falling.push({ x: cur.x, y: ty, w: cur.w, c: cur.c, vy: 0, vx: cur.dir * 120, r: 0 }); state = "over"; overAt = performance.now(); return; }
  if (Math.abs(cur.x - top.x) < 9) {
    perfects++;
    let w = top.w; if (perfects >= 3) { w = Math.min(420, w + 20); }
    tiers.push({ x: top.x - (w - top.w) / 2, w, c: cur.c });
    fx.push({ t: performance.now(), y: ty, txt: perfects >= 3 ? "IDEALNIE! +" : "IDEALNIE!" });
    confetti(top.x + top.w / 2, ty + 6, top.w);
  } else {
    perfects = 0;
    tiers.push({ x: a, w: ov, c: cur.c });
    const left = cur.x < top.x;
    falling.push({ x: left ? cur.x : b, y: ty, w: cur.w - ov, c: cur.c, vy: 0, vx: (left ? -1 : 1) * 80, r: 0 });
  }
  speed = Math.min(620, speed + 14);
  camT = Math.max(0, (tiers.length - 7) * TH);
  spawn();
}
function rr(a, b, w, h, r) { x.beginPath(); x.roundRect(a, b, w, h, r); }
function tier(t, y, alpha = 1) {
  const [c1, c2] = COLORS[t.c];
  x.save(); x.globalAlpha = alpha;
  x.fillStyle = "rgba(0,0,0,0.18)"; rr(t.x + 4, y + 6, t.w, TH, 10); x.fill();
  const g = x.createLinearGradient(t.x, 0, t.x + t.w, 0); g.addColorStop(0, c2); g.addColorStop(0.3, c1); g.addColorStop(1, c2);
  x.fillStyle = g; rr(t.x, y, t.w, TH, 10); x.fill();
  x.fillStyle = "#ffffff"; x.beginPath(); x.moveTo(t.x, y + 4);
  for (let px = 0; px <= t.w; px += 18) { const d = 8 + ((px * 7 + t.c * 13) % 11); x.quadraticCurveTo(t.x + px + 9, y + d + 6, t.x + Math.min(t.w, px + 18), y + 6); }
  x.lineTo(t.x + t.w, y); x.lineTo(t.x, y); x.closePath(); x.fill();
  x.fillStyle = "#f6e7c4"; for (let px = 14; px < t.w - 8; px += 22) { x.beginPath(); x.arc(t.x + px, y + TH - 10, 4.5, 0, 7); x.fill(); }
  if (t.w >= 46) { x.fillStyle = "#e85d8a"; x.beginPath(); x.arc(t.x + t.w / 2, y + TH / 2 + 4, 8, 0, 7); x.fill(); x.fillStyle = "#6fae52"; x.beginPath(); x.ellipse(t.x + t.w / 2 - 12, y + TH / 2 + 6, 7, 3, -0.4, 0, 7); x.ellipse(t.x + t.w / 2 + 12, y + TH / 2 + 6, 7, 3, 0.4, 0, 7); x.fill(); }
  x.restore();
}
const DENIS_HEAD = new Image(); DENIS_HEAD.src = "data:image/webp;base64,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";
function rr2(a, b, w, h, r) { x.beginPath(); x.roundRect(a, b, w, h, r); }
function body(cx, y, s, dress) {
  x.fillStyle = "rgba(0,0,0,0.3)"; x.beginPath(); x.ellipse(cx, y + 2, 26 * s, 8 * s, 0, 0, 7); x.fill();
  if (dress) {
    const g = x.createLinearGradient(cx - 30 * s, 0, cx + 30 * s, 0); g.addColorStop(0, "#e9e2d6"); g.addColorStop(0.4, "#ffffff"); g.addColorStop(1, "#ddd4c4");
    x.fillStyle = g; x.beginPath(); x.moveTo(cx - 30 * s, y); x.quadraticCurveTo(cx - 20 * s, y - 40 * s, cx - 12 * s, y - 58 * s); x.lineTo(cx + 12 * s, y - 58 * s); x.quadraticCurveTo(cx + 20 * s, y - 40 * s, cx + 30 * s, y); x.quadraticCurveTo(cx, y + 6 * s, cx - 30 * s, y); x.fill();
    x.fillStyle = "rgba(240,200,215,0.9)"; for (let i = -2; i <= 2; i++) { x.beginPath(); x.arc(cx + i * 9 * s, y - 6 * s, 3 * s, 0, 7); x.fill(); }
    x.fillStyle = "#f6dcc4"; x.beginPath(); x.arc(cx - 15 * s, y - 40 * s, 5 * s, 0, 7); x.arc(cx + 15 * s, y - 40 * s, 5 * s, 0, 7); x.fill();
    x.fillStyle = "#f3a6c0"; x.beginPath(); x.arc(cx, y - 38 * s, 7 * s, 0, 7); x.fill(); x.fillStyle = "#7bbf5a"; x.beginPath(); x.ellipse(cx - 8 * s, y - 36 * s, 5 * s, 2.5 * s, -0.5, 0, 7); x.fill();
  } else {
    x.fillStyle = "#0b0a0c"; rr2(cx - 15 * s, y - 22 * s, 13 * s, 22 * s, 4 * s); x.fill(); rr2(cx + 2 * s, y - 22 * s, 13 * s, 22 * s, 4 * s); x.fill();
    const g = x.createLinearGradient(cx - 22 * s, 0, cx + 22 * s, 0); g.addColorStop(0, "#26232a"); g.addColorStop(0.5, "#17151a"); g.addColorStop(1, "#0d0c0f");
    x.fillStyle = g; rr2(cx - 22 * s, y - 60 * s, 44 * s, 42 * s, 12 * s); x.fill();
    x.fillStyle = "#f7f4ef"; x.beginPath(); x.moveTo(cx - 8 * s, y - 60 * s); x.lineTo(cx + 8 * s, y - 60 * s); x.lineTo(cx, y - 40 * s); x.fill();
    x.fillStyle = "#0b0a0c"; x.beginPath(); x.moveTo(cx, y - 55 * s); x.lineTo(cx - 8 * s, y - 60 * s); x.lineTo(cx - 8 * s, y - 50 * s); x.closePath(); x.moveTo(cx, y - 55 * s); x.lineTo(cx + 8 * s, y - 60 * s); x.lineTo(cx + 8 * s, y - 50 * s); x.fill();
    x.fillStyle = "#fff"; x.beginPath(); x.arc(cx - 13 * s, y - 50 * s, 3.5 * s, 0, 7); x.fill();
  }
}
function brideHead(cx, cy, s) {
  const hw = 33 * s, hh = 30 * s;
  const vg = x.createLinearGradient(0, cy - hh, 0, cy + hh * 2.4); vg.addColorStop(0, "rgba(255,255,255,0.95)"); vg.addColorStop(1, "rgba(255,255,255,0.35)");
  x.fillStyle = vg; rr2(cx - hw - 9 * s, cy - hh - 6 * s, (hw + 9 * s) * 2, hh * 2.9, 28 * s); x.fill();
  const hg = x.createLinearGradient(0, cy - hh, 0, cy + hh * 2); hg.addColorStop(0, "#f7d77e"); hg.addColorStop(1, "#d9a840");
  x.fillStyle = hg; rr2(cx - hw - 4 * s, cy - hh * 0.6, (hw + 4 * s) * 2, hh * 1.75, 22 * s); x.fill();
  x.beginPath(); x.ellipse(cx - hw + 2 * s, cy + hh * 0.9, 9 * s, hh * 0.85, 0.12, 0, 7); x.ellipse(cx + hw - 2 * s, cy + hh * 0.9, 9 * s, hh * 0.85, -0.12, 0, 7); x.fill();
  x.fillStyle = "#e9b28c"; x.beginPath(); x.ellipse(cx - hw, cy + 4 * s, 6 * s, 9 * s, 0, 0, 7); x.ellipse(cx + hw, cy + 4 * s, 6 * s, 9 * s, 0, 0, 7); x.fill();
  const sg = x.createRadialGradient(cx - 10 * s, cy - 12 * s, 4 * s, cx, cy, 44 * s); sg.addColorStop(0, "#ffe0c6"); sg.addColorStop(0.65, "#f4c7a2"); sg.addColorStop(1, "#dca07a");
  x.fillStyle = sg; rr2(cx - hw, cy - hh, hw * 2, hh * 2, 24 * s); x.fill();
  x.fillStyle = hg; x.beginPath(); x.moveTo(cx - hw - 3 * s, cy + 2 * s); x.quadraticCurveTo(cx - hw - 3 * s, cy - hh - 12 * s, cx, cy - hh - 10 * s); x.quadraticCurveTo(cx + hw + 3 * s, cy - hh - 12 * s, cx + hw + 3 * s, cy + 2 * s);
  x.quadraticCurveTo(cx + hw - 6 * s, cy - 12 * s, cx + 4 * s, cy - hh + 6 * s); x.quadraticCurveTo(cx - 2 * s, cy - 14 * s, cx - hw + 2 * s, cy - 6 * s); x.quadraticCurveTo(cx - hw, cy - 2 * s, cx - hw - 3 * s, cy + 2 * s); x.fill();
  x.strokeStyle = "rgba(255,255,255,0.45)"; x.lineWidth = 2 * s; for (const d of [-14, -4, 8, 18]) { x.beginPath(); x.moveTo(cx + d * s, cy - hh - 6 * s); x.quadraticCurveTo(cx + (d + 6) * s, cy - hh, cx + (d + 2) * s, cy - hh + 10 * s); x.stroke(); }
  for (const [a, b] of [[-24, -27], [-12, -33], [0, -35], [12, -33], [24, -27]]) { x.fillStyle = "#fff"; x.beginPath(); x.arc(cx + a * s, cy + b * s, 6 * s, 0, 7); x.fill(); x.fillStyle = "#f3a6c0"; x.beginPath(); x.arc(cx + a * s, cy + b * s, 2.4 * s, 0, 7); x.fill(); }
  x.strokeStyle = "#c0913a"; x.lineWidth = 2.6 * s; x.lineCap = "round";
  for (const e of [-13, 13]) { x.beginPath(); x.moveTo(cx + (e - 7) * s, cy - 7 * s); x.quadraticCurveTo(cx + e * s, cy - 13 * s, cx + (e + 7) * s, cy - 7 * s); x.stroke(); }
  for (const e of [-13, 13]) {
    const ex = cx + e * s, ey = cy + 6 * s;
    const g = x.createRadialGradient(ex - 2 * s, ey - 4 * s, 0.5, ex, ey, 11 * s); g.addColorStop(0, "#555"); g.addColorStop(0.4, "#141010"); g.addColorStop(1, "#050404");
    x.fillStyle = g; x.beginPath(); x.ellipse(ex, ey, 6.5 * s, 10 * s, 0, 0, 7); x.fill();
    x.fillStyle = "rgba(255,255,255,0.9)"; x.beginPath(); x.ellipse(ex - 2.5 * s, ey - 4.5 * s, 2 * s, 2.8 * s, -0.3, 0, 7); x.fill();
  }
  x.fillStyle = "#d9956c"; x.beginPath(); x.ellipse(cx, cy + 15 * s, 3 * s, 2.2 * s, 0, 0, 7); x.fill();
  x.fillStyle = "rgba(240,120,130,0.3)"; x.beginPath(); x.arc(cx - 22 * s, cy + 17 * s, 6 * s, 0, 7); x.arc(cx + 22 * s, cy + 17 * s, 6 * s, 0, 7); x.fill();
  x.fillStyle = "#b8404e"; x.beginPath(); x.moveTo(cx - 8 * s, cy + 21 * s); x.quadraticCurveTo(cx, cy + 30 * s, cx + 8 * s, cy + 21 * s); x.closePath(); x.fill();
  x.fillStyle = "#fff"; rr2(cx - 6 * s, cy + 21 * s, 12 * s, 3 * s, 1.5 * s); x.fill();
}
function topper(cx, y) {
  const s = 0.9;
  body(cx - 30, y, s, false);
  if (DENIS_HEAD.complete && DENIS_HEAD.naturalWidth) { const w = 74 * s, h = w * DENIS_HEAD.naturalHeight / DENIS_HEAD.naturalWidth; x.drawImage(DENIS_HEAD, cx - 30 - w / 2, y - 60 * s - h + 10 * s, w, h); }
  body(cx + 32, y, s, true);
  brideHead(cx + 32, y - 60 * s - 26 * s, s * 0.86);
  x.fillStyle = "#ff6f9f"; x.font = "900 34px sans-serif"; x.textAlign = "center"; x.fillText("♥", cx + 1, y - 150);
}
let last = 0;
function frame(now) {
  const dt = Math.min(50, now - (last || now)) / 1000; last = now;
  if (state === "play") {
    cur.x += cur.dir * speed * dt;
    if (cur.x > W - cur.w * 0.15) cur.dir = -1; if (cur.x < -cur.w * 0.85) cur.dir = 1;
  }
  cam += (camT - cam) * Math.min(1, dt * 6);
  backdrop(now, dt, cam);
  x.save(); x.translate(0, cam);
  x.fillStyle = "#fffaf0"; rr(40, BASE_Y + TH, W - 80, 260, 16); x.fill();
  x.fillStyle = "#f3c6d6"; rr(40, BASE_Y + TH, W - 80, 26, 10); x.fill();
  x.fillStyle = "#d9d2c4"; rr(110, BASE_Y + TH - 8, 500, 16, 8); x.fill();
  tiers.forEach((t, i) => tier(t, BASE_Y - i * TH));
  if (state === "play") tier(cur, BASE_Y - tiers.length * TH);
  if (state === "over") topper(tiers[tiers.length - 1].x + tiers[tiers.length - 1].w / 2, BASE_Y - (tiers.length - 1) * TH);
  falling = falling.filter((f) => f.y < BASE_Y + 600);
  for (const f of falling) { f.vy += 1400 * dt; f.y += f.vy * dt; f.x += f.vx * dt; f.r += f.vx * dt * 0.002; x.save(); x.translate(f.x + f.w / 2, f.y + TH / 2); x.rotate(f.r); x.translate(-(f.x + f.w / 2), -(f.y + TH / 2)); tier(f, f.y, 0.9); x.restore(); }
  conf = conf.filter((c) => c.t < 1.6);
  for (const c of conf) { c.t += dt; c.vy += 900 * dt; c.vx *= 0.985; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; x.save(); x.globalAlpha = Math.max(0, 1 - c.t / 1.6); x.translate(c.x, c.y); x.rotate(c.r); x.fillStyle = c.c; x.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(Math.cos(c.t * 9 + c.r))); x.restore(); }
  fx = fx.filter((e) => now - e.t < 800);
  for (const e of fx) { const k = (now - e.t) / 800; x.globalAlpha = 1 - k; x.font = "900 44px sans-serif"; x.textAlign = "center"; x.lineWidth = 6; x.strokeStyle = "rgba(60,30,0,0.7)"; x.strokeText(e.txt, W / 2, e.y - 20 - k * 60); x.fillStyle = "#ffd24c"; x.fillText(e.txt, W / 2, e.y - 20 - k * 60); x.globalAlpha = 1; }
  x.restore();
  if (tiers) { const txt = `Piętra tortu: ${tiers.length - 1}`; x.font = "900 30px sans-serif"; const w = x.measureText(txt).width + 56; x.fillStyle = "#1a110a"; rr(W / 2 - w / 2, 40, w, 60, 30); x.fill(); x.strokeStyle = "#e6a92e"; x.lineWidth = 3.5; rr(W / 2 - w / 2, 40, w, 60, 30); x.stroke(); x.fillStyle = "#fff7ec"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, W / 2, 71); x.textBaseline = "alphabetic"; }
  if (state === "ready" || (state === "over" && now - overAt > 900)) {
    x.fillStyle = "rgba(10,5,2,0.55)"; x.fillRect(0, 0, W, H); x.textAlign = "center";
    x.font = "900 72px sans-serif"; x.fillStyle = "#ffd24c"; x.fillText(state === "ready" ? "TORT" : "TORT GOTOWY!", W / 2, H / 2 - 30);
    x.font = "900 32px sans-serif"; x.fillStyle = "#fff7ec"; x.fillText(state === "ready" ? "Kliknij, żeby zacząć" : `Pięter: ${tiers.length - 1}. Kliknij, żeby zagrać`, W / 2, H / 2 + 30);
  }
  requestAnimationFrame(frame);
}
cv.addEventListener("pointerdown", () => { if (state === "play") drop(); else if (state === "ready" || performance.now() - overAt > 900) reset(); });
requestAnimationFrame(frame);
})();
