// Rdzeń gry: maszyna stanów (menu → odliczanie → gra → wynik) oraz cała
// logika rytmiczna i rysowanie.

import { AudioEngine } from "./audio.ts";
import { LANES, loadSong, type SongDef } from "./chart.ts";
import type { TapEvent } from "./input.ts";
import {
  ACC_WEIGHT,
  classify,
  comboMultiplier,
  isMissed,
  type Judgement,
  pickNote,
  SCORE,
} from "./judge.ts";
import { VH, VW } from "./viewport.ts";
import { clamp, lerp, roundRect, text } from "./ui.ts";

type Scene = "loading" | "menu" | "play" | "results";

// --- układ pola gry ---
const MARGIN = 40;
const LANE_W = (VW - MARGIN * 2) / LANES;
const HIT_LINE_Y = 1090;
const SPAWN_Y = -130;
const APPROACH = 1.3; // s: czas przelotu nuty od góry do linii
const NOTE_H = 32;

const LANE_COLORS = ["#ff9f43", "#ff6b3d", "#ffd24c", "#ff5e7e"];
const LANE_LABELS = ["D", "F", "J", "K"];

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

  private song: SongDef = loadSong();
  private songTime = 0;

  private score = 0;
  private displayScore = 0;
  private combo = 0;
  private maxCombo = 0;
  private counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  private accSum = 0;
  private judgedCount = 0;

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
  }

  // ---- pętla ----------------------------------------------------------

  update(_dt: number, nowMs: number) {
    if (this.scene === "play") {
      this.songTime = this.audio.getSongTime();
      this.checkMisses();
      if (this.songTime > this.song.duration + 0.6 && this.allJudged()) {
        this.finish();
      }
    }
    this.displayScore = lerp(this.displayScore, this.score, 0.18);
    // sprężynowanie wciśniętych torów
    for (let i = 0; i < LANES; i++) this.lanePress[i] = lerp(this.lanePress[i], 0, 0.2);
    void nowMs;
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
      case "play":
        this.drawPlay(ctx);
        break;
      case "results":
        this.drawResults(ctx);
        break;
    }
  }

  // ---- wejście -------------------------------------------------------

  onTap(e: TapEvent) {
    if (this.scene === "menu") {
      this.handleMenuTap(e);
    } else if (this.scene === "play") {
      let lane = e.lane;
      if (lane < 0 && e.x >= 0) lane = clamp(Math.floor((e.x - MARGIN) / LANE_W), 0, LANES - 1);
      if (lane >= 0) {
        this.lanePress[lane] = 1;
        this.judge(lane);
      }
    } else if (this.scene === "results") {
      this.handleResultsTap(e);
    }
  }

  private handleMenuTap(e: TapEvent) {
    // strefy kalibracji
    if (e.x >= 0) {
      const y = 1024;
      if (e.y > y - 55 && e.y < y + 55) {
        if (e.x > VW / 2 - 210 && e.x < VW / 2 - 90) {
          this.settings.offsetMs = clamp(this.settings.offsetMs - 5, -120, 120);
          saveSettings(this.settings);
          return;
        }
        if (e.x > VW / 2 + 90 && e.x < VW / 2 + 210) {
          this.settings.offsetMs = clamp(this.settings.offsetMs + 5, -120, 120);
          saveSettings(this.settings);
          return;
        }
      }
    }
    void this.startPlay();
  }

  private handleResultsTap(e: TapEvent) {
    // dwa przyciski na dole
    const by = 1120;
    if (e.x < 0 || (e.y > by - 60 && e.y < by + 60)) {
      if (e.x < 0 || e.x < VW / 2) {
        void this.startPlay(); // jeszcze raz
      } else {
        this.scene = "menu";
      }
    }
  }

  // ---- przejścia stanów --------------------------------------------

  private async startPlay() {
    await this.audio.unlock();
    this.song = loadSong();
    this.score = 0;
    this.displayScore = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.accSum = 0;
    this.judgedCount = 0;
    this.popups = [];
    this.resultsSavedBest = false;
    this.newBest = false;
    this.songTime = 0;
    this.scene = "play";
    this.audio.start(this.song);
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

  private judge(lane: number) {
    const t = this.songTime;
    const picked = pickNote(this.song.notes, lane, t, this.offsetSec());
    if (!picked) return;
    const { note, absDt } = picked;
    note.judged = true;
    note.hit = true;
    (note as any).judgedAt = t;
    this.apply(classify(absDt) ?? "good", lane);
  }

  private checkMisses() {
    const off = this.offsetSec();
    for (const n of this.song.notes) {
      if (isMissed(n, this.songTime, off)) {
        n.judged = true;
        n.hit = false;
        (n as any).judgedAt = n.time + 0.145;
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

    const labels: Record<Judgement, string> = {
      perfect: "PERFECT",
      great: "SUPER",
      good: "OK",
      miss: "PUDŁO",
    };
    const colors: Record<Judgement, string> = {
      perfect: "#ffe27a",
      great: "#8affc1",
      good: "#8ab6ff",
      miss: "#ff6b7d",
    };
    this.popups.push({
      txt: labels[j],
      color: colors[j],
      at: this.songTime,
      x: MARGIN + lane * LANE_W + LANE_W / 2,
    });
    if (this.popups.length > 12) this.popups.shift();
  }

  private allJudged() {
    return this.song.notes.every((n) => n.judged);
  }

  private accuracy() {
    return this.judgedCount ? this.accSum / this.judgedCount : 1;
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

    // pulsujące światła sceniczne
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
    this.drawStage(ctx, 0.15, pulse);

    // tytuł
    text(ctx, "DENIS", VW / 2, 150, {
      size: 104,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 32,
      letterSpacing: "8px",
    });
    text(ctx, "GRA RYTMICZNA", VW / 2, 232, {
      size: 30,
      color: "#ffce8a",
      letterSpacing: "10px",
    });

    // karta utworu
    const cardY = 560;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 30;
    ctx.fillStyle = "rgba(18,14,24,0.72)";
    roundRect(ctx, MARGIN, cardY, VW - MARGIN * 2, 190, 24);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,180,90,0.35)";
    ctx.lineWidth = 2;
    roundRect(ctx, MARGIN, cardY, VW - MARGIN * 2, 190, 24);
    ctx.stroke();

    text(ctx, this.song.title, VW / 2, cardY + 58, { size: 40, color: "#fff" });
    text(ctx, `${this.song.artist} · ${this.song.bpm} BPM`, VW / 2, cardY + 104, {
      size: 24,
      color: "#c9b7a6",
    });
    text(ctx, `Najlepszy wynik: ${bestScore().toLocaleString("pl-PL")}`, VW / 2, cardY + 146, {
      size: 22,
      color: "#ffce8a",
    });

    // przycisk graj (pulsujący)
    const bs = 1 + pulse * 0.04;
    ctx.save();
    ctx.translate(VW / 2, 850);
    ctx.scale(bs, bs);
    const grad = ctx.createLinearGradient(-180, 0, 180, 0);
    grad.addColorStop(0, "#ff9f43");
    grad.addColorStop(1, "#ff5e7e");
    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(255,120,90,0.6)";
    ctx.shadowBlur = 30;
    roundRect(ctx, -180, -50, 360, 100, 50);
    ctx.fill();
    ctx.restore();
    text(ctx, "GRAJ", VW / 2, 850, { size: 44, weight: "800", color: "#1a0d12" });

    // kalibracja
    const cy = 1024;
    text(ctx, `Kalibracja dźwięku: ${this.settings.offsetMs > 0 ? "+" : ""}${this.settings.offsetMs} ms`, VW / 2, cy - 66, {
      size: 20,
      color: "#b9a999",
    });
    this.pill(ctx, VW / 2 - 150, cy, "−");
    this.pill(ctx, VW / 2 + 150, cy, "+");

    text(ctx, "Stukaj w tor, gdy nuta dojdzie do linii.  Klawisze: D F J K", VW / 2, 1150, {
      size: 20,
      color: "#9a8c7e",
    });
    text(ctx, "prototyp · podkład tymczasowy", VW / 2, 1210, {
      size: 17,
      color: "#6b6055",
    });
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

  // ---- ekran: gra --------------------------------------------

  private drawPlay(ctx: CanvasRenderingContext2D) {
    const pulse = this.beatPulse();
    const missGlow = clamp(1 - (this.songTime - this.denisMissAt) / 0.3, 0, 1);
    this.drawStage(ctx, 0.28 + missGlow * 0.15, pulse + (this.songTime - this.denisPopAt < 0.15 ? 0.5 : 0));

    // ciemniejszy pas pod pole gry
    const fld = ctx.createLinearGradient(0, HIT_LINE_Y - 620, 0, VH);
    fld.addColorStop(0, "rgba(6,4,12,0)");
    fld.addColorStop(0.35, "rgba(6,4,12,0.55)");
    fld.addColorStop(1, "rgba(6,4,12,0.8)");
    ctx.fillStyle = fld;
    ctx.fillRect(0, HIT_LINE_Y - 620, VW, VH - (HIT_LINE_Y - 620));

    // tory
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

    // linia trafienia
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

    // receptory
    for (let i = 0; i < LANES; i++) {
      const cx = MARGIN + i * LANE_W + LANE_W / 2;
      const flash = clamp(1 - (this.songTime - this.laneFlash[i]) / 0.18, 0, 1);
      const press = this.lanePress[i];
      const rad = 46 + flash * 14 + press * 6;
      ctx.save();
      ctx.globalAlpha = 0.35 + flash * 0.5 + press * 0.2;
      ctx.strokeStyle = LANE_COLORS[i];
      ctx.lineWidth = 4;
      ctx.shadowColor = LANE_COLORS[i];
      ctx.shadowBlur = 12 + flash * 26;
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

    // nuty
    const off = this.offsetSec();
    for (const n of this.song.notes) {
      const rel = n.time - this.songTime;
      if (rel > APPROACH || rel < -0.4) continue;
      const prog = (this.songTime - (n.time - APPROACH)) / APPROACH;
      let y = SPAWN_Y + prog * (HIT_LINE_Y - SPAWN_Y);
      const cx = MARGIN + n.lane * LANE_W + LANE_W / 2;
      let alpha = 1;
      if (n.judged) {
        const jt = this.songTime - ((n as any).judgedAt ?? n.time);
        if (jt > 0.25) continue;
        if (n.hit) {
          alpha = 1 - jt / 0.25;
          y = HIT_LINE_Y - jt * 120;
        } else {
          alpha = 0.5 - jt;
          y += jt * 260;
        }
      }
      void off;
      const w = LANE_W - 26;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      const grd = ctx.createLinearGradient(0, y - NOTE_H / 2, 0, y + NOTE_H / 2);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(0.5, LANE_COLORS[n.lane]);
      grd.addColorStop(1, n.judged && !n.hit ? "#7a2a34" : LANE_COLORS[n.lane]);
      ctx.fillStyle = grd;
      ctx.shadowColor = LANE_COLORS[n.lane];
      ctx.shadowBlur = 16;
      roundRect(ctx, cx - w / 2, y - NOTE_H / 2, w, NOTE_H, 10);
      ctx.fill();
      ctx.restore();
    }

    // popupy oceny
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

    // odliczanie do pierwszej nuty
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
    // pasek postępu
    const p = clamp(this.songTime / this.song.duration, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, 0, VW, 6);
    const pg = ctx.createLinearGradient(0, 0, VW, 0);
    pg.addColorStop(0, "#ff9f43");
    pg.addColorStop(1, "#ff5e7e");
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, VW * p, 6);

    // wynik
    text(ctx, Math.round(this.displayScore).toLocaleString("pl-PL"), VW - MARGIN, 54, {
      size: 44,
      weight: "800",
      align: "right",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 10,
    });
    // celność
    text(ctx, `${(this.accuracy() * 100).toFixed(1)}%`, MARGIN, 54, {
      size: 28,
      align: "left",
      color: "#c9b7a6",
    });

    // combo
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
    const fc = this.counts.miss === 0 && this.judgedCount > 0;
    const grade =
      acc >= 0.95 ? "S" : acc >= 0.9 ? "A" : acc >= 0.8 ? "B" : acc >= 0.65 ? "C" : "D";
    const gradeColor =
      grade === "S" ? "#ffe27a" : grade === "A" ? "#8affc1" : grade === "B" ? "#8ab6ff" : "#ff9f43";

    text(ctx, "WYNIK", VW / 2, 120, { size: 30, color: "#ffce8a", letterSpacing: "12px" });

    text(ctx, grade, VW / 2, 300, {
      size: 200,
      weight: "800",
      color: gradeColor,
      glow: gradeColor,
      glowBlur: 40,
    });
    if (fc) text(ctx, "PEŁNE COMBO", VW / 2, 420, { size: 26, color: "#8affc1", letterSpacing: "6px" });
    if (this.newBest)
      text(ctx, "★ NOWY REKORD ★", VW / 2, 456, { size: 24, color: "#ffe27a", letterSpacing: "4px" });

    text(ctx, this.score.toLocaleString("pl-PL"), VW / 2, 540, {
      size: 72,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 16,
    });
    text(ctx, `celność ${(acc * 100).toFixed(2)}%   ·   max combo ${this.maxCombo}`, VW / 2, 600, {
      size: 24,
      color: "#c9b7a6",
    });

    // rozbicie
    const rows: [string, number, string][] = [
      ["PERFECT", this.counts.perfect, "#ffe27a"],
      ["SUPER", this.counts.great, "#8affc1"],
      ["OK", this.counts.good, "#8ab6ff"],
      ["PUDŁO", this.counts.miss, "#ff6b7d"],
    ];
    rows.forEach((r, i) => {
      const y = 700 + i * 62;
      text(ctx, r[0], VW / 2 - 60, y, { size: 28, align: "right", color: r[2] });
      text(ctx, String(r[1]), VW / 2 + 60, y, { size: 28, align: "left", color: "#fff" });
    });

    // przyciski
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
