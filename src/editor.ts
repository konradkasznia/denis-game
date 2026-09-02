// Edytor beatmap (chartów) do gry DENIS Impulsywni Live.
//
// Samodzielne narzędzie webowe (nie trafia do apki). Wczytujesz MP3, ustawiasz
// BPM + offset, klikasz nuty na siatce beatów, ustawiasz oś ujęć postaci
// (z podglądem animacji na bieżąco) i eksportujesz `<id>.json` w formacie,
// którego oczekuje gra (`public/charts/<id>.json`).

import { Character } from "./character.ts";

const LANES = 4;
const WAVE = 46; // 1. kolumna: fala dźwiękowa — klik = przewiń utwór do tego miejsca
const SEGCOL = 46; // 2. kolumna: oś ujęć postaci — klik = wstaw / chwyć znacznik ujęcia
const GUTTER = WAVE + SEGCOL; // cała lewa strefa przed torami nut
// klawisze nagrywania Live (C V B N) + alias na klawisze gry (D F J K)
const LANE_KEYS: Record<string, number> = {
  KeyC: 0, KeyV: 1, KeyB: 2, KeyN: 3,
  KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3,
};

interface Note {
  lane: number;
  time: number;
  dur: number;
}
interface Seg {
  at: number;
  uj: number;
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
const ujSel = $<HTMLSelectElement>("ujsel");
const metroChk = $<HTMLInputElement>("metro");
const ntickChk = $<HTMLInputElement>("ntick");
const playBtn = $<HTMLButtonElement>("play");
const timeLbl = $<HTMLSpanElement>("time");
const cntLbl = $<HTMLSpanElement>("cnt");
const cv = $<HTMLCanvasElement>("cv");
const drop = $<HTMLDivElement>("drop");
const projSel = $<HTMLSelectElement>("proj");
const savedLbl = $<HTMLSpanElement>("saved");
const ctx2d = cv.getContext("2d")!;

// ---- stan -------------------------------------------------------

const actx = new AudioContext();
let audioBuffer: AudioBuffer | null = null;
let peaks: Float32Array = new Float32Array(0);
const peaksPerSec = 24;

let notes: Note[] = [];
let segments: Seg[] = [];
const history: { notes: Note[]; segments: Seg[] }[] = [];

const view = { top: 0, pps: 220 };
let audioTime = 0;
let playing = false;
let src: AudioBufferSourceNode | null = null;
let ctxStart = 0;
let playFrom = 0;
let lastTick = 0;

type Drag =
  | { mode: "create"; note: Note; startT: number }
  | { mode: "move"; note: Note; grabDT: number; moved: boolean }
  | { mode: "resize"; note: Note }
  | { mode: "seg"; seg: Seg };
let drag: Drag | null = null;

// nuty aktualnie „trzymane" w nagrywaniu Live (klawisz wciśnięty)
const recording = new Map<number, { note: Note; downT: number }>();

const character = new Character();
let charSig = "";

// ---- pomocnicze -----------------------------------------------

const bpm = () => Math.max(30, Number(bpmInput.value) || 120);
const offset = () => (Number(offsetInput.value) || 0) / 1000;
const snapDiv = () => Number(snapSel.value) || 4;
const speed = () => Number(speedSel.value) || 1;
const beatLen = () => 60 / bpm();
const subLen = () => beatLen() / snapDiv();
const duration = () => audioBuffer?.duration ?? 0;
const songId = () => sidInput.value.trim() || "utwor";

function snapTime(t: number): number {
  const s = subLen();
  return +(offset() + Math.round((t - offset()) / s) * s).toFixed(4);
}
function fmt(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}
function pushHistory() {
  history.push({ notes: notes.map((n) => ({ ...n })), segments: segments.map((s) => ({ ...s })) });
  if (history.length > 200) history.shift();
  markDirty();
}

// ---- zapis projektów (localStorage + IndexedDB na audio) -----

const LIST_KEY = "editor.projects";
const LAST_KEY = "editor.lastProject";
const pKey = (id: string) => `editor.project.${id}`;
let currentId = "panna-mloda";
let dirtyTimer: ReturnType<typeof setTimeout> | null = null;

interface StoredProject {
  id: string;
  title: string;
  bpm: number;
  offsetMs: number;
  notes: Note[];
  segments: Seg[];
  savedAt: number;
}

function projectIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) || "[]");
  } catch {
    return [];
  }
}
function setProjectIds(ids: string[]) {
  localStorage.setItem(LIST_KEY, JSON.stringify([...new Set(ids)]));
}

let audioDb: IDBDatabase | null = null;
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (audioDb) return res(audioDb);
    const r = indexedDB.open("denis-editor", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("audio");
    r.onsuccess = () => {
      audioDb = r.result;
      res(audioDb);
    };
    r.onerror = () => rej(r.error);
  });
}
async function audioPut(id: string, blob: Blob) {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction("audio", "readwrite");
    tx.objectStore("audio").put(blob, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function audioGet(id: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((res) => {
    const tx = db.transaction("audio", "readonly");
    const g = tx.objectStore("audio").get(id);
    g.onsuccess = () => res((g.result as Blob) || null);
    g.onerror = () => res(null);
  });
}

function markDirty() {
  savedLbl.textContent = "…";
  if (dirtyTimer) clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(saveNow, 1200);
}
function saveNow() {
  const id = songId();
  const p: StoredProject = {
    id,
    title: titleInput.value.trim() || id,
    bpm: Number(bpmInput.value) || 120,
    offsetMs: Number(offsetInput.value) || 0,
    notes,
    segments,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(pKey(id), JSON.stringify(p));
    setProjectIds([...projectIds(), id]);
    localStorage.setItem(LAST_KEY, id);
    currentId = id;
    savedLbl.textContent = "zapisano ✓";
    refreshProjectList();
  } catch {
    savedLbl.textContent = "błąd zapisu";
  }
}

function refreshProjectList() {
  const ids = projectIds();
  projSel.innerHTML = "";
  for (const id of ids) {
    const o = document.createElement("option");
    o.value = id;
    let title = id;
    try {
      title = JSON.parse(localStorage.getItem(pKey(id)) || "{}").title || id;
    } catch {
      /* ignore */
    }
    o.textContent = title;
    projSel.appendChild(o);
  }
  const nw = document.createElement("option");
  nw.value = "__new__";
  nw.textContent = "＋ nowy projekt…";
  projSel.appendChild(nw);
  projSel.value = currentId;
}

async function openProject(id: string) {
  const raw = localStorage.getItem(pKey(id));
  if (!raw) return;
  const p = JSON.parse(raw) as StoredProject;
  stop();
  currentId = id;
  sidInput.value = p.id;
  titleInput.value = p.title;
  bpmInput.value = String(p.bpm);
  offsetInput.value = String(p.offsetMs);
  notes = (p.notes || []).map((n) => ({ ...n }));
  segments = (p.segments || []).map((s) => ({ ...s }));
  history.length = 0;
  audioTime = 0;
  view.top = 0;
  syncCharacter();
  localStorage.setItem(LAST_KEY, id);
  const blob = await audioGet(id);
  if (blob) {
    try {
      await decodeInto(blob, true);
    } catch {
      drop.style.display = "flex";
    }
  } else {
    audioBuffer = null;
    peaks = new Float32Array(0);
    drop.style.display = "flex";
    drop.textContent = "brak zapisanego MP3 dla tego projektu — przeciągnij plik";
  }
  savedLbl.textContent = "";
  refreshProjectList();
}

async function newProject() {
  const id = (prompt("Id nowego projektu (bez spacji, np. ksiaze-z-bajki):") || "").trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  if (!id) {
    refreshProjectList();
    return;
  }
  stop();
  currentId = id;
  sidInput.value = id;
  titleInput.value = id;
  bpmInput.value = "120";
  offsetInput.value = "0";
  notes = [];
  segments = [];
  history.length = 0;
  audioBuffer = null;
  peaks = new Float32Array(0);
  audioTime = 0;
  view.top = 0;
  drop.style.display = "flex";
  drop.textContent = "przeciągnij tu plik MP3 albo wybierz go powyżej";
  syncCharacter();
  saveNow();
}
function undo() {
  const prev = history.pop();
  if (prev) {
    notes = prev.notes;
    segments = prev.segments;
    syncCharacter();
    markDirty();
  }
}

// ---- postać (podgląd) --------------------------------------

function syncCharacter() {
  const sig = songId() + "|" + segments.map((s) => `${s.at}:${s.uj}`).join(",");
  if (sig === charSig) return;
  charSig = sig;
  if (!segments.length) {
    character.load({});
    return;
  }
  character.load({
    characters: segments
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((s) => ({ at: s.at, sprite: `assets/char/${songId()}/ujecie${s.uj}` })),
  });
}
function activeUj(t: number): number {
  let uj = segments.length ? segments[0].uj : 0;
  const sorted = segments.slice().sort((a, b) => a.at - b.at);
  for (const s of sorted) if (t >= s.at) uj = s.uj;
  return uj;
}

// ---- audio ---------------------------------------------------

async function decodeInto(f: File | Blob, fromStore = false) {
  const buf = await f.arrayBuffer();
  try {
    await actx.resume();
  } catch {
    /* bez gestu zostanie suspended — nie szkodzi dekodowaniu */
  }
  audioBuffer = await actx.decodeAudioData(buf.slice(0));
  drop.style.display = "none";
  computePeaks();
  stop();
  audioTime = 0;
  if (!fromStore) {
    // zapisz plik przy projekcie, żeby wrócił po ponownym wejściu
    void audioPut(songId(), f instanceof Blob ? f : new Blob([buf]));
    markDirty();
  }
}
function computePeaks() {
  if (!audioBuffer) return;
  const ch = audioBuffer.getChannelData(0);
  const n = Math.ceil(audioBuffer.duration * peaksPerSec);
  const bucket = Math.floor(ch.length / n) || 1;
  peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    for (let j = i * bucket; j < i * bucket + bucket && j < ch.length; j++) {
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
  // domknij nuty, których klawisz był jeszcze wciśnięty przy pauzie
  for (const [lane, rec] of recording) {
    rec.note.dur = Math.max(0, +(audioTime - rec.downT).toFixed(4));
    if (rec.note.dur < 0.08) rec.note.dur = 0;
    recording.delete(lane);
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
}
/** Przewiń odtwarzanie do sekundy `t` (resync, gdy gra). */
function seekTo(t: number) {
  const was = playing;
  if (was) stop();
  audioTime = Math.max(0, Math.min(duration(), t));
  view.top = audioTime - (H() * 0.7) / view.pps;
  if (was) play();
}
function beep(freq: number, when: number, gain = 0.22) {
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

// ---- geometria ------------------------------------------

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(cv.clientWidth * dpr);
  cv.height = Math.round(cv.clientHeight * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);

const W = () => cv.clientWidth;
const H = () => cv.clientHeight;
const laneW = () => (W() - GUTTER) / LANES;
const laneX = (lane: number) => GUTTER + lane * laneW();
const laneAtX = (x: number) => Math.max(0, Math.min(LANES - 1, Math.floor((x - GUTTER) / laneW())));
const yOf = (t: number) => (t - view.top) * view.pps;
const tOf = (y: number) => view.top + y / view.pps;

// ---- rysowanie --------------------------------------------

function draw() {
  const w = W();
  const h = H();
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = "#0b0b12";
  ctx2d.fillRect(0, 0, w, h);

  const tTop = view.top;
  const tBot = view.top + h / view.pps;

  // 1. kolumna: fala dźwiękowa (klik = przewiń)
  if (peaks.length) {
    ctx2d.fillStyle = "rgba(120,150,255,0.35)";
    const cx = WAVE * 0.5;
    for (let y = 0; y < h; y += 2) {
      const t = tOf(y);
      if (t < 0 || t > duration()) continue;
      const p = peaks[Math.floor(t * peaksPerSec)] || 0;
      const half = p * (WAVE * 0.42);
      ctx2d.fillRect(cx - half, y, half * 2, 2);
    }
  }
  // 2. kolumna: tło osi ujęć + pionowe linie działowe
  ctx2d.fillStyle = "rgba(255,120,200,0.05)";
  ctx2d.fillRect(WAVE, 0, SEGCOL, h);
  ctx2d.strokeStyle = "rgba(255,255,255,0.14)";
  ctx2d.beginPath();
  ctx2d.moveTo(WAVE, 0);
  ctx2d.lineTo(WAVE, h);
  ctx2d.moveTo(GUTTER, 0);
  ctx2d.lineTo(GUTTER, h);
  ctx2d.stroke();

  // linie torów
  for (let i = 1; i < LANES; i++) {
    ctx2d.strokeStyle = "rgba(255,255,255,0.08)";
    ctx2d.beginPath();
    ctx2d.moveTo(laneX(i), 0);
    ctx2d.lineTo(laneX(i), h);
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
    const frac = ((t - off) / beat) % 1;
    const onBeat = Math.abs(frac) < 0.01 || Math.abs(frac) > 0.99;
    const barIdx = (t - off) / (beat * 4);
    const onBar = Math.abs(barIdx % 1) < 0.01;
    ctx2d.strokeStyle = onBar
      ? "rgba(255,206,138,0.45)"
      : onBeat
        ? "rgba(255,255,255,0.22)"
        : "rgba(255,255,255,0.07)";
    ctx2d.lineWidth = onBar ? 1.5 : 1;
    ctx2d.beginPath();
    ctx2d.moveTo(GUTTER, y);
    ctx2d.lineTo(w, y);
    ctx2d.stroke();
    if (onBar) {
      ctx2d.fillStyle = "rgba(255,206,138,0.7)";
      ctx2d.fillText(`bar ${Math.round(barIdx) + 1}`, GUTTER + 4, y - 3);
    }
  }

  // oś ujęć postaci (2. kolumna)
  const sorted = segments.slice().sort((a, b) => a.at - b.at);
  for (const seg of sorted) {
    const y = yOf(seg.at);
    if (y < -20 || y > h + 20) continue;
    ctx2d.strokeStyle = "rgba(255,120,200,0.5)";
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(WAVE, y);
    ctx2d.lineTo(w, y);
    ctx2d.stroke();
    ctx2d.fillStyle = "#ff78c8";
    ctx2d.fillRect(WAVE + 3, y - 9, SEGCOL - 6, 18);
    ctx2d.fillStyle = "#1a0d12";
    ctx2d.font = "bold 11px system-ui";
    ctx2d.fillText(`uj.${seg.uj}`, WAVE + 8, y + 4);
  }

  // nuty
  for (const n of notes) {
    if (n.time + n.dur < tTop || n.time > tBot) continue;
    const x = laneX(n.lane) + 5;
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

  // etykiety kolumn i klawiszy
  ctx2d.fillStyle = "rgba(255,255,255,0.35)";
  ctx2d.font = "10px system-ui";
  ctx2d.fillText("fala", 6, 14);
  ctx2d.fillStyle = "rgba(255,120,200,0.6)";
  ctx2d.fillText("ujęcia", WAVE + 5, 14);
  ctx2d.fillStyle = "rgba(255,255,255,0.35)";
  ctx2d.font = "11px system-ui";
  ["D", "F", "J", "K"].forEach((c, i) => ctx2d.fillText(c, laneX(i) + laneW() / 2 - 3, 14));

  // podgląd postaci (prawy dolny róg)
  const pbw = Math.min(220, w * 0.34);
  const pbh = Math.min(320, h * 0.55);
  const px = w - pbw - 10;
  const pgy = h - pbh - 10;
  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.rect(px, pgy, pbw, pbh);
  ctx2d.clip();
  ctx2d.fillStyle = "#16121c";
  ctx2d.fillRect(px, pgy, pbw, pbh);
  character.draw(ctx2d, px + pbw / 2, pgy + pbh - 24, audioTime, bpm(), pbh - 44);
  ctx2d.restore();
  ctx2d.strokeStyle = "rgba(255,206,138,0.35)";
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(px, pgy, pbw, pbh);
  ctx2d.fillStyle = "#ffce8a";
  ctx2d.font = "bold 12px system-ui";
  ctx2d.fillText(segments.length ? `ujęcie ${activeUj(audioTime)}` : "brak ujęć", px + 8, pgy + 18);
}

// ---- pętla -----------------------------------------------

function frame() {
  syncCharacter();
  if (playing && audioBuffer) {
    audioTime = playFrom + (actx.currentTime - ctxStart) * speed();
    if (audioTime >= audioBuffer.duration) {
      stop();
      audioTime = audioBuffer.duration;
    }
    view.top = audioTime - (H() * 0.7) / view.pps;
    const now = audioTime;
    if (metroChk.checked) {
      const b = beatLen();
      for (let k = Math.ceil((lastTick - offset()) / b); k <= Math.floor((now - offset()) / b); k++) {
        const t = offset() + k * b;
        beep(k % 4 === 0 ? 1400 : 900, actx.currentTime + Math.max(0, (t - now) / speed()), 0.16);
      }
    }
    if (ntickChk.checked) {
      for (const n of notes) {
        if (n.time > lastTick && n.time <= now) {
          beep(1800, actx.currentTime + Math.max(0, (n.time - now) / speed()), 0.2);
        }
      }
    }
    lastTick = now;
  }
  timeLbl.textContent = fmt(audioTime);
  cntLbl.textContent = `${notes.length} nut · ${segments.length} ujęć`;
  draw();
  requestAnimationFrame(frame);
}

// ---- interakcja -----------------------------------------

function noteAt(x: number, y: number): Note | null {
  if (x < GUTTER) return null;
  const lane = laneAtX(x);
  for (const n of notes) {
    if (n.lane !== lane) continue;
    const hy = yOf(n.time);
    const ty = hy + n.dur * view.pps;
    if (y >= hy - 9 && y <= Math.max(hy + 9, ty + 4)) return n;
  }
  return null;
}
function segAt(y: number): Seg | null {
  for (const s of segments) if (Math.abs(yOf(s.at) - y) <= 10) return s;
  return null;
}

cv.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !audioBuffer) return;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  try {
    cv.setPointerCapture(e.pointerId);
  } catch {
    /* brak aktywnego wskaźnika */
  }

  if (x < WAVE) {
    // 1. kolumna (fala) → przewiń utwór do tego miejsca
    seekTo(tOf(y));
    return;
  }
  if (x < GUTTER) {
    // 2. kolumna (oś ujęć) → wstaw / złap znacznik ujęcia
    const hit = segAt(y);
    if (hit) {
      pushHistory();
      drag = { mode: "seg", seg: hit };
    } else {
      pushHistory();
      const seg: Seg = { at: Math.max(0, snapTime(tOf(y))), uj: Number(ujSel.value) || 1 };
      segments.push(seg);
      drag = { mode: "seg", seg };
    }
    return;
  }

  const hit = noteAt(x, y);
  if (hit) {
    pushHistory();
    // blisko dolnej krawędzi przytrzymania → rozciąganie ogona
    if (hit.dur > 0 && Math.abs(y - (yOf(hit.time) + hit.dur * view.pps)) <= 10) {
      drag = { mode: "resize", note: hit };
    } else {
      drag = { mode: "move", note: hit, grabDT: tOf(y) - hit.time, moved: false };
    }
    return;
  }
  const lane = laneAtX(x);
  const startT = Math.max(0, snapTime(tOf(y)));
  pushHistory();
  const note: Note = { lane, time: startT, dur: 0 };
  notes.push(note);
  drag = { mode: "create", note, startT };
});

cv.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (drag.mode === "create") {
    drag.note.dur = Math.max(0, +(snapTime(tOf(y)) - drag.startT).toFixed(4));
  } else if (drag.mode === "move") {
    drag.note.time = Math.max(0, snapTime(tOf(y) - drag.grabDT));
    drag.note.lane = laneAtX(x);
    drag.moved = true;
  } else if (drag.mode === "resize") {
    drag.note.dur = Math.max(0, +(snapTime(tOf(y)) - drag.note.time).toFixed(4));
  } else {
    drag.seg.at = Math.max(0, snapTime(tOf(y)));
  }
});

cv.addEventListener("pointerup", () => {
  drag = null;
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  segments.sort((a, b) => a.at - b.at);
});

cv.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (x < WAVE) {
    seekTo(tOf(y));
    return;
  }
  if (x < GUTTER) {
    const hs = segAt(y);
    if (hs) {
      pushHistory();
      segments = segments.filter((s) => s !== hs);
    }
    return;
  }
  const hn = noteAt(x, y);
  if (hn) {
    pushHistory();
    notes = notes.filter((n) => n !== hn);
    return;
  }
  seekTo(tOf(y));
});

cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.shiftKey) {
      view.pps = Math.max(60, Math.min(900, view.pps * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    } else {
      view.top = Math.max(-2, Math.min(duration() + 2, view.top + (e.deltaY / view.pps) * 0.6));
    }
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT")
    return;
  if (e.code === "Space") {
    e.preventDefault();
    playing ? stop() : play();
  } else if (e.code === "KeyZ") {
    undo();
  } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    const d = (e.code === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? beatLen() * 4 : beatLen());
    audioTime = Math.max(0, Math.min(duration(), audioTime + d));
    if (!playing) view.top = audioTime - (H() * 0.7) / view.pps;
  } else if (/^Digit[1-4]$/.test(e.code) && !e.repeat) {
    // 1–4 = wstaw znacznik ujęcia w miejscu odtwarzania (można w trakcie grania)
    const uj = Number(e.code.slice(5));
    pushHistory();
    ujSel.value = String(uj);
    const at = Math.max(0, snapTime(audioTime));
    const ex = segments.find((s) => Math.abs(s.at - at) < 0.001);
    if (ex) ex.uj = uj;
    else segments.push({ at, uj });
    segments.sort((a, b) => a.at - b.at);
    syncCharacter();
  } else if (LANE_KEYS[e.code] !== undefined && playing && !e.repeat) {
    // nagrywanie Live: keydown = start nuty (czas surowy, wyrównasz później)
    const lane = LANE_KEYS[e.code];
    if (!recording.has(lane)) {
      pushHistory();
      const note: Note = { lane, time: +audioTime.toFixed(4), dur: 0 };
      notes.push(note);
      recording.set(lane, { note, downT: audioTime });
    }
  }
});

window.addEventListener("keyup", (e) => {
  const lane = LANE_KEYS[e.code];
  if (lane === undefined) return;
  const rec = recording.get(lane);
  if (rec) {
    rec.note.dur = Math.max(0, +(audioTime - rec.downT).toFixed(4));
    if (rec.note.dur < 0.08) rec.note.dur = 0; // krótkie = zwykły tap
    recording.delete(lane);
    markDirty();
  }
});

// ---- BPM tap + przyciski --------------------------------

let taps: number[] = [];
$<HTMLButtonElement>("tap").addEventListener("click", () => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 3000);
  taps.push(now);
  if (taps.length >= 3) {
    const spans = taps.slice(1).map((t, i) => t - taps[i]);
    bpmInput.value = (60000 / (spans.reduce((a, b) => a + b, 0) / spans.length)).toFixed(1);
  }
});
const bumpOffset = (d: number) => {
  offsetInput.value = String((Number(offsetInput.value) || 0) + d);
  markDirty();
};
$<HTMLButtonElement>("offm").addEventListener("click", () => bumpOffset(-5));
$<HTMLButtonElement>("offp").addEventListener("click", () => bumpOffset(5));
playBtn.addEventListener("click", () => (playing ? stop() : play()));
speedSel.addEventListener("change", () => {
  if (playing) {
    stop();
    play();
  }
});
bpmInput.addEventListener("change", markDirty);
offsetInput.addEventListener("change", markDirty);
titleInput.addEventListener("change", markDirty);
sidInput.addEventListener("change", () => {
  currentId = songId();
  markDirty();
});
$<HTMLButtonElement>("newproj").addEventListener("click", () => void newProject());
$<HTMLButtonElement>("delproj").addEventListener("click", () => {
  const id = currentId;
  if (!confirm(`Usunąć projekt „${id}" z tej przeglądarki? (eksportowany plik zostaje)`)) return;
  localStorage.removeItem(pKey(id));
  setProjectIds(projectIds().filter((x) => x !== id));
  void audioPut(id, new Blob()).catch(() => {});
  const rest = projectIds();
  if (rest.length) void openProject(rest[0]);
  else void newProject();
});
projSel.addEventListener("change", () => {
  if (projSel.value === "__new__") void newProject();
  else void openProject(projSel.value);
});
$<HTMLButtonElement>("aligngrid").addEventListener("click", () => {
  pushHistory();
  for (const n of notes) {
    const end = snapTime(n.time + n.dur);
    n.time = Math.max(0, snapTime(n.time));
    n.dur = Math.max(0, +(end - n.time).toFixed(4));
  }
  for (const s of segments) s.at = Math.max(0, snapTime(s.at));
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
});

// ---- pliki --------------------------------------------

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void decodeInto(f);
});
["dragover", "drop"].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "drop") {
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f && f.type.startsWith("audio")) void decodeInto(f);
    }
  }),
);
$<HTMLButtonElement>("loadjson").addEventListener("click", () => jsonInput.click());
jsonInput.addEventListener("change", async () => {
  const f = jsonInput.files?.[0];
  if (f) applyChart(JSON.parse(await f.text()));
});

interface RawChart {
  id?: string;
  title?: string;
  bpm?: number;
  gridOffset?: number;
  notes?: { lane: number; time: number; dur?: number }[];
  characters?: { at: number; sprite: string }[];
}
function applyChart(raw: RawChart) {
  pushHistory();
  if (raw.id) sidInput.value = raw.id;
  if (raw.title) titleInput.value = raw.title;
  if (raw.bpm) bpmInput.value = String(raw.bpm);
  if (raw.gridOffset != null) offsetInput.value = String(Math.round(raw.gridOffset * 1000));
  notes = (raw.notes || []).map((n) => ({ lane: n.lane, time: n.time, dur: n.dur || 0 }));
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  segments = (raw.characters || []).map((c) => ({
    at: c.at,
    uj: Number(c.sprite.match(/ujecie(\d+)/)?.[1] || 1),
  }));
  // usuń kolejne wpisy z tym samym ujęciem (auto-rotacja → punkty zmiany)
  segments = segments.filter((s, i) => i === 0 || s.uj !== segments[i - 1].uj);
  syncCharacter();
  markDirty();
}

function buildChart() {
  const id = songId();
  return {
    id,
    title: titleInput.value.trim() || id,
    artist: "Denis",
    bpm: Number(bpmInput.value) || 120,
    gridOffset: +offset().toFixed(4),
    duration: +duration().toFixed(3),
    audioUrl: `assets/songs/${id}.mp3`,
    characterScale: 0.95,
    characterY: 704,
    characters: segments
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((s) => ({ at: +s.at.toFixed(3), sprite: `assets/char/${id}/ujecie${s.uj}` })),
    notes: notes
      .slice()
      .sort((a, b) => a.time - b.time || a.lane - b.lane)
      .map((n) => ({ lane: n.lane, time: +n.time.toFixed(3), dur: n.dur ? +n.dur.toFixed(3) : 0 })),
  };
}

$<HTMLButtonElement>("export").addEventListener("click", () => {
  const out = buildChart();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
  a.download = `${out.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- „Wyślij do aplikacji" — publikacja mapy prosto do gry -----

const PUBKEY = "editor.pubkey";
const pubStat = $<HTMLSpanElement>("pubstat");
function setPub(msg: string, err = false) {
  pubStat.textContent = msg;
  pubStat.style.color = err ? "#ff8a97" : "#7fdc9a";
}
$<HTMLButtonElement>("publish").addEventListener("click", async () => {
  const chart = buildChart();
  if (!chart.notes.length) {
    setPub("mapa nie ma nut — najpierw dodaj nuty", true);
    return;
  }
  let key = localStorage.getItem(PUBKEY) || "";
  if (!key) {
    key = (prompt("Hasło publikacji (to samo, którym logujesz się do edytora):") || "").trim();
    if (!key) return;
    localStorage.setItem(PUBKEY, key);
  }
  setPub("wysyłam…");
  try {
    const r = await fetch("/api/chart", {
      method: "POST",
      headers: { "content-type": "application/json", "x-editor-key": key },
      body: JSON.stringify({ chart }),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (r.status === 401) {
      localStorage.removeItem(PUBKEY);
      setPub("złe hasło publikacji — kliknij jeszcze raz i wpisz poprawne", true);
      return;
    }
    if (!r.ok || !j.ok) {
      setPub(j.error || `błąd serwera (${r.status})`, true);
      return;
    }
    setPub(`wysłano do gry ✓  ${chart.notes.length} nut · ${chart.characters.length} ujęć`);
  } catch {
    setPub("brak połączenia z serwerem (publikacja działa tylko z wersji online)", true);
  }
});

// ---- start / wczytanie projektu ------------------------

/** Cichy WAV z delikatnym „tik" na każdym beacie — żeby `play()` działało
 *  dla utworów bez mp3 (podgląd długości klatek animacji). */
function silentWavBlob(secs: number, bpm: number): Blob {
  const sr = 8000;
  const n = Math.floor(secs * sr);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ws(36, "data");
  dv.setUint32(40, n * 2, true);
  const beat = 60 / Math.max(30, bpm);
  const clickLen = Math.floor(0.014 * sr);
  for (let k = 0; k * beat < secs; k++) {
    const start = Math.floor(k * beat * sr);
    for (let i = 0; i < clickLen && start + i < n; i++) {
      const env = 1 - i / clickLen;
      const v = Math.sin((i / sr) * 2 * Math.PI * 1200) * env * env * 2600;
      dv.setInt16(44 + (start + i) * 2, v, true);
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

interface SeedCfg {
  id: string;
  title: string;
  bpm: number;
  ujecia: number[];
  realAudio?: boolean;
}

/** Segmenty rotujące po dostępnych ujęciach (co 5 s przez 44 s) — do podglądu. */
function seedSegs(ujecia: number[]): Seg[] {
  const segs: Seg[] = [];
  for (let t = 0, i = 0; t < 44; t += 5, i++) {
    segs.push({ at: t, uj: ujecia[i % ujecia.length] });
  }
  return segs;
}

/** Zakłada projekt (jeśli go jeszcze nie ma) z segmentami rotującymi po
 *  dostępnych ujęciach — do podglądu animacji w prawym dolnym rogu.
 *  Gdy projekt-podgląd już jest (bez własnych nut), a doszło nowe ujęcie —
 *  odświeża same segmenty, żeby nadążał za nowymi animacjami. */
async function persistSeed(cfg: SeedCfg) {
  if (projectIds().includes(cfg.id)) {
    if (!cfg.realAudio) {
      try {
        const cur = JSON.parse(localStorage.getItem(pKey(cfg.id)) || "{}") as StoredProject;
        const untouched = (cur?.notes?.length ?? 0) === 0;
        const have = new Set((cur?.segments || []).map((s) => s.uj));
        if (untouched && cfg.ujecia.some((u) => !have.has(u))) {
          cur.segments = seedSegs(cfg.ujecia);
          cur.bpm = cfg.bpm;
          localStorage.setItem(pKey(cfg.id), JSON.stringify(cur));
        }
      } catch {
        /* ignore */
      }
    }
    return;
  }

  const segs = seedSegs(cfg.ujecia);
  const p: StoredProject = {
    id: cfg.id,
    title: cfg.title,
    bpm: cfg.bpm,
    offsetMs: 0,
    notes: [],
    segments: segs,
    savedAt: Date.now(),
  };

  if (cfg.realAudio) {
    // panna-mloda: dołóż prawdziwe nuty + rotację ujęć z gotowego chartu
    try {
      const raw = (await (await fetch(`charts/${cfg.id}.json`)).json()) as RawChart;
      p.notes = (raw.notes || []).map((n) => ({ lane: n.lane, time: n.time, dur: n.dur || 0 }));
      p.bpm = raw.bpm || cfg.bpm;
      p.offsetMs = Math.round((raw.gridOffset ?? 0) * 1000);
      let cs = (raw.characters || []).map((c) => ({
        at: c.at,
        uj: Number(c.sprite.match(/ujecie(\d+)/)?.[1] || 1),
      }));
      cs = cs.filter((s, i) => i === 0 || s.uj !== cs[i - 1].uj);
      if (cs.length) p.segments = cs;
    } catch {
      /* brak chartu — zostają segmenty podglądowe */
    }
    try {
      const blob = await (await fetch(`assets/songs/${cfg.id}.mp3`)).blob();
      await audioPut(cfg.id, blob);
    } catch {
      await audioPut(cfg.id, silentWavBlob(46, p.bpm)); // brak mp3 → cichy podkład
    }
  } else {
    await audioPut(cfg.id, silentWavBlob(46, cfg.bpm));
  }

  localStorage.setItem(pKey(cfg.id), JSON.stringify(p));
  setProjectIds([...projectIds(), cfg.id]);
}

async function startup() {
  // 3 projekty na starcie — po jednym na utwór z grą, z załadowanymi ujęciami
  await persistSeed({ id: "panna-mloda", title: "Panna Młoda", bpm: 155, ujecia: [1, 2, 3, 4], realAudio: true });
  await persistSeed({ id: "ksiaze-z-bajki", title: "Książę z bajki", bpm: 112, ujecia: [1, 2, 3] });
  await persistSeed({ id: "pogrzebowka", title: "Pogrzebówka", bpm: 150, ujecia: [1, 2, 4] });

  refreshProjectList();
  const last = localStorage.getItem(LAST_KEY);
  if (last && projectIds().includes(last)) await openProject(last);
  else await openProject(projectIds()[0] || "panna-mloda");
}

// ---- instrukcja --------------------------------------

const helpBox = $<HTMLDivElement>("help");
$<HTMLButtonElement>("helpbtn").addEventListener("click", () => helpBox.classList.add("on"));
$<HTMLButtonElement>("helpclose").addEventListener("click", () => helpBox.classList.remove("on"));

// ---- start --------------------------------------------

resize();
requestAnimationFrame(frame);
void startup();
window.addEventListener("beforeunload", saveNow);

// jeśli audio nie zdekodowało się przy starcie (np. karta w tle) — spróbuj
// ponownie przy pierwszej interakcji użytkownika
async function retryAudio() {
  if (audioBuffer) return;
  const blob = await audioGet(currentId).catch(() => null);
  if (blob && blob.size > 1000) {
    try {
      await decodeInto(blob, true);
    } catch {
      /* nadal nie — user wgra ręcznie */
    }
  }
}
for (const ev of ["pointerdown", "keydown"]) {
  window.addEventListener(ev, () => void retryAudio(), { once: false });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void retryAudio();
});

if (import.meta.env.DEV) {
  (window as unknown as { __ed: unknown }).__ed = {
    notes: () => notes,
    segments: () => segments,
    view,
    get audioTime() {
      return audioTime;
    },
  };
}
