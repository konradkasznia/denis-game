// Rdzeń gry: maszyna stanów (menu → odliczanie → gra → wynik) oraz cała
// logika rytmiczna i rysowanie.

import { AudioEngine } from "./audio.ts";
import { buildSynthSong, LANES, type Note, type SongDef } from "./chart.ts";
import { DEFAULT_TRACK, loadTrack } from "./tracks.ts";
import { ACC_WEIGHT, classify, isMissed, type Judgement, pickNote } from "./judge.ts";
import { fire as haptic, hapticsAvailable, setHapticsEnabled } from "./haptics.ts";
import {
  discoveredIds,
  markDiscovered,
  nextRound,
  SONGS,
  type SongMeta,
  spotifyUrl,
} from "./songs.ts";
import { VH, VW } from "./viewport.ts";
import { clamp, lerp, roundRect, shade, text, wrapText } from "./ui.ts";

type Scene = "loading" | "menu" | "songs" | "play" | "results";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const inRect = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// --- układ pola gry (perspektywa: tor zbiega do horyzontu) ---
const MARGIN = 40;
const HORIZON_Y = 330; // punkt zbiegu torów
const HIT_Y = 1118; // linia trafienia (puste kółka)
const PAD_BOT = VH - 16; // dół „klawiszy" dotykowych
const APPROACH = 2.15; // s: jak długo nuta jest widoczna zanim dojdzie do linii
const LANE_GAP_HIT = 150; // odstęp środków torów przy linii trafienia
const RECEPTOR_R = 52; // promień pustego kółka na linii
const HOLD_RELEASE_TOL = 0.12; // s: tolerancja puszczenia nuty trzymanej

const LANE_COLORS = ["#ff9f43", "#ff6b3d", "#ffd24c", "#ff5e7e"];

// --- punktacja ---
const BASE_SCORE: Record<Judgement, number> = { perfect: 300, great: 140, good: 55, miss: 0 };
const FLOW_PER_TIER = 10; // co ile perfektów rośnie mnożnik
const MAX_FLOW_TIER = 4; // mnożnik x1..x5
// ocena rundy = wynik / "par" (solidny przebieg). Gwiazdka i-ta zapala się,
// gdy ocena >= STAR_MARKS[i]. 3. gwiazdka = próg zaliczenia rundy.
const STAR_MARKS = [0.22, 0.44, 0.7, 0.86, 0.97];
const PASS_RATING = 0.7;

// --- strefy dotyku menu / kolekcji ---
const MENU_START: Rect = { x: VW / 2 - 200, y: 548, w: 400, h: 112 };
const MENU_SONGS: Rect = { x: VW / 2 - 200, y: 700, w: 400, h: 96 };
const MENU_MINUS: Rect = { x: VW / 2 - 194, y: 884, w: 88, h: 88 };
const MENU_PLUS: Rect = { x: VW / 2 + 106, y: 884, w: 88, h: 88 };
const MENU_VIBRO: Rect = { x: VW / 2 - 200, y: 990, w: 400, h: 60 };
const SONGS_BACK: Rect = { x: 16, y: 36, w: 160, h: 62 };
const PAUSE_RECT: Rect = { x: VW - 96, y: 24, w: 72, h: 64 };
const PZ_RESUME: Rect = { x: VW / 2 - 180, y: 556, w: 360, h: 100 };
const PZ_RESTART: Rect = { x: VW / 2 - 180, y: 676, w: 360, h: 82 };
const PZ_MENU: Rect = { x: VW / 2 - 180, y: 776, w: 360, h: 82 };
const RES_PRIMARY: Rect = { x: MARGIN, y: 1020, w: VW - MARGIN * 2, h: 82 };
const RES_SPOTIFY: Rect = { x: MARGIN, y: 1112, w: VW - MARGIN * 2, h: 68 };
const RES_AGAIN: Rect = { x: MARGIN, y: 1192, w: (VW - MARGIN * 2) / 2 - 8, h: 46 };
const RES_MENU: Rect = { x: VW / 2 + 8, y: 1192, w: (VW - MARGIN * 2) / 2 - 8, h: 46 };

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
  haptics: boolean;
  sfx: boolean;
}

function loadSettings(): Settings {
  const def: Settings = { offsetMs: 0, haptics: true, sfx: true };
  try {
    const raw = localStorage.getItem("denis.settings");
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return def;
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
  private songBg: HTMLImageElement | null = null; // tło bieżącego utworu
  private bgCache = new Map<string, HTMLImageElement>();
  private charImg: HTMLImageElement | null = null; // postać (PNG) bieżącego utworu

  private trackId = DEFAULT_TRACK;
  private song: SongDef = buildSynthSong();
  private songTime = 0;
  private preparing = false;
  private prepId = 0;
  private prepStep = "";
  private prepStart = 0;
  private loadError = "";
  /** utwór wczytany, czeka na świeży dotyk startu (kluczowe dla audio na iOS) */
  private awaitingStart = false;
  private paused = false;
  private resumeAt = 0; // performance.now() docelowego wznowienia (odliczanie 3-2-1)

  private score = 0;
  private displayScore = 0;
  private combo = 0;
  private maxCombo = 0;
  private flow = 0; // seria perfektów
  private maxFlow = 0;
  private flowTier = 0; // 0..MAX_FLOW_TIER -> mnożnik = tier + 1
  private health = 0.5;
  private parScore = 1; // wynik "solidnego przebiegu" — mianownik oceny
  private resultsAt = 0; // performance.now() wejścia na ekran wyniku
  private counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  private holdsDone = 0;
  private holdsBroken = 0;
  private accSum = 0;
  private judgedCount = 0;

  /** nuta trzymana aktualnie przytrzymywana w danym torze */
  private held: (Note | null)[] = [null, null, null, null];

  private popups: Popup[] = [];
  private hitFx: { lane: number; at: number; kind: Judgement }[] = [];
  private laneFlash = [0, 0, 0, 0];
  private lanePress = [0, 0, 0, 0];
  private comboPopAt = -10;
  private denisPopAt = -10;
  private denisMissAt = -10;
  private flowUpAt = -10;
  private bannerTxt = "";
  private bannerAt = -10;
  private shake = 0;
  private resultStarSeen = 0;
  private lastStarPopAt = 0;
  private resultsSavedBest = false;
  private newBest = false;

  constructor() {
    this.bg.onload = () => {
      this.bgReady = true;
      if (this.scene === "loading") this.scene = "menu";
    };
    this.bg.src = "assets/denis/denis-stage.png";
    setHapticsEnabled(this.settings.haptics);
    this.audio.setSfxEnabled(this.settings.sfx);
    // wczytaj beatmapę domyślnego utworu w tle (do wyświetlenia w menu)
    void this.preloadChart();
  }

  private async preloadChart() {
    try {
      const s = await loadTrack(this.trackId);
      if (this.scene !== "play") this.song = s;
      this.loadSongBg(s.bg);
      this.loadCharacter(s.character);
    } catch (e) {
      this.loadError = String(e);
    }
  }

  /** Wczytuje tło utworu (jeśli podane i istnieje); inaczej zostaje domyślne. */
  private loadSongBg(url?: string) {
    if (!url) {
      this.songBg = null;
      return;
    }
    const cached = this.bgCache.get(url);
    if (cached) {
      this.songBg = cached;
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.bgCache.set(url, img);
      this.songBg = img;
    };
    img.onerror = () => {
      this.songBg = null;
    };
    img.src = url;
  }

  private loadCharacter(url?: string) {
    if (!url) {
      this.charImg = null;
      return;
    }
    const cached = this.bgCache.get(url);
    if (cached) {
      this.charImg = cached;
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.bgCache.set(url, img);
      this.charImg = img;
    };
    img.onerror = () => {
      this.charImg = null;
    };
    img.src = url;
  }

  // ---- pętla ----------------------------------------------------------

  update(dt: number, _nowMs: number) {
    if (this.paused && this.resumeAt && performance.now() >= this.resumeAt) {
      this.paused = false;
      this.resumeAt = 0;
      void this.audio.resumePlayback();
    }
    if (this.scene === "play" && !this.awaitingStart && !this.paused) {
      this.songTime = this.audio.getSongTime();
      this.checkMisses();
      this.resolveHeldHolds();
      this.pulseHoldHaptics();
      if (this.songTime > this.song.duration + 0.6 && this.allJudged()) {
        this.finish();
      }
    }
    this.displayScore = lerp(this.displayScore, this.score, 0.18);
    for (let i = 0; i < LANES; i++) this.lanePress[i] = lerp(this.lanePress[i], 0, 0.2);
    this.shake *= Math.pow(0.0025, dt); // szybki zanik trzęsienia (~0.85/klatkę)
    if (this.shake < 0.15) this.shake = 0;
  }

  private lastHoldTick = 0;
  private pulseHoldHaptics() {
    if (!this.held.some((h) => h)) return;
    if (this.songTime - this.lastHoldTick > 0.12) {
      this.lastHoldTick = this.songTime;
      haptic("holdTick");
    }
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
      const secs = (performance.now() - this.prepStart) / 1000;
      // watchdog: nie zostawiaj gracza na zawsze na ekranie ładowania
      if (secs > 35) {
        this.loadError = `Wczytywanie utknęło na etapie: ${this.prepStep}. Sprawdź połączenie z serwerem i spróbuj ponownie.`;
        this.preparing = false;
        this.prepId++;
      } else {
        ctx.fillStyle = "rgba(4,4,10,0.78)";
        ctx.fillRect(0, 0, VW, VH);
        const d = Math.floor((performance.now() / 300) % 4);
        text(ctx, `Wczytywanie${".".repeat(d)}`, VW / 2, VH / 2 - 40, {
          size: 36,
          color: "#ffce8a",
        });
        text(ctx, `${this.prepStep} · ${secs.toFixed(0)} s`, VW / 2, VH / 2 + 18, {
          size: 20,
          color: "#9a8c7e",
        });
        text(ctx, "stuknij, aby przerwać", VW / 2, VH / 2 + 90, { size: 18, color: "#6b6055" });
      }
    } else if (this.loadError && (this.scene === "menu" || this.scene === "songs")) {
      const lines = wrapText(this.loadError, 46);
      lines.forEach((ln, i) =>
        text(ctx, ln, VW / 2, VH - 150 + i * 26, { size: 18, color: "#ff8a97" }),
      );
    }
  }

  // ---- wejście -------------------------------------------------------

  /** Który tor odpowiada współrzędnej x (tylko podczas gry). */
  laneAtX(x: number): number {
    if (this.scene !== "play") return -1;
    return clamp(Math.floor(x / (VW / LANES)), 0, LANES - 1);
  }

  onPress(lane: number, x: number, y: number) {
    if (this.preparing) return this.cancelPrepare();
    if (this.scene === "menu") return this.handleMenuTap(x, y);
    if (this.scene === "songs") return this.handleSongsTap(x, y);
    if (this.scene === "results") return this.handleResultsTap(x, y);
    if (this.scene === "play") {
      if (this.awaitingStart) return this.beginSong();
      if (this.paused) {
        if (this.resumeAt) return; // trwa odliczanie
        return this.handlePauseTap(x, y);
      }
      if (x >= 0 && inRect(PAUSE_RECT, x, y)) return this.pauseGame();
      if (lane < 0 && x < 0) return; // np. spacja podczas gry
      if (lane < 0) lane = this.laneAtX(x);
      if (lane >= 0) this.pressLane(lane);
    }
  }

  onRelease(lane: number) {
    if (this.scene === "play" && lane >= 0) this.releaseLane(lane);
  }

  private handleMenuTap(x: number, y: number) {
    if (x < 0) {
      this.trackId = DEFAULT_TRACK;
      return void this.startPlay(); // klawisz Enter/Spacja
    }
    if (inRect(MENU_START, x, y)) {
      this.trackId = DEFAULT_TRACK;
      return void this.startPlay();
    }
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
    if (inRect(MENU_VIBRO, x, y)) {
      this.settings.haptics = !this.settings.haptics;
      setHapticsEnabled(this.settings.haptics);
      saveSettings(this.settings);
      if (this.settings.haptics) haptic("perfect");
      return;
    }
  }

  private handleSongsTap(x: number, y: number) {
    if (x < 0 || inRect(SONGS_BACK, x, y)) {
      this.scene = "menu";
      return;
    }
    const disc = discoveredIds();
    for (const { meta, cover, spotify } of this.songsLayout()) {
      if (meta.playable && inRect(cover, x, y)) {
        this.trackId = meta.id;
        void this.startPlay();
        return;
      }
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
    // pierwsze stuknięcie w trakcie animacji licznika — pomiń animację
    if (performance.now() - this.resultsAt < 2200) {
      this.resultsAt = performance.now() - 2200;
      return;
    }
    const passed = this.rating() >= PASS_RATING;

    if (x < 0 || inRect(RES_PRIMARY, x, y)) {
      if (passed) {
        const nxt = nextRound(this.trackId);
        if (nxt) {
          this.trackId = nxt;
          void this.startPlay();
        } else {
          this.scene = "menu"; // ostatnia runda
        }
      } else {
        void this.startPlay(); // spróbuj ponownie tę samą
      }
      return;
    }
    if (inRect(RES_SPOTIFY, x, y)) {
      const url = spotifyUrl(this.trackId);
      if (url) {
        try {
          window.open?.(url, "_blank", "noopener");
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (inRect(RES_AGAIN, x, y)) {
      void this.startPlay();
      return;
    }
    if (inRect(RES_MENU, x, y)) this.scene = "menu";
  }

  // ---- przejścia stanów --------------------------------------------

  private async startPlay() {
    if (this.preparing) return;
    const myId = ++this.prepId;
    this.preparing = true;
    this.prepStep = "przygotowanie";
    this.prepStart = performance.now();
    this.loadError = "";

    const guard = () => myId === this.prepId && this.preparing;
    try {
      this.prepStep = "odblokowanie dźwięku";
      await this.audio.unlock();
      if (!guard()) return;

      this.prepStep = "wczytywanie beatmapy";
      const song = await loadTrack(this.trackId);
      if (!guard()) return;
      this.loadSongBg(song.bg);
      this.loadCharacter(song.character);

      if (song.audioUrl) {
        await this.audio.loadTrack(song.audioUrl, (s) => {
          if (guard()) this.prepStep = s;
        });
      }
      if (!guard()) return;
      this.song = song;
    } catch (e) {
      if (guard()) {
        this.loadError = `Nie udało się wczytać utworu (${(e as Error).message || e}). Sprawdź połączenie i spróbuj ponownie.`;
        this.preparing = false;
      }
      console.error(e);
      return;
    }

    this.score = 0;
    this.displayScore = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.flow = 0;
    this.maxFlow = 0;
    this.flowTier = 0;
    this.health = 0.5;
    this.parScore = this.computeParScore();
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.holdsDone = 0;
    this.holdsBroken = 0;
    this.accSum = 0;
    this.judgedCount = 0;
    this.held = [null, null, null, null];
    this.popups = [];
    this.hitFx = [];
    this.shake = 0;
    this.bannerAt = -10;
    this.flowUpAt = -10;
    this.lastHoldTick = 0;
    this.resultStarSeen = 0;
    this.paused = false;
    this.resumeAt = 0;
    this.resultsSavedBest = false;
    this.newBest = false;
    this.songTime = 0;
    this.scene = "play";
    this.awaitingStart = true; // start dopiero od świeżego dotyku (iOS audio)
    markDiscovered(this.song.id);
    this.preparing = false;
  }

  /** „Par" — punkty za solidny przebieg (same SUPER, mnożnik do x3). Ocena
   *  rundy = wynik / par, więc bardzo czysty przebieg przebija 100%. */
  private computeParScore(): number {
    let s = 0;
    let combo = 0;
    for (const n of this.song.notes) {
      combo++;
      const mult = Math.min(3, 1 + Math.floor(combo / 40));
      const kick = 1 + Math.min(combo, 120) * 0.004;
      s += Math.round(BASE_SCORE.great * mult * kick);
      if (n.dur > 0) s += Math.round(180 * mult * (1 + n.dur));
    }
    return Math.max(1, s);
  }

  /** Ocena rundy 0..~1.3 (gauge klamruje do 1). */
  private rating(): number {
    return this.score / this.parScore;
  }

  private pauseGame() {
    this.paused = true;
    this.resumeAt = 0;
    for (let l = 0; l < LANES; l++) {
      const h = this.held[l];
      if (h) {
        h.holding = false;
        h.judged = true;
        this.held[l] = null;
      }
    }
    this.audio.pause();
  }

  private handlePauseTap(x: number, y: number) {
    if (x < 0 || inRect(PZ_RESUME, x, y)) {
      this.resumeAt = performance.now() + 850; // krótkie 3-2-1
      return;
    }
    if (inRect(PZ_RESTART, x, y)) {
      this.paused = false;
      void this.startPlay();
      return;
    }
    if (inRect(PZ_MENU, x, y)) {
      this.audio.stop();
      this.paused = false;
      this.scene = "menu";
    }
  }

  /** Uruchamia utwór z bieżącego gestu użytkownika (odblokowuje audio na iOS). */
  private beginSong() {
    this.awaitingStart = false;
    this.songTime = 0;
    try {
      void this.audio.ctx?.resume?.();
    } catch {
      /* ignore */
    }
    this.audio.start(this.song);
  }

  /** Przerywa trwające wczytywanie i wraca do menu. */
  private cancelPrepare() {
    this.prepId++;
    this.preparing = false;
    this.loadError = "";
    this.scene = "menu";
  }

  private finish() {
    this.audio.stop();
    this.resultsAt = performance.now();
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

  private multiplier() {
    return this.flowTier + 1;
  }

  private completeHold(note: Note, lane: number, success: boolean) {
    if (success) {
      this.holdsDone++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.comboPopAt = this.songTime;
      this.health = clamp(this.health + 0.03, 0, 1);
      const bonus = Math.round(220 * this.multiplier() * (1 + note.dur));
      this.score += bonus;
      this.laneFlash[lane] = this.songTime;
      this.denisPopAt = this.songTime;
      this.hitFx.push({ lane, at: this.songTime, kind: "perfect" });
      this.shake = Math.max(this.shake, 5);
      this.audio.sfx("flow");
      haptic("hold");
      this.pushPopup("TRZYMANE!", "#8affc1", lane);
    } else {
      this.holdsBroken++;
      this.combo = 0;
      this.flow = 0;
      this.flowTier = 0;
      this.health = clamp(this.health - 0.05, 0, 1);
      this.denisMissAt = this.songTime;
      this.shake = Math.max(this.shake, 8);
      this.audio.sfx("miss");
      haptic("miss");
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
    const t = this.songTime;

    if (j === "miss") {
      this.combo = 0;
      this.flow = 0;
      if (this.flowTier > 0) this.flowTier = Math.max(0, this.flowTier - 1);
      this.health = clamp(this.health - 0.07, 0, 1);
      this.denisMissAt = t;
      this.shake = Math.max(this.shake, 9);
      this.audio.sfx("miss");
      haptic("miss");
      this.pushPopup(JUDGE_LABEL.miss, JUDGE_COLOR.miss, lane);
      return;
    }

    // trafienie
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboPopAt = t;
    this.laneFlash[lane] = t;
    this.hitFx.push({ lane, at: t, kind: j });
    if (this.hitFx.length > 20) this.hitFx.shift();

    if (j === "perfect") {
      this.flow++;
      this.maxFlow = Math.max(this.maxFlow, this.flow);
      this.health = clamp(this.health + 0.02, 0, 1);
      this.denisPopAt = t;
    } else if (j === "great") {
      this.health = clamp(this.health + 0.012, 0, 1);
    } else {
      this.flow = 0; // "OK" przerywa serię perfektów
      this.health = clamp(this.health + 0.004, 0, 1);
    }

    // mnożnik z serii perfektów
    const prevTier = this.flowTier;
    this.flowTier = Math.min(MAX_FLOW_TIER, Math.floor(this.flow / FLOW_PER_TIER));
    const mult = this.multiplier();

    const kick = 1 + Math.min(this.combo, 120) * 0.004; // do +48% przy combo 120
    this.score += Math.round(BASE_SCORE[j] * mult * kick);

    if (j === "perfect") {
      this.audio.sfx("perfect");
      haptic("perfect");
    } else {
      this.audio.sfx(j);
      haptic("tick");
    }

    // wejście na wyższy mnożnik — mocna wibracja całego telefonu
    if (this.flowTier > prevTier) {
      this.flowUpAt = t;
      this.shake = Math.max(this.shake, 12);
      this.audio.sfx("flow");
      haptic("flowUp");
      this.pushBanner(`MNOŻNIK ×${mult}`);
    }
    // próg combo co 10
    if (this.combo >= 10 && this.combo % 10 === 0) {
      this.shake = Math.max(this.shake, 6);
      this.audio.sfx("combo");
      haptic("combo");
      this.pushBanner(`COMBO ×${this.combo}`);
    }

    this.pushPopup(JUDGE_LABEL[j], JUDGE_COLOR[j], lane);
  }

  private pushBanner(txt: string) {
    this.bannerTxt = txt;
    this.bannerAt = this.songTime;
  }

  private pushPopup(txt: string, color: string, lane: number) {
    this.popups.push({ txt, color, at: this.songTime, x: this.hitX(lane) });
    if (this.popups.length > 12) this.popups.shift();
  }

  /** Ile gwiazdek (0..5, ułamkowo) dla danej oceny. */
  private starsFor(r: number): number {
    const m = [0, ...STAR_MARKS];
    for (let i = 1; i <= 5; i++) {
      if (r < m[i]) return i - 1 + (r - m[i - 1]) / (m[i] - m[i - 1]);
    }
    return 5;
  }

  private starFill(): number {
    return this.starsFor(clamp(this.rating(), 0, 1));
  }

  private allJudged() {
    return this.song.notes.every((n) => n.judged);
  }

  private accuracy() {
    return this.judgedCount ? this.accSum / this.judgedCount : 1;
  }

  // ---- projekcja perspektywiczna toru ---------------------------
  //
  // `e` (0..~1.4): 0 = horyzont (daleko), 1 = linia trafienia, >1 = strefa
  // klawiszy pod linią. Wszystko jest liniowe względem `e`, więc krawędzie
  // torów to proste; wrażenie 3D daje easing czasu w `eForTime`.

  private eForTime(t: number): number {
    const rel = (t - this.songTime) / APPROACH; // 1 = świeżo, 0 = na linii
    const travel = 1 - rel; // 0 daleko, 1 na linii
    if (travel <= 0) return travel * 0.6; // nuta zeszła poniżej linii
    if (travel >= 1) return 1 + (travel - 1) * 1.6;
    // łagodne przyspieszenie perspektywiczne (blisko liniowe u dołu)
    return Math.pow(travel, 1.32);
  }

  private yForE(e: number): number {
    return HORIZON_Y + e * (HIT_Y - HORIZON_Y);
  }

  /** środek toru `lane` na linii trafienia */
  private hitX(lane: number): number {
    return VW / 2 + (lane - (LANES - 1) / 2) * LANE_GAP_HIT;
  }

  private laneXAtE(lane: number, e: number): number {
    return lerp(VW / 2, this.hitX(lane), e);
  }

  /** promień nuty / szerokość na danym `e` (perspektywa) */
  private sizeAtE(e: number): number {
    return lerp(0.13, 1, clamp(e, 0, 1.2));
  }

  // ---- rysowanie: wspólne tło ------------------------------------

  private drawStage(ctx: CanvasRenderingContext2D, darken: number, pulse: number) {
    const img = this.songBg ?? (this.bgReady ? this.bg : null);
    if (img && img.width) {
      const iw = img.width;
      const ih = img.height;
      const scale = Math.max(VW / iw, VH / ih) * (1 + pulse * 0.015);
      const w = iw * scale;
      const h = ih * scale;
      ctx.drawImage(img, (VW - w) / 2, (VH - h) / 2 - 20, w, h);
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
      MENU_MINUS.y - 24,
      { size: 18, color: "#b9a999" },
    );
    this.pill(ctx, MENU_MINUS.x + 44, MENU_MINUS.y + 44, "−");
    this.pill(ctx, MENU_PLUS.x + 44, MENU_PLUS.y + 44, "+");

    // --- przełącznik wibracji ---
    const vibOk = hapticsAvailable();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, MENU_VIBRO.x, MENU_VIBRO.y, MENU_VIBRO.w, MENU_VIBRO.h, 14);
    ctx.fill();
    text(ctx, vibOk ? "Wibracje" : "Wibracje (brak na tym urządzeniu)", MENU_VIBRO.x + 20, MENU_VIBRO.y + MENU_VIBRO.h / 2, {
      size: 18,
      align: "left",
      color: vibOk ? "#c9b7a6" : "#6b6055",
    });
    const on = this.settings.haptics && vibOk;
    const tx = MENU_VIBRO.x + MENU_VIBRO.w - 76;
    const ty = MENU_VIBRO.y + MENU_VIBRO.h / 2;
    ctx.fillStyle = on ? "#ff9f43" : "rgba(255,255,255,0.14)";
    roundRect(ctx, tx, ty - 16, 56, 32, 16);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(on ? tx + 40 : tx + 16, ty, 12, 0, Math.PI * 2);
    ctx.fill();

    text(ctx, `Najlepszy wynik: ${bestScore().toLocaleString("pl-PL")}`, VW / 2, 1078, {
      size: 19,
      color: "#ffce8a",
    });
    text(ctx, "🔊 iPhone: wyłącz przełącznik ciszy, żeby słyszeć muzykę", VW / 2, 1124, {
      size: 17,
      weight: "700",
      color: "#ffb457",
    });
    text(ctx, "Trafiaj kółka na linii. Długie przytrzymaj — czasem dwie naraz.", VW / 2, 1158, {
      size: 15,
      color: "#8a7c6e",
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
      const revealed = d || meta.playable;
      const cx = card.x + card.w / 2;

      ctx.fillStyle = "rgba(18,14,24,0.74)";
      roundRect(ctx, card.x, card.y, card.w, card.h, 20);
      ctx.fill();
      ctx.strokeStyle = revealed ? "rgba(255,180,90,0.35)" : "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      roundRect(ctx, card.x, card.y, card.w, card.h, 20);
      ctx.stroke();

      this.drawCover(ctx, cover, meta, revealed);

      if (meta.playable) {
        // odznaka „graj" na okładce
        ctx.save();
        ctx.fillStyle = "rgba(10,8,14,0.66)";
        ctx.beginPath();
        ctx.arc(cover.x + cover.w - 30, cover.y + cover.h - 30, 24, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, "▶", cover.x + cover.w - 27, cover.y + cover.h - 30, {
          size: 22,
          color: "#ffce8a",
        });
        ctx.restore();

        text(ctx, meta.title, cx, cover.y + cover.h + 36, { size: 25, weight: "700", color: "#fff" });
        text(ctx, meta.artist, cx, cover.y + cover.h + 66, { size: 18, color: "#b9a999" });

        if (d && meta.spotifyUrl) {
          ctx.fillStyle = "#1DB954";
          roundRect(ctx, spotify.x, spotify.y, spotify.w, spotify.h, spotify.h / 2);
          ctx.fill();
          text(ctx, "▶  SPOTIFY", spotify.x + spotify.w / 2, spotify.y + spotify.h / 2, {
            size: 19,
            weight: "800",
            color: "#04220f",
          });
        } else {
          text(ctx, "stuknij okładkę, aby zagrać", cx, spotify.y + spotify.h / 2, {
            size: 16,
            color: "#8a7c6e",
          });
        }
      } else {
        text(ctx, "? ? ?", cx, cover.y + cover.h + 42, {
          size: 25,
          weight: "700",
          color: "rgba(255,255,255,0.4)",
        });
        text(ctx, "wkrótce", cx, spotify.y + spotify.h / 2, { size: 17, color: "#6b6055" });
      }
    }

    text(ctx, "prototyp · okładki tymczasowe", VW / 2, VH - 54, { size: 16, color: "#6b6055" });
  }

  // ---- ekran: gra --------------------------------------------

  private drawPlay(ctx: CanvasRenderingContext2D) {
    const pulse = this.beatPulse();

    if (this.awaitingStart) {
      this.drawStage(ctx, 0.45, pulse);
      ctx.fillStyle = "rgba(4,4,10,0.58)";
      ctx.fillRect(0, 0, VW, VH);
      text(ctx, this.song.title.toUpperCase(), VW / 2, 300, {
        size: 42,
        weight: "800",
        color: "#fff7ec",
        glow: "#ffb457",
        glowBlur: 16,
      });

      // ostrzeżenie o dźwięku — TYLKO tutaj, przed grą
      const suspended = this.audio.state !== "running";
      ctx.fillStyle = "rgba(8,6,12,0.85)";
      roundRect(ctx, 44, 386, VW - 88, 132, 18);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,180,90,0.5)";
      ctx.lineWidth = 2;
      roundRect(ctx, 44, 386, VW - 88, 132, 18);
      ctx.stroke();
      text(ctx, "🔊 SPRAWDŹ DŹWIĘK", VW / 2, 424, { size: 22, weight: "800", color: "#ffce8a" });
      text(ctx, "iPhone: przełącznik ciszy nad przyciskami głośności — WYŁĄCZ", VW / 2, 458, {
        size: 16,
        color: "#c9b7a6",
      });
      text(ctx, "oraz podkręć głośność multimediów", VW / 2, 486, { size: 16, color: "#c9b7a6" });
      void suspended;

      const s = 1 + pulse * 0.06;
      ctx.save();
      ctx.translate(VW / 2, 760);
      ctx.scale(s, s);
      ctx.fillStyle = "rgba(255,180,90,0.16)";
      ctx.beginPath();
      ctx.arc(0, 0, 96, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      text(ctx, "▶", VW / 2 + 6, 760, { size: 88, color: "#ffce8a" });
      text(ctx, "STUKNIJ, ABY ZAGRAĆ", VW / 2, 910, {
        size: 28,
        weight: "800",
        color: "#ffce8a",
        letterSpacing: "3px",
      });
      return;
    }

    // ---- trzęsienie ekranu ----
    const sh = this.shake;
    const sx = sh ? (Math.random() - 0.5) * sh : 0;
    const sy = sh ? (Math.random() - 0.5) * sh : 0;
    ctx.save();
    ctx.translate(sx, sy);

    const missGlow = clamp(1 - (this.songTime - this.denisMissAt) / 0.3, 0, 1);
    const popGlow = this.songTime - this.denisPopAt < 0.15 ? 0.5 : 0;
    const heat = this.flowTier / MAX_FLOW_TIER;
    this.drawStage(ctx, 0.34 + missGlow * 0.12 - heat * 0.06, pulse + popGlow + heat * 0.35);

    if (heat > 0.01 || missGlow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle =
        missGlow > 0.05 ? `rgba(255,45,60,${missGlow * 0.14})` : `rgba(255,150,60,${heat * 0.05})`;
      ctx.fillRect(0, 0, VW, VH);
      ctx.restore();
    }

    this.drawPlayfield(ctx, pulse);
    this.drawNotes(ctx);
    this.drawCharacter(ctx); // pierwszy plan — przed nutami
    this.drawJudgePopups(ctx);
    this.drawHud(ctx);
    this.drawCountdown(ctx);
    if (this.paused) this.drawPause(ctx);

    ctx.restore(); // koniec trzęsienia
  }

  // ---- postać (placeholder — czeka na Twoją grafikę) -------------
  //
  // Gdy dostaniemy klatki: `public/assets/char/<utwor>/dance-1..N.png`
  // (+ opcjonalnie hit.png / miss.png), podmieniamy tę metodę na rysowanie
  // klatek. Reszta (bit, reakcje) jest już policzona z songTime.

  private drawCharacter(ctx: CanvasRenderingContext2D) {
    const beat = 60 / this.song.bpm;
    const t = Math.max(this.songTime, 0);
    const phase = (t % beat) / beat; // 0..1 w obrębie bitu
    const groundY = this.song.characterY ?? 706;
    const cx = VW / 2;

    const hit = clamp(1 - (this.songTime - this.denisPopAt) / 0.22, 0, 1);
    const miss = clamp(1 - (this.songTime - this.denisMissAt) / 0.32, 0, 1);
    const flowUp = clamp(1 - (this.songTime - this.flowUpAt) / 0.5, 0, 1);

    // groove: podskok na bicie + kołysanie
    const bounce = -Math.abs(Math.sin(phase * Math.PI)) * (14 + flowUp * 30);
    const sway = Math.sin((t / beat) * Math.PI) * 12;
    const tilt = Math.sin((t / beat) * Math.PI) * 0.045 + miss * 0.22 - flowUp * 0.04;
    // squash & stretch — spłaszczenie przy „lądowaniu" na bicie
    const land = Math.pow(Math.max(0, Math.sin(phase * Math.PI * 2) * -1), 1.4);
    const sqx = 1 + land * 0.07 + hit * 0.05;
    const sqy = 1 - land * 0.07 + hit * 0.09 + flowUp * 0.12;

    // --- prawdziwa grafika (PNG animowane proceduralnie) ---
    if (this.charImg && this.charImg.width) {
      const img = this.charImg;
      const h = 440 * (this.song.characterScale ?? 1);
      const w = (img.width / img.height) * h;
      ctx.save();
      ctx.translate(cx + sway, groundY + bounce);
      ctx.rotate(tilt);
      ctx.scale(sqx, sqy);
      if (miss > 0.05) {
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(img, -w / 2, -h, w, h);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(cx + sway, groundY + 8, w * 0.32 - bounce * 0.5, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // --- placeholder wektorowy (do czasu podesłania grafiki) ---
    const scale = 1 + hit * 0.08 + flowUp * 0.12;
    const armRaise = hit * 1.1 + flowUp * 0.7;

    ctx.save();
    ctx.translate(cx + sway, groundY + bounce);
    ctx.rotate(tilt);
    ctx.scale(scale * sqx, scale * sqy);
    ctx.globalAlpha = 0.92;

    const col = miss > 0.1 ? "#7a5a44" : "#c98a5a";
    const rim = "rgba(255,220,180,0.9)";
    ctx.strokeStyle = rim;
    ctx.lineCap = "round";

    // nogi
    ctx.strokeStyle = col;
    ctx.lineWidth = 22;
    const legSwing = Math.sin(t / beat * Math.PI * 2) * 12;
    ctx.beginPath();
    ctx.moveTo(-10, -120);
    ctx.lineTo(-18 - legSwing, 0);
    ctx.moveTo(10, -120);
    ctx.lineTo(18 + legSwing, 0);
    ctx.stroke();

    // tułów
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.lineTo(0, -230);
    ctx.stroke();

    // ramiona
    ctx.lineWidth = 18;
    const aBase = -220;
    const aL = -0.5 - armRaise + Math.sin(t / beat * Math.PI * 2) * 0.3;
    const aR = 0.5 + armRaise - Math.sin(t / beat * Math.PI * 2) * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, aBase);
    ctx.lineTo(Math.sin(aL) * 70, aBase - Math.cos(aL) * 70);
    ctx.moveTo(0, aBase);
    ctx.lineTo(Math.sin(aR) * 70, aBase - Math.cos(aR) * 70);
    ctx.stroke();

    // głowa
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, -270, 30, 0, Math.PI * 2);
    ctx.fill();

    // rim light
    ctx.strokeStyle = rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -270, 30, Math.PI * 0.8, Math.PI * 1.6);
    ctx.stroke();

    ctx.restore();

    // subtelny cień
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(cx + sway, groundY + 6, 70 - bounce * 0.6, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPause(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = "rgba(4,4,10,0.82)";
    ctx.fillRect(0, 0, VW, VH);

    if (this.resumeAt) {
      const left = Math.max(1, Math.ceil((this.resumeAt - performance.now()) / 1000 + 0.25));
      text(ctx, String(left), VW / 2, VH / 2, {
        size: 180,
        weight: "800",
        color: "#fff7ec",
        glow: "#ffb457",
        glowBlur: 40,
      });
      ctx.restore();
      return;
    }

    text(ctx, "PAUZA", VW / 2, 430, {
      size: 62,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 20,
      letterSpacing: "8px",
    });

    const g = ctx.createLinearGradient(PZ_RESUME.x, 0, PZ_RESUME.x + PZ_RESUME.w, 0);
    g.addColorStop(0, "#ff9f43");
    g.addColorStop(1, "#ff5e7e");
    ctx.fillStyle = g;
    roundRect(ctx, PZ_RESUME.x, PZ_RESUME.y, PZ_RESUME.w, PZ_RESUME.h, PZ_RESUME.h / 2);
    ctx.fill();
    text(ctx, "WZNÓW", VW / 2, PZ_RESUME.y + PZ_RESUME.h / 2, {
      size: 34,
      weight: "800",
      color: "#1a0d12",
    });

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, PZ_RESTART.x, PZ_RESTART.y, PZ_RESTART.w, PZ_RESTART.h, 18);
    ctx.fill();
    text(ctx, "OD NOWA", VW / 2, PZ_RESTART.y + PZ_RESTART.h / 2, { size: 24, color: "#ffce8a" });

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, PZ_MENU.x, PZ_MENU.y, PZ_MENU.w, PZ_MENU.h, 18);
    ctx.fill();
    text(ctx, "MENU", VW / 2, PZ_MENU.y + PZ_MENU.h / 2, { size: 24, color: "#c9b7a6" });

    ctx.restore();
  }

  // ---- pole gry (perspektywa) -----------------------------------

  private drawPlayfield(ctx: CanvasRenderingContext2D, pulse: number) {
    const grad = ctx.createLinearGradient(0, HORIZON_Y, 0, VH);
    grad.addColorStop(0, "rgba(6,3,10,0)");
    grad.addColorStop(0.4, "rgba(6,3,10,0.5)");
    grad.addColorStop(1, "rgba(6,3,10,0.86)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, HORIZON_Y, VW, VH - HORIZON_Y);

    const eBot = 1 + (PAD_BOT - HIT_Y) / (HIT_Y - HORIZON_Y);
    const stripHW = (e: number) => lerp(2, LANE_GAP_HIT * 0.46, e);

    // tory
    for (let l = 0; l < LANES; l++) {
      const held = !!this.held[l];
      const flash = clamp(1 - (this.songTime - this.laneFlash[l]) / 0.22, 0, 1);
      const cTop = this.laneXAtE(l, 0.03);
      const cBotE = this.laneXAtE(l, eBot);
      const yTop = this.yForE(0.03);
      const yBot = this.yForE(eBot);
      const hwT = stripHW(0.03);
      const hwB = stripHW(eBot);

      ctx.beginPath();
      ctx.moveTo(cTop - hwT, yTop);
      ctx.lineTo(cBotE - hwB, yBot);
      ctx.lineTo(cBotE + hwB, yBot);
      ctx.lineTo(cTop + hwT, yTop);
      ctx.closePath();
      const lg = ctx.createLinearGradient(0, HORIZON_Y, 0, PAD_BOT);
      lg.addColorStop(0, l % 2 ? "rgba(120,20,30,0.10)" : "rgba(90,15,25,0.13)");
      lg.addColorStop(
        1,
        held ? "rgba(255,170,90,0.30)" : l % 2 ? "rgba(150,25,35,0.34)" : "rgba(120,20,30,0.40)",
      );
      ctx.fillStyle = lg;
      ctx.fill();

      ctx.strokeStyle = `rgba(255,225,195,${0.1 + flash * 0.5 + (held ? 0.35 : 0)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cTop - hwT, yTop);
      ctx.lineTo(cBotE - hwB, yBot);
      ctx.moveTo(cTop + hwT, yTop);
      ctx.lineTo(cBotE + hwB, yBot);
      ctx.stroke();
    }

    // linia trafienia
    ctx.save();
    ctx.strokeStyle = "rgba(255,228,185,0.85)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(255,200,120,0.9)";
    ctx.shadowBlur = 16 + pulse * 12;
    ctx.beginPath();
    ctx.moveTo(this.hitX(0) - LANE_GAP_HIT * 0.62, HIT_Y);
    ctx.lineTo(this.hitX(LANES - 1) + LANE_GAP_HIT * 0.62, HIT_Y);
    ctx.stroke();
    ctx.restore();

    // klawisze dotykowe pod linią
    for (let l = 0; l < LANES; l++) {
      const eT = 1.05;
      const xT = this.laneXAtE(l, eT);
      const xB = this.laneXAtE(l, eBot);
      const wT = stripHW(eT) * 1.7;
      const wB = stripHW(eBot) * 1.7;
      const yT = this.yForE(eT);
      const yB = this.yForE(eBot);
      const lit = clamp(
        this.lanePress[l] +
          (this.held[l] ? 0.9 : 0) +
          clamp(1 - (this.songTime - this.laneFlash[l]) / 0.14, 0, 1),
        0,
        1,
      );
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xT - wT, yT);
      ctx.quadraticCurveTo(xT - wT, yT - 24, xT, yT - 24);
      ctx.quadraticCurveTo(xT + wT, yT - 24, xT + wT, yT);
      ctx.lineTo(xB + wB, yB);
      ctx.lineTo(xB - wB, yB);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${0.07 + lit * 0.8})`;
      if (lit > 0.3) {
        ctx.shadowColor = LANE_COLORS[l];
        ctx.shadowBlur = lit * 26;
      }
      ctx.fill();
      ctx.restore();
    }

    // puste kółka (receptory) — zawsze na miejscu
    for (let l = 0; l < LANES; l++) {
      const x = this.hitX(l);
      const flash = clamp(1 - (this.songTime - this.laneFlash[l]) / 0.22, 0, 1);
      const held = !!this.held[l];
      const r = RECEPTOR_R + flash * 6 + this.lanePress[l] * 5 + (held ? 6 : 0);
      ctx.save();
      ctx.lineWidth = 5 + (held ? 3 : 0);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + flash * 0.5 + this.lanePress[l] * 0.2})`;
      ctx.shadowColor = LANE_COLORS[l];
      ctx.shadowBlur = 8 + flash * 30 + (held ? 18 : 0);
      ctx.beginPath();
      ctx.arc(x, HIT_Y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (flash > 0.01) {
        ctx.globalAlpha = flash * 0.32;
        ctx.fillStyle = "#fff";
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawNotes(ctx: CanvasRenderingContext2D) {
    // ogony nut trzymanych
    for (const n of this.song.notes) {
      if (n.dur <= 0) continue;
      const headE = n.holding ? 1 : this.eForTime(n.time);
      const tailE = this.eForTime(n.time + n.dur);
      if (headE < -0.15 && !n.holding) continue;
      if (tailE > 1.15 && !n.holding) continue;
      if (n.judged && !n.holding && this.songTime - n.judgedAt > 0.25) continue;

      const eLo = Math.max(tailE, 0.02);
      const eHi = n.holding ? 1 : Math.min(headE, 1.08);
      if (eHi <= eLo) continue;

      const steps = 7;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const e = lerp(eLo, eHi, i / steps);
        const x = this.laneXAtE(n.lane, e) - RECEPTOR_R * 0.5 * this.sizeAtE(e);
        const y = this.yForE(e);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const e = lerp(eLo, eHi, i / steps);
        ctx.lineTo(this.laneXAtE(n.lane, e) + RECEPTOR_R * 0.5 * this.sizeAtE(e), this.yForE(e));
      }
      ctx.closePath();
      ctx.save();
      ctx.globalAlpha = n.holding
        ? 0.72
        : n.judged
          ? clamp(1 - (this.songTime - n.judgedAt) / 0.25, 0, 1) * 0.4
          : 0.42;
      ctx.fillStyle = LANE_COLORS[n.lane];
      if (n.holding) {
        ctx.shadowColor = LANE_COLORS[n.lane];
        ctx.shadowBlur = 24;
      }
      ctx.fill();
      ctx.restore();
    }

    // głowy nut (bliższe rysujemy później → na wierzchu)
    const order = [...this.song.notes].sort((a, b) => b.time - a.time);
    for (const n of order) {
      let e = n.holding ? 1 : this.eForTime(n.time);
      if (!n.judged && (e > 1.2 || e < -0.2)) continue;
      let alpha = 1;
      if (n.judged) {
        const jt = this.songTime - n.judgedAt;
        if (jt > 0.3) continue;
        if (n.hit) {
          alpha = 1 - jt / 0.3;
          e = n.holding ? 1 : Math.min(this.eForTime(n.time), 1);
        } else {
          alpha = clamp(0.6 - jt * 2, 0, 1);
          e = this.eForTime(n.time) + jt * 0.7;
        }
      }
      const ec = clamp(e, 0, 1.2);
      const x = this.laneXAtE(n.lane, ec);
      const y = this.yForE(ec);
      const r = RECEPTOR_R * this.sizeAtE(e);
      const col = LANE_COLORS[n.lane];
      const a = clamp(alpha, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = col;
      ctx.shadowBlur = 14 + (n.dur > 0 ? 8 : 0);
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.55, col);
      g.addColorStop(1, n.judged && !n.hit ? "#5a1e26" : shade(col, -40));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // pierścienie trafień
    for (const fx of this.hitFx) {
      const life = (this.songTime - fx.at) / 0.32;
      if (life < 0 || life >= 1) continue;
      const x = this.hitX(fx.lane);
      const r = RECEPTOR_R * (0.7 + life * 1.8);
      ctx.save();
      ctx.globalAlpha = (1 - life) * 0.8;
      ctx.lineWidth = 5 * (1 - life) + 1;
      ctx.strokeStyle = JUDGE_COLOR[fx.kind];
      ctx.beginPath();
      ctx.arc(x, HIT_Y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawJudgePopups(ctx: CanvasRenderingContext2D) {
    for (const p of this.popups) {
      const life = (this.songTime - p.at) / 0.55;
      if (life < 0 || life >= 1) continue;
      ctx.save();
      ctx.globalAlpha = 1 - life * life;
      ctx.translate(p.x, HIT_Y - 92 - life * 44);
      ctx.rotate(-0.05);
      text(ctx, p.txt, 0, 0, {
        size: 30 - life * 4,
        weight: "800",
        color: p.color,
        glow: p.color,
        glowBlur: 12,
      });
      ctx.restore();
    }
  }

  private drawCountdown(ctx: CanvasRenderingContext2D) {
    const first = this.song.notes[0]?.time ?? 3;
    const rel = first - this.songTime;
    if (rel <= 0.05 || rel > 3.2) return;
    const n = Math.ceil(rel);
    const f = n - rel;
    ctx.save();
    ctx.globalAlpha = clamp(1 - f, 0.15, 1);
    text(ctx, String(n), VW / 2, VH / 2 - 60, {
      size: 150 + f * 50,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 40,
    });
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    // tytuł + pasek postępu utworu
    text(ctx, this.song.title.toUpperCase(), MARGIN, 44, {
      size: 20,
      align: "left",
      weight: "800",
      color: "#fff7ec",
      letterSpacing: "1px",
    });
    const p = clamp(this.songTime / this.song.duration, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, 0, VW, 5);
    const pg = ctx.createLinearGradient(0, 0, VW, 0);
    pg.addColorStop(0, "#ff9f43");
    pg.addColorStop(1, "#ff5e7e");
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, VW * p, 5);

    // pauza
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(PAUSE_RECT.x + 22, PAUSE_RECT.y + 12, 8, 38);
    ctx.fillRect(PAUSE_RECT.x + 40, PAUSE_RECT.y + 12, 8, 38);

    // wynik
    const scoreStr = Math.round(this.displayScore).toString().padStart(6, "0");
    text(ctx, scoreStr, VW / 2, 116, {
      size: 52,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 12,
    });

    // gwiazdki
    const fill = this.starFill();
    for (let i = 0; i < 5; i++) this.drawStar(ctx, VW / 2 - 128 + i * 64, 182, 22, clamp(fill - i, 0, 1));

    // pasek życia
    const bw = 420;
    const bx = VW / 2 - bw / 2;
    const by = 220;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, bx - 3, by - 3, bw + 6, 20, 10);
    ctx.fill();
    const low = this.health < 0.25;
    const hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    hg.addColorStop(0, low ? "#ff5e5e" : "#43d67a");
    hg.addColorStop(1, low ? "#ff9f43" : "#8affc1");
    ctx.fillStyle = hg;
    roundRect(ctx, bx, by, Math.max(6, bw * this.health), 14, 7);
    ctx.fill();

    // panele lewej strony
    this.hudChip(ctx, 18, 700, "MNOŻNIK", `×${this.multiplier()}`, this.multiplier() > 1);
    this.hudChip(ctx, 18, 818, "FLOW", String(this.flow), this.flow > 0);

    // pionowy miernik flow (prawa strona)
    this.drawFlowMeter(ctx);

    // combo
    if (this.combo >= 4) {
      const pop = clamp(1 - (this.songTime - this.comboPopAt) / 0.16, 0, 1);
      ctx.save();
      ctx.translate(VW / 2, 328);
      ctx.scale(1 + pop * 0.22, 1 + pop * 0.22);
      text(ctx, String(this.combo), 0, 0, {
        size: 76,
        weight: "800",
        color: "#fff7ec",
        glow: "#ffd24c",
        glowBlur: 22,
      });
      text(ctx, "COMBO", 0, 52, { size: 18, color: "#ffce8a", letterSpacing: "6px" });
      ctx.restore();
    }

    // baner (kamień milowy)
    const bl = (this.songTime - this.bannerAt) / 1.0;
    if (bl >= 0 && bl < 1) {
      const a = bl < 0.15 ? bl / 0.15 : bl > 0.72 ? (1 - bl) / 0.28 : 1;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(255,150,60,0.16)";
      ctx.fillRect(0, 468, VW, 92);
      text(ctx, this.bannerTxt, VW / 2, 514, {
        size: 44,
        weight: "800",
        color: "#ffe27a",
        glow: "#ff9f43",
        glowBlur: 20,
        letterSpacing: "2px",
      });
      ctx.restore();
    }
  }

  private hudChip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    value: string,
    active: boolean,
  ) {
    const w = 128;
    const h = 92;
    ctx.fillStyle = "rgba(250,250,250,0.92)";
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    text(ctx, label, x + w / 2, y + 22, { size: 15, weight: "800", color: "#1a0d12" });
    text(ctx, value, x + w / 2, y + 60, {
      size: 38,
      weight: "800",
      color: active ? "#e0521f" : "#1a0d12",
    });
  }

  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: number) {
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r : r * 0.44;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.save();
    path();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fill();
    if (fill > 0) {
      ctx.save();
      path();
      ctx.clip();
      ctx.fillStyle = "#ffd24c";
      ctx.shadowColor = "#ffd24c";
      ctx.shadowBlur = 12;
      ctx.fillRect(cx - r, cy - r, r * 2 * fill, r * 2);
      ctx.restore();
    }
    path();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,210,120,0.6)";
    ctx.stroke();
    ctx.restore();
  }

  private drawFlowMeter(ctx: CanvasRenderingContext2D) {
    const x = VW - 42;
    const top = 560;
    const bot = 1060;
    const w = 18;
    const full = this.flowTier >= MAX_FLOW_TIER;
    const prog = full ? 1 : (this.flow % FLOW_PER_TIER) / FLOW_PER_TIER;
    const justUp = this.songTime - this.flowUpAt < 0.3;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(ctx, x - w / 2, top, w, bot - top, w / 2);
    ctx.fill();
    const h = (bot - top) * prog;
    const mg = ctx.createLinearGradient(0, bot, 0, top);
    mg.addColorStop(0, "#ff6b3d");
    mg.addColorStop(1, "#ffd24c");
    ctx.fillStyle = mg;
    if (full || justUp) {
      ctx.shadowColor = "#ffd24c";
      ctx.shadowBlur = 20;
    }
    roundRect(ctx, x - w / 2, bot - h, w, Math.max(h, 0), w / 2);
    ctx.fill();
    ctx.restore();

    // płomień u dołu
    ctx.save();
    ctx.translate(x, bot + 26);
    const s = 1 + (justUp ? 0.3 : 0) + Math.sin(this.songTime * 12) * 0.04;
    ctx.scale(s, s);
    ctx.fillStyle = full ? "#ffd24c" : "#ff8a3d";
    ctx.shadowColor = "#ff8a3d";
    ctx.shadowBlur = full ? 16 : 8;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.quadraticCurveTo(13, 0, 6, 13);
    ctx.quadraticCurveTo(0, 21, -6, 13);
    ctx.quadraticCurveTo(-13, 0, 0, -16);
    ctx.fill();
    ctx.restore();
  }

  // ---- ekran: wynik (licznik + gwiazdki + werdykt) ---------------

  private drawResults(ctx: CanvasRenderingContext2D) {
    this.drawStage(ctx, 0.62, this.beatPulse() * 0.3);

    const now = performance.now();
    const reveal = clamp((now - this.resultsAt) / 1800, 0, 1);
    const eased = 1 - Math.pow(1 - reveal, 3);
    const finalR = this.rating();
    const shown = clamp(finalR, 0, 1) * eased;
    const shownStars = this.starsFor(shown);
    const revealDone = reveal >= 1;
    const passed = finalR >= PASS_RATING;

    text(ctx, this.song.title.toUpperCase(), VW / 2, 78, {
      size: 22,
      weight: "800",
      color: "#fff7ec",
      letterSpacing: "2px",
    });
    text(ctx, "WYNIK RUNDY", VW / 2, 116, { size: 17, color: "#8a7c6e", letterSpacing: "8px" });

    // --- gwiazdki (wskakują w miarę wzrostu wskazówki) ---
    const nowStars = Math.floor(shownStars + 0.0001);
    if (nowStars > this.resultStarSeen && this.resultStarSeen < 5) {
      this.resultStarSeen = nowStars;
      this.lastStarPopAt = now;
      this.audio.sfx(this.resultStarSeen >= 3 ? "flow" : "perfect");
      haptic(this.resultStarSeen >= 3 ? "flowUp" : "combo");
    }
    for (let i = 0; i < 5; i++) {
      const f = clamp(shownStars - i, 0, 1);
      const isNew = i === this.resultStarSeen - 1;
      const pop = isNew ? clamp(1 - (now - this.lastStarPopAt) / 320, 0, 1) : 0;
      const r = 26 * (1 + pop * 0.5);
      this.drawStar(ctx, VW / 2 - 132 + i * 66, 186, r, f);
    }

    // --- licznik (speedometer) ---
    const cx = VW / 2;
    const cy = 560;
    const R = 208;
    const A0 = Math.PI * 0.75;
    const SWEEP = Math.PI * 1.5;
    const ang = (r: number) => A0 + clamp(r, 0, 1) * SWEEP;

    ctx.save();
    ctx.lineCap = "round";
    // tło łuku
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, A0 + SWEEP);
    ctx.stroke();
    // wypełnienie
    ctx.strokeStyle = shown >= PASS_RATING ? "#ffd24c" : "#ff7a3d";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, ang(shown));
    ctx.stroke();
    ctx.shadowBlur = 0;
    // podziałka
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let k = 0; k <= 10; k++) {
      const a = ang(k / 10);
      const r1 = R - 16;
      const r2 = R + (k % 5 === 0 ? 16 : 9);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    // znacznik zaliczenia (70%)
    const pa = ang(PASS_RATING);
    ctx.strokeStyle = "#ff5e5e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pa) * (R - 20), cy + Math.sin(pa) * (R - 20));
    ctx.lineTo(cx + Math.cos(pa) * (R + 22), cy + Math.sin(pa) * (R + 22));
    ctx.stroke();
    text(
      ctx,
      "70%",
      cx + Math.cos(pa) * (R + 46),
      cy + Math.sin(pa) * (R + 46),
      { size: 16, weight: "800", color: "#ff8a8a" },
    );
    ctx.restore();

    // wskazówka
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang(shown));
    ctx.fillStyle = "#fff7ec";
    ctx.shadowColor = "#ffb457";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(0, -10);
    ctx.lineTo(R - 34, 0);
    ctx.lineTo(0, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#1a0d12";
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffce8a";
    ctx.lineWidth = 3;
    ctx.stroke();

    // odczyt środkowy
    text(ctx, `${Math.round(shown * 100)}%`, cx, cy + 96, {
      size: 60,
      weight: "800",
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 14,
    });
    text(ctx, this.score.toLocaleString("pl-PL") + " pkt", cx, cy + 146, {
      size: 20,
      color: "#c9b7a6",
    });

    // --- werdykt + statystyki + przyciski (po animacji) ---
    if (!revealDone) {
      text(ctx, "stuknij, aby pominąć", VW / 2, VH - 40, { size: 15, color: "#6b6055" });
      return;
    }

    const fadeIn = clamp((now - this.resultsAt - 1800) / 400, 0, 1);
    ctx.save();
    ctx.globalAlpha = fadeIn;

    if (passed) {
      text(ctx, "ZALICZONE!", VW / 2, 812, {
        size: 46,
        weight: "800",
        color: "#8affc1",
        glow: "#8affc1",
        glowBlur: 20,
        letterSpacing: "2px",
      });
      text(ctx, "runda zaliczona — świetna robota", VW / 2, 852, { size: 18, color: "#c9b7a6" });
    } else {
      text(ctx, "NIE TYM RAZEM", VW / 2, 812, {
        size: 42,
        weight: "800",
        color: "#ff8a97",
        glow: "#ff5e7e",
        glowBlur: 16,
        letterSpacing: "1px",
      });
      text(ctx, `zabrakło do 70% — spróbuj jeszcze raz`, VW / 2, 852, {
        size: 18,
        color: "#c9b7a6",
      });
    }

    const fc = this.counts.miss === 0 && this.holdsBroken === 0 && this.judgedCount > 0;
    let extra = `celność ${(this.accuracy() * 100).toFixed(1)}%  ·  max combo ${this.maxCombo}  ·  flow ${this.maxFlow}`;
    if (fc) extra = "PEŁNE COMBO  ·  " + extra;
    if (this.newBest) extra = "★ REKORD  ·  " + extra;
    text(ctx, extra, VW / 2, 900, { size: 17, color: "#9a8c7e" });

    const stats: [string, number, string][] = [
      ["PERFECT", this.counts.perfect, "#ffe27a"],
      ["SUPER", this.counts.great, "#8affc1"],
      ["OK", this.counts.good, "#8ab6ff"],
      ["PUDŁO", this.counts.miss, "#ff6b7d"],
      ["TRZYM.", this.holdsDone, "#8affc1"],
      ["ZERW.", this.holdsBroken, "#ff6b7d"],
    ];
    stats.forEach((r, i) => {
      const x = VW / 2 - 300 + i * 120 + 60;
      text(ctx, String(r[1]), x, 950, { size: 28, weight: "800", color: "#fff" });
      text(ctx, r[0], x, 978, { size: 12, color: r[2] });
    });

    // --- przyciski ---
    const nxt = nextRound(this.trackId);
    const primaryLabel = passed
      ? nxt
        ? "KOLEJNA RUNDA ›"
        : "WRÓĆ DO MENU"
      : "SPRÓBUJ PONOWNIE";
    const g1 = ctx.createLinearGradient(RES_PRIMARY.x, 0, RES_PRIMARY.x + RES_PRIMARY.w, 0);
    g1.addColorStop(0, "#ff9f43");
    g1.addColorStop(1, "#ff5e7e");
    ctx.fillStyle = g1;
    roundRect(ctx, RES_PRIMARY.x, RES_PRIMARY.y, RES_PRIMARY.w, RES_PRIMARY.h, 22);
    ctx.fill();
    text(ctx, primaryLabel, VW / 2, RES_PRIMARY.y + RES_PRIMARY.h / 2, {
      size: 26,
      weight: "800",
      color: "#1a0d12",
    });

    // Zapisz na Spotify
    ctx.fillStyle = "#1DB954";
    roundRect(ctx, RES_SPOTIFY.x, RES_SPOTIFY.y, RES_SPOTIFY.w, RES_SPOTIFY.h, 20);
    ctx.fill();
    text(ctx, "♥  Zapisz na Spotify", VW / 2, RES_SPOTIFY.y + RES_SPOTIFY.h / 2, {
      size: 22,
      weight: "800",
      color: "#04220f",
    });

    // małe linki
    text(ctx, "Jeszcze raz", RES_AGAIN.x + RES_AGAIN.w / 2, RES_AGAIN.y + RES_AGAIN.h / 2, {
      size: 18,
      color: "#c9b7a6",
    });
    text(ctx, "Menu", RES_MENU.x + RES_MENU.w / 2, RES_MENU.y + RES_MENU.h / 2, {
      size: 18,
      color: "#c9b7a6",
    });

    ctx.restore();
  }
}
