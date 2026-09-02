// Edytor beatmap (chartów) do gry DENIS Impulsywni Live.
//
// Samodzielne narzędzie webowe (nie trafia do apki). Wczytujesz MP3, ustawiasz
// BPM + offset, klikasz nuty na siatce beatów, słuchasz i eksportujesz plik
// `<id>.json` w formacie, którego oczekuje gra (`public/charts/<id>.json`).

const LANES = 4;
const LANE_KEYS: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };

interface Note {
  lane: number;
  time: number;
  dur: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>("file");
const jsonInput = $<HTMLInputElement>("jsonfile");
const sidInput = $<HTMLInputElement>("sid");
const titleInput = $<HTMLInputElement>("title");
const bpmInput = $<HTMLInputElement>("bpm");
const offsetInput = $<HTMLInputElement>("offset");
const snapSel = $<HTMLSelectElement>("snap");
const speedSel = $<HTMLSelectElement>("speed");
const metroChk = $<HTMLInputElement>("metro");
const ntickChk = $<HTMLInputElement>("ntick");
const playBtn = $<HTMLButtonElement>("play");
const timeLbl = $<HTMLSpanElement>("time");
const cntLbl = $<HTMLSpanElement>("cnt");
const cv = $<HTMLCanvasElement>("cv");
const drop = $<HTMLDivElement>("drop");
const ctx2d = cv.getContext("2d")!;

// ---- stan -------------------------------------------------------

const actx = new AudioContext();
let audioBuffer: AudioBuffer | null = null;
let peaks: Float32Array = new Float32Array(0);
let peaksPerSec = 24;

let notes: Note[] = [];
const history: Note[][] = [];

const view = { top: 0, pps: 220 }; // pixels per second (zoom)
let audioTime = 0;
let playing = false;
let src: AudioBufferSourceNode | null = null;
let ctxStart = 0;
let playFrom = 0;
let lastTick = 0;

let drag: { lane: number; startT: number; note: Note | null } | null = null;

// ---- pomocnicze -----------------------------------------------

const bpm = () => Math.max(30, Number(bpmInput.value) || 120);
const offset = () => (Number(offsetInput.value) || 0) / 1000;
const snapDiv = () => Number(snapSel.value) || 4;
const speed = () => Number(speedSel.value) || 1;
const beatLen = () => 60 / bpm();
const subLen = () => beatLen() / snapDiv();
const duration = () => audioBuffer?.duration ?? 0;

function snapTime(t: number): number {
  const s = subLen();
  return +(offset() + Math.round((t - offset()) / s) * s).toFixed(4);
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

function pushHistory() {
  history.push(notes.map((n) => ({ ...n })));
  if (history.length > 200) history.shift();
}

function undo() {
  const prev = history.pop();
  if (prev) notes = prev;
}

// ---- audio ---------------------------------------------------

async function loadAudio(f: File) {
  const buf = await f.arrayBuffer();
  audioBuffer = await actx.decodeAudioData(buf);
  drop.style.display = "none";
  computePeaks();
  if (!sidInput.value || sidInput.value === "nowy-utwor") {
    sidInput.value = f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  }
  stop();
  audioTime = 0;
}

function computePeaks() {
  if (!audioBuffer) return;
  const ch = audioBuffer.getChannelData(0);
  const n = Math.ceil(audioBuffer.duration * peaksPerSec);
  const bucket = Math.floor(ch.length / n) || 1;
  peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    const start = i * bucket;
    for (let j = start; j < start + bucket && j < ch.length; j++) {
      const a = Math.abs(ch[j]);
      if (a > max) max = a;
    }
    peaks[i] = max;
  }
}

function play() {
  if (!audioBuffer || playing) return;
  src = actx.createBufferSource();
  src.buffer = audioBuffer;
  src.playbackRate.value = speed();
  src.connect(actx.destination);
  src.onended = () => {
    if (playing) stop();
  };
  const startAt = Math.min(Math.max(audioTime, 0), audioBuffer.duration - 0.05);
  src.start(0, startAt);
  ctxStart = actx.currentTime;
  playFrom = startAt;
  lastTick = startAt;
  playing = true;
  playBtn.textContent = "❚❚ pauza";
  void actx.resume();
}

function stop() {
  if (src) {
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* już zatrzymane */
    }
    src.disconnect();
    src = null;
  }
  playing = false;
  playBtn.textContent = "► graj";
}

function beep(freq: number, when: number, gain = 0.25) {
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.frequency.value = freq;
  o.type = "square";
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  o.connect(g).connect(actx.destination);
  o.start(when);
  o.stop(when + 0.07);
}

// ---- rysowanie ---------------------------------------------

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(cv.clientWidth * dpr);
  cv.height = Math.round(cv.clientHeight * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);

const W = () => cv.clientWidth;
const H = () => cv.clientHeight;
const laneW = () => W() / LANES;
const yOf = (t: number) => (t - view.top) * view.pps;
const tOf = (y: number) => view.top + y / view.pps;

function draw() {
  const w = W();
  const h = H();
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = "#0b0b12";
  ctx2d.fillRect(0, 0, w, h);

  const tTop = view.top;
  const tBot = view.top + h / view.pps;

  // fala dźwiękowa (za torami)
  if (peaks.length) {
    ctx2d.fillStyle = "rgba(120,150,255,0.14)";
    const cx = w / 2;
    for (let y = 0; y < h; y += 2) {
      const t = tOf(y);
      if (t < 0 || t > duration()) continue;
      const p = peaks[Math.floor(t * peaksPerSec)] || 0;
      const half = p * (w * 0.42);
      ctx2d.fillRect(cx - half, y, half * 2, 2);
    }
  }

  // tory
  for (let i = 1; i < LANES; i++) {
    ctx2d.strokeStyle = "rgba(255,255,255,0.08)";
    ctx2d.beginPath();
    ctx2d.moveTo(i * laneW(), 0);
    ctx2d.lineTo(i * laneW(), h);
    ctx2d.stroke();
  }

  // siatka beatów
  const s = subLen();
  const beat = beatLen();
  const off = offset();
  const kStart = Math.floor((tTop - off) / s) - 1;
  const kEnd = Math.ceil((tBot - off) / s) + 1;
  ctx2d.font = "10px system-ui";
  for (let k = kStart; k <= kEnd; k++) {
    const t = off + k * s;
    if (t < 0) continue;
    const y = yOf(t);
    const onBeat = Math.abs(((t - off) / beat) % 1) < 0.01 || Math.abs(((t - off) / beat) % 1) > 0.99;
    const barIdx = (t - off) / (beat * 4);
    const onBar = Math.abs(barIdx % 1) < 0.01;
    ctx2d.strokeStyle = onBar ? "rgba(255,206,138,0.45)" : onBeat ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)";
    ctx2d.lineWidth = onBar ? 1.5 : 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, y);
    ctx2d.lineTo(w, y);
    ctx2d.stroke();
    if (onBar) {
      ctx2d.fillStyle = "rgba(255,206,138,0.7)";
      ctx2d.fillText(`bar ${Math.round(barIdx) + 1}`, 4, y - 3);
    }
  }

  // nuty
  for (const n of notes) {
    if (n.time + n.dur < tTop || n.time > tBot) continue;
    const x = n.lane * laneW() + 5;
    const bw = laneW() - 10;
    const y = yOf(n.time);
    const onBeat = Math.abs(((n.time - off) / beat) % 1) < 0.02;
    if (n.dur > 0) {
      ctx2d.fillStyle = "rgba(99,153,34,0.6)";
      ctx2d.fillRect(x, y, bw, n.dur * view.pps);
    }
    ctx2d.fillStyle = onBeat ? "#e24b4a" : "#378add";
    ctx2d.fillRect(x, y - 7, bw, 14);
  }

  // linia „teraz"
  const py = yOf(audioTime);
  ctx2d.strokeStyle = "#ff9f43";
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  ctx2d.moveTo(0, py);
  ctx2d.lineTo(w, py);
  ctx2d.stroke();

  // etykiety torów
  ctx2d.fillStyle = "rgba(255,255,255,0.35)";
  ctx2d.font = "11px system-ui";
  ["D", "F", "J", "K"].forEach((c, i) => ctx2d.fillText(c, i * laneW() + laneW() / 2 - 3, 14));
}

// ---- pętla ------------------------------------------------

function frame() {
  if (playing && audioBuffer) {
    audioTime = playFrom + (actx.currentTime - ctxStart) * speed();
    if (audioTime >= audioBuffer.duration) {
      stop();
      audioTime = audioBuffer.duration;
    }
    // trzymaj „teraz" w 70% wysokości
    view.top = audioTime - (H() * 0.7) / view.pps;

    // tiki
    const now = audioTime;
    if (metroChk.checked) {
      const b = beatLen();
      const k0 = Math.ceil((lastTick - offset()) / b);
      const k1 = Math.floor((now - offset()) / b);
      for (let k = k0; k <= k1; k++) {
        const t = offset() + k * b;
        beep(k % 4 === 0 ? 1400 : 900, actx.currentTime + Math.max(0, (t - now) / speed()), 0.18);
      }
    }
    if (ntickChk.checked) {
      for (const n of notes) {
        if (n.time > lastTick && n.time <= now) {
          beep(1800, actx.currentTime + Math.max(0, (n.time - now) / speed()), 0.22);
        }
      }
    }
    lastTick = now;
  }
  timeLbl.textContent = fmt(audioTime);
  cntLbl.textContent = String(notes.length);
  draw();
  requestAnimationFrame(frame);
}

// ---- interakcja ----------------------------------------

function noteAt(x: number, y: number): Note | null {
  const lane = Math.floor(x / laneW());
  for (const n of notes) {
    if (n.lane !== lane) continue;
    const hy = yOf(n.time);
    const ty = hy + n.dur * view.pps;
    if (y >= hy - 9 && y <= Math.max(hy + 9, ty + 4)) return n;
  }
  return null;
}

cv.addEventListener("pointerdown", (e) => {
  if (!audioBuffer) return;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const hit = noteAt(x, y);
  if (hit) {
    pushHistory();
    notes = notes.filter((n) => n !== hit);
    return;
  }
  const lane = Math.max(0, Math.min(LANES - 1, Math.floor(x / laneW())));
  const startT = snapTime(tOf(y));
  if (startT < 0) return;
  pushHistory();
  const note: Note = { lane, time: startT, dur: 0 };
  notes.push(note);
  drag = { lane, startT, note };
  cv.setPointerCapture(e.pointerId);
});

cv.addEventListener("pointermove", (e) => {
  if (!drag || !drag.note) return;
  const r = cv.getBoundingClientRect();
  const endT = snapTime(tOf(e.clientY - r.top));
  drag.note.dur = Math.max(0, +(endT - drag.startT).toFixed(4));
});

cv.addEventListener("pointerup", () => {
  drag = null;
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
});

cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.shiftKey) {
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      view.pps = Math.max(60, Math.min(900, view.pps * f));
    } else {
      view.top += (e.deltaY / view.pps) * 0.6;
      view.top = Math.max(-2, Math.min(duration() + 2, view.top));
    }
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.code === "Space") {
    e.preventDefault();
    playing ? stop() : play();
  } else if (e.code === "KeyZ") {
    undo();
  } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    const d = (e.code === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? beatLen() * 4 : beatLen());
    audioTime = Math.max(0, Math.min(duration(), audioTime + d));
    if (!playing) view.top = audioTime - (H() * 0.7) / view.pps;
  } else if (LANE_KEYS[e.code] !== undefined && playing) {
    // wystukiwanie w trakcie odsłuchu
    pushHistory();
    notes.push({ lane: LANE_KEYS[e.code], time: snapTime(audioTime), dur: 0 });
  }
});

// klik w oś czasu (poza canvasem nie ma) — klik prawym = przeskok
cv.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  audioTime = Math.max(0, Math.min(duration(), tOf(e.clientY - r.top)));
  if (!playing) view.top = audioTime - (H() * 0.7) / view.pps;
});

// ---- BPM tap ------------------------------------------

let taps: number[] = [];
$<HTMLButtonElement>("tap").addEventListener("click", () => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 3000);
  taps.push(now);
  if (taps.length >= 3) {
    const spans = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
    bpmInput.value = (60000 / avg).toFixed(1);
  }
});

$<HTMLButtonElement>("offm").addEventListener("click", () => (offsetInput.value = String((Number(offsetInput.value) || 0) - 5)));
$<HTMLButtonElement>("offp").addEventListener("click", () => (offsetInput.value = String((Number(offsetInput.value) || 0) + 5)));
playBtn.addEventListener("click", () => (playing ? stop() : play()));
speedSel.addEventListener("change", () => {
  if (playing) {
    stop();
    play();
  }
});

// ---- wczytywanie plików ------------------------------

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void loadAudio(f);
});
["dragover", "drop"].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "drop") {
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f && f.type.startsWith("audio")) void loadAudio(f);
    }
  }),
);

$<HTMLButtonElement>("loadjson").addEventListener("click", () => jsonInput.click());
jsonInput.addEventListener("change", async () => {
  const f = jsonInput.files?.[0];
  if (!f) return;
  try {
    const raw = JSON.parse(await f.text());
    sidInput.value = raw.id || sidInput.value;
    titleInput.value = raw.title || titleInput.value;
    if (raw.bpm) bpmInput.value = String(raw.bpm);
    if (raw.gridOffset != null) offsetInput.value = String(Math.round(raw.gridOffset * 1000));
    if (Array.isArray(raw.notes)) {
      pushHistory();
      notes = raw.notes.map((n: { lane: number; time: number; dur?: number }) => ({
        lane: n.lane,
        time: n.time,
        dur: n.dur || 0,
      }));
      notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    }
  } catch (err) {
    alert("Nie udało się wczytać JSON: " + err);
  }
});

// ---- eksport ---------------------------------------

$<HTMLButtonElement>("export").addEventListener("click", () => {
  const id = sidInput.value.trim() || "utwor";
  const out = {
    id,
    title: titleInput.value.trim() || id,
    artist: "Denis",
    bpm: Number(bpmInput.value) || 120,
    gridOffset: +offset().toFixed(4),
    duration: +duration().toFixed(3),
    audioUrl: `assets/songs/${id}.mp3`,
    notes: notes
      .slice()
      .sort((a, b) => a.time - b.time || a.lane - b.lane)
      .map((n) => ({ lane: n.lane, time: +n.time.toFixed(3), dur: n.dur ? +n.dur.toFixed(3) : 0 })),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- start --------------------------------------------

resize();
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  (window as unknown as { __ed: unknown }).__ed = {
    notes: () => notes,
    view,
    get audioTime() {
      return audioTime;
    },
  };
}
