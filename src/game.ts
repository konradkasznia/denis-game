// Rdzeń gry: maszyna stanów (menu → odliczanie → gra → wynik) oraz cała
// logika rytmiczna i rysowanie.

import { AudioEngine } from "./audio.ts";
import { buildSynthSong, LANES, type Note, type SongDef } from "./chart.ts";
import { DEFAULT_TRACK, loadTrack } from "./tracks.ts";
import {
  ACC_WEIGHT,
  classify,
  comboMultiplier,
  isMissed,
  type Judgement,
  pickNote,
  SCORE,
} from "./judge.ts";
import { discoveredIds, markDiscovered, SONGS, type SongMeta } from "./songs.ts";
import { VH, VW } from "./viewport.ts";
import { clamp, lerp, roundRect, shade, text } from "./ui.ts";

type Scene = "loading" | "menu" | "songs" | "play" | "results";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const inRect = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// --- układ pola gry ---
const MARGIN = 40;
const LANE_W = (VW - MARGIN * 2) / LANES;
const HIT_LINE_Y = 1090;
const SPAWN_Y = -130;
const APPROACH = 1.3; // s: czas przelotu nuty od góry do linii
const NOTE_H = 32;
const HOLD_RELEASE_TOL = 0.12; // s: tolerancja puszczenia nuty trzymanej
const HOLD_BONUS = 180;

const LANE_COLORS = ["#ff9f43", "#ff6b3d", "#ffd24c", "#ff5e7e"];
const LANE_LABELS = ["D", "F", "J", "K"];

// --- strefy dotyku menu / kolekcji ---
const MENU_START: Rect = { x: VW / 2 - 200, y: 548, w: 400, h: 112 };
const MENU_SONGS: Rect = { x: VW / 2 - 200, y: 700, w: 400, h: 96 };
const MENU_MINUS: Rect = { x: VW / 2 - 194, y: 884, w: 88, h: 88 };
const MENU_PLUS: Rect = { x: VW / 2 + 106, y: 884, w: 88, h: 88 };
const SONGS_BACK: Rect = { x: 16, y: 36, w: 160, h: 62 };

const JUDGE_LABEL: Record<Judgement, string> = {
  perfect: "PERFECT",
  great: "SUPER",
  good: "OK",
  miss: "PUDŁO",
};
const JUDGE_COLOR: Record<Judgement, string> = {
  perfect: "#ffe27a",
  great: "#8affc1",
  good: "#8ab6ff",
  miss: "#ff6b7d",
};

interface Popup {
  txt: string;
  color: string;
  at: number;
  x: number;
}

interface Settings {
  offsetMs: number;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("denis.settings");
    if (raw) return { offsetMs: 0, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { offsetMs: 0 };
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem("denis.settings", JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function bestScore(): number {
  return Number(localStorage.getItem("denis.best") || 0);
}

export class Game {
  private scene: Scene = "loading";
  private audio = new AudioEngine();
  private settings = loadSettings();

  private bg = new Image();
  private bgReady = false;
  private coverCache = new Map<string, HTMLImageElement>();

  private trackId = DEFAULT_TRACK;
  private song: SongDef = buildSynthSong();
  private songTime = 0;
  private preparing = false;
  private loadError = "";

  private score = 0;
  private displayScore = 0;
  private combo = 0;
  private maxCombo = 0;
  private counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  private holdsDone = 0;
  private holdsBroken = 0;
  private accSum = 0;
  private judgedCount = 0;

  /** nuta trzymana aktualnie przytrzymywana w danym torze */
  private held: (Note | null)[] = [null, null, null, null];

  private popups: Popup[] = [];
  private laneFlash = [0, 0, 0, 0];
  private lanePress = [0, 0, 0, 0];
  private comboPopAt = -10;
  private denisPopAt = -10;
  private denisMissAt = -10;
  private resultsSavedBest = false;
  private newBest = false;

  constructor() {
    this.bg.onload = () => {
      this.bgReady = true;
      if (this.scene === "loading") this.scene = "menu";
    };
    this.bg.src = "assets/denis/denis-stage.png";
    // wczytaj beatmapę domyślnego utworu w tle (do wyświetlenia w menu)
    void this.preloadChart();
  }

  private async preloadChart() {
    try {
      const s = await loadTrack(this.trackId);
      if (this.scene !== "play") this.song = s;
    } catch (e) {
      this.loadError = String(e);
    }
  }

  // ---- pętla ----------------------------------------------------------

  update(_dt: number, _nowMs: number) {
    if (this.scene === "play") {
      this.songTime = this.audio.getSongTime();
      this.checkMisses();
      this.resolveHeldHolds();
      if (this.songTime > this.song.duration + 0.6 && this.allJudged()) {
        this.finish();
      }
    }
    this.displayScore = lerp(this.displayScore, this.score, 0.18);
    for (let i = 0; i < LANES; i++) this.lanePress[i] = lerp(this.lanePress[i], 0, 0.2);
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, VW, VH);
    switch (this.scene) {
      case "loading":
        this.drawLoading(ctx);
        break;
      case "menu":
        this.drawMenu(ctx);
        break;
      case "songs":
        this.drawSongs(ctx);
        break;
      case "play":
        this.drawPlay(ctx);
        break;
      case "results":
        this.drawResults(ctx);
        break;
    }

    if (this.preparing) {
      ctx.fillStyle = "rgba(4,4,10,0.72)";
      ctx.fillRect(0, 0, VW, VH);
      const d = Math.floor((performance.now() / 300) % 4);
      text(ctx, `Wczytywanie utworu${".".repeat(d)}`, VW / 2, VH / 2, {
        size: 34,
        color: "#ffce8a",
      });
    } else if (this.loadError && (this.scene === "menu" || this.scene === "songs")) {
      text(ctx, this.loadError, VW / 2, VH - 96, { size: 20, color: "#ff6b7d" });
    }
  }

  // ---- wejście -------------------------------------------------------

  /** Który tor odpowiada współrzędnej x (tylko podczas gry). */
  laneAtX(x: number): number {
    if (this.scene !== "play") return -1;
    return clamp(Math.floor((x - MARGIN) / LANE_W), 0, LANES - 1);
  }

  onPress(lane: number, x: number, y: number) {
    if (this.scene === "menu") return this.handleMenuTap(x, y);
    if (this.scene === "songs") return this.handleSongsTap(x, y);
    if (this.scene === "results") return this.handleResultsTap(x, y);
    if (this.scene === "play") {
      if (lane < 0 && x < 0) return; // np. spacja podczas gry
      if (lane < 0) lane = this.laneAtX(x);
      if (lane >= 0) this.pressLane(lane);
    }
  }

  onRelease(lane: number) {
    if (this.scene === "play" && lane >= 0) this.releaseLane(lane);
  }

  private handleMenuTap(x: number, y: number) {
    if (x < 0) return void this.startPlay(); // klawisz Enter/Spacja
    if (inRect(MENU_START, x, y)) return void this.startPlay();
    if (inRect(MENU_SONGS, x, y)) {
      this.scene = "songs";
      return;
    }
    if (inRect(MENU_MINUS, x, y)) {
      this.settings.offsetMs = clamp(this.settings.offsetMs - 5, -120, 120);
      saveSettings(this.settings);
      return;
    }
    if (inRect(MENU_PLUS, x, y)) {
      this.settings.offsetMs = clamp(this.settings.offsetMs + 5, -120, 120);
      saveSettings(this.settings);
      return;
    }
  }

  private handleSongsTap(x: number, y: number) {
    if (x < 0 || inRect(SONGS_BACK, x, y)) {
      this.scene = "menu";
      return;
    }
    const disc = discoveredIds();
    for (const { meta, spotify } of this.songsLayout()) {
      if (disc.has(meta.id) && meta.spotifyUrl && inRect(spotify, x, y)) {
        try {
          window.open?.(meta.spotifyUrl, "_blank", "noopener");
        } catch {
          /* ignore */
        }
        return;
      }
    }
  }

  private handleResultsTap(x: number, y: number) {
    const by = 1120;
    if (x < 0 || (y > by - 60 && y < by + 60)) {
      if (x < 0 || x < VW / 2) void this.startPlay();
      else this.scene = "menu";
    }
  }

  // ---- przejścia stanów --------------------------------------------

  private async startPlay() {
    if (this.preparing) return;
    this.preparing = true;
    this.loadError = "";
    try {
      await this.audio.unlock();
      const song = await loadTrack(this.trackId);
      if (song.audioUrl) await this.audio.loadTrack(song.audioUrl);
      this.song = song;
    } catch (e) {
      this.loadError = "Nie udało się wczytać utworu";
      console.error(e);
      this.preparing = false;
      return;
    }
    this.score = 0;
    this.displayScore = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.holdsDone = 0;
    this.holdsBroken = 0;
    this.accSum = 0;
    this.judgedCount = 0;
    this.held = [null, null, null, null];
    this.popups = [];
    this.resultsSavedBest = false;
    this.newBest = false;
    this.songTime = 0;
    this.scene = "play";
    markDiscovered(this.song.id);
    this.audio.start(this.song);
    this.preparing = false;
  }

  private finish() {
    this.audio.stop();
    if (!this.resultsSavedBest) {
      this.resultsSavedBest = true;
      if (this.score > bestScore()) {
        this.newBest = true;
        try {
          localStorage.setItem("denis.best", String(this.score));
        } catch {
          /* ignore */
        }
      }
    }
    this.scene = "results";
  }

  // ---- logika rytmiczna -------------------------------------------

  private offsetSec() {
    return this.settings.offsetMs / 1000;
  }

  private pressLane(lane: number) {
    this.lanePress[lane] = 1;
    const picked = pickNote(this.song.notes, lane, this.songTime, this.offsetSec());
    if (!picked) return;
    const { note, absDt } = picked;
    const j = classify(absDt) ?? "good";
    note.hit = true;
    note.headJ = j;
    note.judgedAt = this.songTime;
    if (note.dur > 0) {
      note.holding = true;
      this.held[lane] = note;
      this.apply(j, lane); // ocena głowy: punkty + combo
    } else {
      note.judged = true;
      this.apply(j, lane);
    }
  }

  private releaseLane(lane: number) {
    const note = this.held[lane];
    if (!note) return;
    this.held[lane] = null;
    note.holding = false;
    note.judged = true;
    note.judgedAt = this.songTime;
    const end = note.time + note.dur + this.offsetSec();
    this.completeHold(note, lane, this.songTime >= end - HOLD_RELEASE_TOL);
  }

  /** Nuty trzymane utrzymane do samego końca (gracz nie puścił palca). */
  private resolveHeldHolds() {
    for (let lane = 0; lane < LANES; lane++) {
      const note = this.held[lane];
      if (!note) continue;
      const end = note.time + note.dur + this.offsetSec();
      if (this.songTime >= end + HOLD_RELEASE_TOL) {
        this.held[lane] = null;
        note.holding = false;
        note.judged = true;
        note.judgedAt = this.songTime;
        this.completeHold(note, lane, true);
      }
    }
  }

  private completeHold(note: Note, lane: number, success: boolean) {
    void note;
    if (success) {
      this.holdsDone++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.comboPopAt = this.songTime;
      this.score += Math.round(HOLD_BONUS * comboMultiplier(this.combo));
      this.laneFlash[lane] = this.songTime;
      this.denisPopAt = this.songTime;
      this.pushPopup("TRZYMANE", "#8affc1", lane);
    } else {
      this.holdsBroken++;
      this.combo = 0;
      this.denisMissAt = this.songTime;
      this.pushPopup("ZERWANE", "#ff6b7d", lane);
    }
  }

  private checkMisses() {
    const off = this.offsetSec();
    for (const n of this.song.notes) {
      if (isMissed(n, this.songTime, off)) {
        n.judged = true;
        n.hit = false;
        n.headJ = "miss";
        n.judgedAt = n.time + 0.145;
        this.apply("miss", n.lane);
      }
    }
  }

  private apply(j: Judgement, lane: number) {
    this.counts[j]++;
    this.judgedCount++;
    this.accSum += ACC_WEIGHT[j];

    if (j === "miss") {
      this.combo = 0;
      this.denisMissAt = this.songTime;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.comboPopAt = this.songTime;
      this.score += Math.round(SCORE[j] * comboMultiplier(this.combo));
      this.laneFlash[lane] = this.songTime;
      if (j !== "good") this.denisPopAt = this.songTime;
    }
    this.pushPopup(JUDGE_LABEL[j], JUDGE_COLOR[j], lane);
  }

  private pushPopup(txt: string, color: string, lane: number) {
    this.popups.push({ txt, color, at: this.songTime, x: MARGIN + lane * LANE_W + LANE_W / 2 });
    if (this.popups.length > 12) this.popups.shift();
  }

  private allJudged() {
    return this.song.notes.every((n) => n.judged);
  }

  private accuracy() {
    return this.judgedCount ? this.accSum / this.judgedCount : 1;
  }

  private yFor(t: number): number {
    const prog = (this.songTime - (t - APPROACH)) / APPROACH;
    return SPAWN_Y + prog * (HIT_LINE_Y - SPAWN_Y);
  }

  // ---- rysowanie: wspólne tło ------------------------------------

  private drawStage(ctx: CanvasRenderingContext2D, darken: number, pulse: number) {
    if (this.bgReady) {
      const iw = this.bg.width;
      const ih = this.bg.height;
      const scale = Math.max(VW / iw, VH / ih) * (1 + pulse * 0.015);
      const w = iw * scale;
      const h = ih * scale;
      ctx.drawImage(this.bg, (VW - w) / 2, (VH - h) / 2 - 20, w, h);
    } else {
      ctx.fillStyle = "#101018";
      ctx.fillRect(0, 0, VW, VH);
    }
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, `rgba(5,5,12,${0.35 + darken * 0.4})`);
    g.addColorStop(0.55, `rgba(5,5,12,${0.15 + darken * 0.35})`);
    g.addColorStop(1, `rgba(5,5,12,${0.75 + darken * 0.2})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const lights: [number, number][] = [
      [VW * 0.12, VH * 0.24],
      [VW * 0.88, VH * 0.24],
    ];
    for (const [lx, ly] of lights) {
      const r = 120 + pulse * 60;
      const rg = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      rg.addColorStop(0, `rgba(255,180,90,${0.32 + pulse * 0.28})`);
      rg.addColorStop(1, "rgba(255,180,90,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private beatPulse() {
    if (this.scene !== "play") {
      const t = performance.now() / 1000;
      const frac = (t % 0.6) / 0.6;
      return Math.pow(1 - frac, 2) * 0.6;
    }
    const beat = 60 / this.song.bpm;
    const st = Math.max(this.songTime, 0);
    const frac = (st % beat) / beat;
    return Math.pow(1 - frac, 2);
  }

  // ---- ekran: ładowanie -----------------------------------------

  private drawLoading(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#07070d";
    ctx.fillRect(0, 0, VW, VH);
    text(ctx, "wczytywanie…", VW / 2, VH / 2, { size: 34, color: "#ffce8a" });
  }

  // ---- ekran: menu --------------------------------------------

  private drawMenu(ctx: CanvasRenderingContext2D) {
    const pulse = this.beatPulse();
    this.drawStage(ctx, 0.22, pulse);

    // --- powitanie ---
    text(ctx, "DENIS", VW / 2, 156, {
      size: 112,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 34,
      letterSpacing: "6px",
    });
    text(ctx, "IMPULSYWNI", VW / 2, 238, {
      size: 36,
      weight: "700",
      color: "#ffce8a",
      letterSpacing: "16px",
    });
    // plakietka LIVE
    const lw = 150;
    ctx.save();
    ctx.strokeStyle = "rgba(255,180,90,0.7)";
    ctx.lineWidth = 2;
    roundRect(ctx, VW / 2 - lw / 2, 276, lw, 46, 23);
    ctx.stroke();
    const dot = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    ctx.fillStyle = `rgba(255,94,110,${0.5 + dot * 0.5})`;
    ctx.beginPath();
    ctx.arc(VW / 2 - 34, 299, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    text(ctx, "LIVE", VW / 2 + 8, 300, { size: 22, weight: "800", color: "#fff7ec", letterSpacing: "4px" });

    text(ctx, "gra rytmiczna", VW / 2, 372, { size: 20, color: "#8a7c6e", letterSpacing: "8px" });

    // --- STARTUJEMY! ---
    const bs = 1 + pulse * 0.035;
    ctx.save();
    ctx.translate(VW / 2, MENU_START.y + MENU_START.h / 2);
    ctx.scale(bs, bs);
    const grad = ctx.createLinearGradient(-MENU_START.w / 2, 0, MENU_START.w / 2, 0);
    grad.addColorStop(0, "#ff9f43");
    grad.addColorStop(1, "#ff5e7e");
    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(255,120,90,0.6)";
    ctx.shadowBlur = 34;
    roundRect(ctx, -MENU_START.w / 2, -MENU_START.h / 2, MENU_START.w, MENU_START.h, MENU_START.h / 2);
    ctx.fill();
    ctx.restore();
    text(ctx, "STARTUJEMY!", VW / 2, MENU_START.y + MENU_START.h / 2, {
      size: 42,
      weight: "800",
      color: "#1a0d12",
    });

    // --- Poznane Utwory ---
    ctx.strokeStyle = "rgba(255,180,90,0.55)";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(18,14,24,0.55)";
    roundRect(ctx, MENU_SONGS.x, MENU_SONGS.y, MENU_SONGS.w, MENU_SONGS.h, MENU_SONGS.h / 2);
    ctx.fill();
    ctx.stroke();
    text(ctx, "Poznane Utwory", VW / 2, MENU_SONGS.y + MENU_SONGS.h / 2 - 6, {
      size: 32,
      weight: "700",
      color: "#ffce8a",
    });
    const disc = this.discoveredCount();
    text(ctx, `odkryte: ${disc} / ${SONGS.length}`, VW / 2, MENU_SONGS.y + MENU_SONGS.h / 2 + 24, {
      size: 16,
      color: "#8a7c6e",
    });

    // --- kalibracja ---
    text(
      ctx,
      `Kalibracja dźwięku: ${this.settings.offsetMs > 0 ? "+" : ""}${this.settings.offsetMs} ms`,
      VW / 2,
      MENU_MINUS.y - 26,
      { size: 19, color: "#b9a999" },
    );
    this.pill(ctx, MENU_MINUS.x + 44, MENU_MINUS.y + 44, "−");
    this.pill(ctx, MENU_PLUS.x + 44, MENU_PLUS.y + 44, "+");

    text(ctx, `Najlepszy wynik: ${bestScore().toLocaleString("pl-PL")}`, VW / 2, 1050, {
      size: 20,
      color: "#ffce8a",
    });
    text(ctx, "Stukaj w tor przy linii. Długie nuty przytrzymaj, czasem dwie naraz.", VW / 2, 1128, {
      size: 18,
      color: "#9a8c7e",
    });
    text(ctx, "klawisze: D F J K  ·  prototyp, podkład tymczasowy", VW / 2, 1170, {
      size: 16,
      color: "#6b6055",
    });
  }

  private discoveredCount(): number {
    const d = discoveredIds();
    return SONGS.filter((s) => d.has(s.id)).length;
  }

  private pill(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, x - 44, y - 44, 88, 88, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,180,90,0.4)";
    ctx.lineWidth = 2;
    roundRect(ctx, x - 44, y - 44, 88, 88, 20);
    ctx.stroke();
    text(ctx, label, x, y, { size: 44, color: "#ffce8a" });
  }

  // ---- ekran: poznane utwory --------------------------------

  private songsLayout(): { meta: SongMeta; card: Rect; cover: Rect; spotify: Rect }[] {
    const cols = 2;
    const gutter = 32;
    const cardW = (VW - MARGIN * 2 - gutter) / cols;
    const cardH = 372;
    const top = 196;
    const rowGap = 28;
    return SONGS.map((meta, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN + col * (cardW + gutter);
      const y = top + row * (cardH + rowGap);
      const coverSize = cardW - 90;
      const cover: Rect = { x: x + (cardW - coverSize) / 2, y: y + 18, w: coverSize, h: coverSize };
      const spotify: Rect = { x: x + 24, y: y + cardH - 60, w: cardW - 48, h: 44 };
      return { meta, card: { x, y, w: cardW, h: cardH }, cover, spotify };
    });
  }

  private coverImg(meta: SongMeta): HTMLImageElement | null {
    if (!meta.cover) return null;
    let img = this.coverCache.get(meta.id);
    if (!img) {
      img = new Image();
      img.src = meta.cover;
      this.coverCache.set(meta.id, img);
    }
    return img;
  }

  private drawCover(ctx: CanvasRenderingContext2D, r: Rect, meta: SongMeta, discovered: boolean) {
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    ctx.clip();
    if (!discovered) {
      ctx.fillStyle = "#15121c";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      text(ctx, "?", r.x + r.w / 2, r.y + r.h / 2, {
        size: r.h * 0.4,
        weight: "800",
        color: "rgba(255,255,255,0.16)",
      });
    } else {
      const img = this.coverImg(meta);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
      } else {
        const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
        g.addColorStop(0, shade(meta.accent, 24));
        g.addColorStop(1, shade(meta.accent, -74));
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        text(ctx, (meta.title[0] || "?").toUpperCase(), r.x + r.w / 2, r.y + r.h / 2, {
          size: r.h * 0.46,
          weight: "800",
          color: "rgba(255,255,255,0.88)",
        });
      }
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    ctx.stroke();
  }

  private drawSongs(ctx: CanvasRenderingContext2D) {
    this.drawStage(ctx, 0.55, this.beatPulse() * 0.3);

    text(ctx, "‹ WRÓĆ", SONGS_BACK.x + 14, SONGS_BACK.y + 34, {
      size: 24,
      align: "left",
      color: "#ffce8a",
      weight: "700",
    });
    text(ctx, "POZNANE UTWORY", VW / 2, 110, {
      size: 40,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 18,
      letterSpacing: "2px",
    });
    text(ctx, `odkryte: ${this.discoveredCount()} / ${SONGS.length}`, VW / 2, 154, {
      size: 20,
      color: "#c9b7a6",
    });

    const disc = discoveredIds();
    for (const { meta, card, cover, spotify } of this.songsLayout()) {
      const d = disc.has(meta.id);

      ctx.fillStyle = "rgba(18,14,24,0.74)";
      roundRect(ctx, card.x, card.y, card.w, card.h, 20);
      ctx.fill();
      ctx.strokeStyle = d ? "rgba(255,180,90,0.35)" : "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      roundRect(ctx, card.x, card.y, card.w, card.h, 20);
      ctx.stroke();

      this.drawCover(ctx, cover, meta, d);

      const cx = card.x + card.w / 2;
      if (d) {
        text(ctx, meta.title, cx, cover.y + cover.h + 36, {
          size: 25,
          weight: "700",
          color: "#fff",
        });
        text(ctx, meta.artist, cx, cover.y + cover.h + 66, { size: 18, color: "#b9a999" });
        if (meta.spotifyUrl) {
          ctx.fillStyle = "#1DB954";
          roundRect(ctx, spotify.x, spotify.y, spotify.w, spotify.h, spotify.h / 2);
          ctx.fill();
          text(ctx, "▶  SPOTIFY", spotify.x + spotify.w / 2, spotify.y + spotify.h / 2, {
            size: 19,
            weight: "800",
            color: "#04220f",
          });
        } else {
          text(ctx, "link wkrótce", cx, spotify.y + spotify.h / 2, { size: 17, color: "#6b6055" });
        }
      } else {
        text(ctx, "? ? ?", cx, cover.y + cover.h + 42, {
          size: 25,
          weight: "700",
          color: "rgba(255,255,255,0.4)",
        });
        text(ctx, "zagraj, aby odkryć", cx, spotify.y + spotify.h / 2, {
          size: 17,
          color: "#6b6055",
        });
      }
    }

    text(ctx, "prototyp · okładki tymczasowe", VW / 2, VH - 54, { size: 16, color: "#6b6055" });
  }

  // ---- ekran: gra --------------------------------------------

  private drawPlay(ctx: CanvasRenderingContext2D) {
    const pulse = this.beatPulse();
    const missGlow = clamp(1 - (this.songTime - this.denisMissAt) / 0.3, 0, 1);
    this.drawStage(
      ctx,
      0.28 + missGlow * 0.15,
      pulse + (this.songTime - this.denisPopAt < 0.15 ? 0.5 : 0),
    );

    const fld = ctx.createLinearGradient(0, HIT_LINE_Y - 620, 0, VH);
    fld.addColorStop(0, "rgba(6,4,12,0)");
    fld.addColorStop(0.35, "rgba(6,4,12,0.55)");
    fld.addColorStop(1, "rgba(6,4,12,0.8)");
    ctx.fillStyle = fld;
    ctx.fillRect(0, HIT_LINE_Y - 620, VW, VH - (HIT_LINE_Y - 620));

    for (let i = 0; i < LANES; i++) {
      const x = MARGIN + i * LANE_W;
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)";
      ctx.fillRect(x, 0, LANE_W, VH);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, VH);
      ctx.stroke();
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,220,170,0.85)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(255,200,120,0.9)";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(MARGIN, HIT_LINE_Y);
    ctx.lineTo(VW - MARGIN, HIT_LINE_Y);
    ctx.stroke();
    ctx.restore();

    // ogony nut trzymanych (rysowane pod głowami)
    for (const n of this.song.notes) {
      if (n.dur <= 0) continue;
      const tailEndT = n.time + n.dur;
      if (n.time - this.songTime > APPROACH) continue;
      if (!n.holding && this.songTime > tailEndT + 0.35) continue;
      if (n.judged && !n.holding && this.songTime - n.judgedAt > 0.22) continue;

      const cx = MARGIN + n.lane * LANE_W + LANE_W / 2;
      const tw = (LANE_W - 26) * 0.6;
      const botY = n.holding ? HIT_LINE_Y : Math.min(this.yFor(n.time), HIT_LINE_Y);
      const topY = Math.max(this.yFor(tailEndT), -40);
      const tailAlpha =
        n.judged && !n.holding ? clamp(1 - (this.songTime - n.judgedAt) / 0.22, 0, 1) : 1;

      ctx.save();
      ctx.globalAlpha = tailAlpha * (n.holding ? 0.55 : 0.32);
      ctx.fillStyle = LANE_COLORS[n.lane];
      if (n.holding) {
        ctx.shadowColor = LANE_COLORS[n.lane];
        ctx.shadowBlur = 22;
      }
      roundRect(ctx, cx - tw / 2, topY, tw, Math.max(botY - topY, 0), 12);
      ctx.fill();
      ctx.restore();
    }

    // receptory
    for (let i = 0; i < LANES; i++) {
      const cx = MARGIN + i * LANE_W + LANE_W / 2;
      const flash = clamp(1 - (this.songTime - this.laneFlash[i]) / 0.18, 0, 1);
      const press = this.lanePress[i];
      const holding = !!this.held[i];
      const rad = 46 + flash * 14 + press * 6 + (holding ? 8 : 0);
      ctx.save();
      ctx.globalAlpha = 0.35 + flash * 0.5 + press * 0.2 + (holding ? 0.3 : 0);
      ctx.strokeStyle = LANE_COLORS[i];
      ctx.lineWidth = holding ? 6 : 4;
      ctx.shadowColor = LANE_COLORS[i];
      ctx.shadowBlur = 12 + flash * 26 + (holding ? 20 : 0);
      ctx.beginPath();
      ctx.arc(cx, HIT_LINE_Y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (flash > 0.01) {
        ctx.save();
        ctx.globalAlpha = flash * 0.4;
        ctx.fillStyle = LANE_COLORS[i];
        ctx.beginPath();
        ctx.arc(cx, HIT_LINE_Y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      text(ctx, LANE_LABELS[i], cx, HIT_LINE_Y + 96, {
        size: 22,
        color: "rgba(255,255,255,0.35)",
      });
    }

    // głowy nut
    for (const n of this.song.notes) {
      const headRel = n.time - this.songTime;
      if (headRel > APPROACH) continue;

      let y = n.holding ? HIT_LINE_Y : this.yFor(n.time);
      let alpha = 1;
      if (n.judged) {
        const jt = this.songTime - n.judgedAt;
        if (jt > 0.28) continue;
        if (n.hit) {
          alpha = 1 - jt / 0.28;
          y = n.holding ? HIT_LINE_Y : this.yFor(n.time);
        } else {
          alpha = 0.5 - jt;
          y = this.yFor(n.time) + jt * 240;
        }
      } else if (headRel < -0.4 && !n.holding) {
        continue;
      }

      const cx = MARGIN + n.lane * LANE_W + LANE_W / 2;
      const w = LANE_W - 26;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      const grd = ctx.createLinearGradient(0, y - NOTE_H / 2, 0, y + NOTE_H / 2);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(0.5, LANE_COLORS[n.lane]);
      grd.addColorStop(1, n.judged && !n.hit ? "#7a2a34" : LANE_COLORS[n.lane]);
      ctx.fillStyle = grd;
      ctx.shadowColor = LANE_COLORS[n.lane];
      ctx.shadowBlur = n.dur > 0 ? 22 : 16;
      roundRect(ctx, cx - w / 2, y - NOTE_H / 2, w, NOTE_H, 10);
      ctx.fill();
      ctx.restore();
    }

    for (const p of this.popups) {
      const life = (this.songTime - p.at) / 0.5;
      if (life >= 1 || life < 0) continue;
      ctx.save();
      ctx.globalAlpha = 1 - life;
      text(ctx, p.txt, p.x, HIT_LINE_Y - 150 - life * 46, {
        size: 30,
        weight: "800",
        color: p.color,
        glow: p.color,
        glowBlur: 14,
      });
      ctx.restore();
    }

    this.drawHud(ctx);

    const firstNote = this.song.notes[0]?.time ?? 3;
    if (this.songTime < firstNote - 0.15) {
      const n = Math.ceil(firstNote - 0.15 - this.songTime);
      if (n <= 3 && n >= 1) {
        const f = 1 - (firstNote - 0.15 - this.songTime - (n - 1));
        ctx.save();
        ctx.globalAlpha = clamp(1 - f * 0.4, 0.2, 1);
        text(ctx, String(n), VW / 2, VH / 2 - 40, {
          size: 160 + f * 40,
          weight: "800",
          color: "#fff7ec",
          glow: "#ffb457",
          glowBlur: 40,
        });
        ctx.restore();
      } else {
        text(ctx, "GOTÓW?", VW / 2, VH / 2 - 40, {
          size: 60,
          weight: "800",
          color: "#fff7ec",
          glow: "#ffb457",
        });
      }
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    const p = clamp(this.songTime / this.song.duration, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, 0, VW, 6);
    const pg = ctx.createLinearGradient(0, 0, VW, 0);
    pg.addColorStop(0, "#ff9f43");
    pg.addColorStop(1, "#ff5e7e");
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, VW * p, 6);

    text(ctx, Math.round(this.displayScore).toLocaleString("pl-PL"), VW - MARGIN, 54, {
      size: 44,
      weight: "800",
      align: "right",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 10,
    });
    text(ctx, `${(this.accuracy() * 100).toFixed(1)}%`, MARGIN, 54, {
      size: 28,
      align: "left",
      color: "#c9b7a6",
    });

    if (this.combo >= 2) {
      const pop = clamp(1 - (this.songTime - this.comboPopAt) / 0.18, 0, 1);
      const s = 1 + pop * 0.25;
      ctx.save();
      ctx.translate(VW / 2, 300);
      ctx.scale(s, s);
      text(ctx, String(this.combo), 0, 0, {
        size: 92,
        weight: "800",
        color: "#fff7ec",
        glow: "#ffd24c",
        glowBlur: 24,
      });
      text(ctx, "COMBO", 0, 66, { size: 22, color: "#ffce8a", letterSpacing: "6px" });
      ctx.restore();
    }
  }

  // ---- ekran: wynik -----------------------------------------

  private drawResults(ctx: CanvasRenderingContext2D) {
    this.drawStage(ctx, 0.55, this.beatPulse() * 0.4);

    const acc = this.accuracy();
    const fc = this.counts.miss === 0 && this.holdsBroken === 0 && this.judgedCount > 0;
    const grade =
      acc >= 0.95 ? "S" : acc >= 0.9 ? "A" : acc >= 0.8 ? "B" : acc >= 0.65 ? "C" : "D";
    const gradeColor =
      grade === "S" ? "#ffe27a" : grade === "A" ? "#8affc1" : grade === "B" ? "#8ab6ff" : "#ff9f43";

    text(ctx, "WYNIK", VW / 2, 120, { size: 30, color: "#ffce8a", letterSpacing: "12px" });
    text(ctx, grade, VW / 2, 292, {
      size: 190,
      weight: "800",
      color: gradeColor,
      glow: gradeColor,
      glowBlur: 40,
    });
    if (fc)
      text(ctx, "PEŁNE COMBO", VW / 2, 410, { size: 26, color: "#8affc1", letterSpacing: "6px" });
    if (this.newBest)
      text(ctx, "★ NOWY REKORD ★", VW / 2, 446, { size: 24, color: "#ffe27a", letterSpacing: "4px" });

    text(ctx, this.score.toLocaleString("pl-PL"), VW / 2, 530, {
      size: 72,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 16,
    });
    text(ctx, `celność ${(acc * 100).toFixed(2)}%   ·   max combo ${this.maxCombo}`, VW / 2, 588, {
      size: 24,
      color: "#c9b7a6",
    });

    const rows: [string, number, string][] = [
      ["PERFECT", this.counts.perfect, "#ffe27a"],
      ["SUPER", this.counts.great, "#8affc1"],
      ["OK", this.counts.good, "#8ab6ff"],
      ["PUDŁO", this.counts.miss, "#ff6b7d"],
      ["TRZYMANE", this.holdsDone, "#8affc1"],
      ["ZERWANE", this.holdsBroken, "#ff6b7d"],
    ];
    rows.forEach((r, i) => {
      const y = 662 + i * 56;
      text(ctx, r[0], VW / 2 - 60, y, { size: 26, align: "right", color: r[2] });
      text(ctx, String(r[1]), VW / 2 + 60, y, { size: 26, align: "left", color: "#fff" });
    });

    const by = 1120;
    const bw = VW / 2 - MARGIN - 12;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, MARGIN, by - 55, bw, 110, 22);
    ctx.fill();
    roundRect(ctx, VW / 2 + 12, by - 55, bw, 110, 22);
    ctx.fill();
    text(ctx, "JESZCZE RAZ", MARGIN + bw / 2, by, { size: 24, color: "#ffce8a" });
    text(ctx, "MENU", VW / 2 + 12 + bw / 2, by, { size: 24, color: "#c9b7a6" });
  }
}
