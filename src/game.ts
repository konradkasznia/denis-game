// Rdzeń gry: maszyna stanów (menu → odliczanie → gra → wynik) oraz cała
// logika rytmiczna i rysowanie.

import { AudioEngine } from "./audio.ts";
import { clearSession, deleteAccount, hasAccount } from "./account.ts";
import {
  checkLogin as apiCheckLogin,
  fetchMe,
  login as apiLogin,
  register as apiRegister,
} from "./authApi.ts";
import { Character } from "./character.ts";
import { buildSynthSong, LANES, type Note, type SongDef } from "./chart.ts";
import { isNative } from "./native.ts";
import { POLL_LEVEL6, POLL_LEVEL6_OPTIONS, submitVote, votedChoice } from "./poll.ts";
import { uiSound } from "./uisfx.ts";
import { disablePush, enablePush, initPush, pushOptedInSync, syncPushState } from "./push.ts";
import { FieldOverlay, type FieldSpec } from "./fieldOverlay.ts";
import { showDoc } from "./docOverlay.ts";
import {
  mergeServerBest,
  myEntry,
  type Period,
  refreshBoard,
  submitScore,
  topN,
} from "./leaderboard.ts";
import { DEFAULT_TRACK, loadTrack } from "./tracks.ts";
import { ACC_WEIGHT, classify, isMissed, type Judgement, pickNote } from "./judge.ts";
import { fire as haptic, setHapticsEnabled } from "./haptics.ts";
import {
  bestStars,
  clearedStreak,
  devUnlocked,
  levelUnlocked,
  markDiscovered,
  mergeServerStars,
  recordStars,
  SONGS,
  spotifyUrl,
  UNLOCK_STARS,
} from "./songs.ts";
import { VH, viewport, VW } from "./viewport.ts";
import {
  clamp,
  desaturated,
  HEAD_FONT,
  HEAD_SHADOWS,
  imgReady,
  lerp,
  loadImg,
  roundRect,
  shade,
  text,
  trimmedImage,
  wrapText,
} from "./ui.ts";

type Scene =
  | "loading"
  | "auth"
  | "hits"
  | "board"
  | "rewards"
  | "profile"
  | "play"
  | "results";

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
const HIT_Y_BASE = 1118; // linia trafienia przy wysokości projektowej (VH); realnie: hitY()
const APPROACH = 2.15; // s: jak długo nuta jest widoczna zanim dojdzie do linii (przy HIT_Y_BASE)
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

// --- strefy dotyku ---
const BACK: Rect = { x: 16, y: 36, w: 170, h: 62 };

// --- modal „włącz dźwięk" (nad ekranem startowym) ---
const MODAL_OK: Rect = { x: VW / 2 - 170, y: 792, w: 340, h: 92 };

// --- karuzela WYBIERZ HIT (makieta 1080×1920 -> 720×1280) ---
const HIT_GEAR: Rect = { x: VW - 82, y: 26, w: 62, h: 68 };
const HIT_LOGO: Rect = { x: 6, y: 40, w: VW - 12, h: 150 };
const HIT_LEVEL_Y = 250; // środek napisu „POZIOM N"
const HIT_TITLE_Y = 306; // środek tytułu utworu
const HIT_STARS_Y = 362;
// strzałki na wysokości tytułu, przy krawędziach
const HIT_ARROW_L: Rect = { x: 14, y: HIT_TITLE_Y - 46, w: 92, h: 92 };
const HIT_ARROW_R: Rect = { x: VW - 106, y: HIT_TITLE_Y - 46, w: 92, h: 92 };
const HIT_GRAJ: Rect = { x: MARGIN, y: 986, w: VW - MARGIN * 2, h: 104 };
const HIT_RES: Rect = { x: MARGIN, y: 1104, w: (VW - MARGIN * 2) / 2 - 9, h: 92 };
const HIT_REW: Rect = { x: VW / 2 + 9, y: 1104, w: (VW - MARGIN * 2) / 2 - 9, h: 92 };

// --- ekran NAGRODY ---
const REW_HOME: Rect = { x: MARGIN, y: 1086, w: VW - MARGIN * 2, h: 102 };

// --- ekran USTAWIENIA ---
const SET_W = VW - MARGIN * 2;
const SET_TERMS: Rect = { x: MARGIN, y: 246, w: SET_W, h: 96 };
const SET_PRIV: Rect = { x: MARGIN, y: 356, w: SET_W, h: 96 };
const SET_PUSH: Rect = { x: MARGIN, y: 462, w: SET_W, h: 96 }; // przełącznik powiadomień
const SET_DELETE: Rect = { x: MARGIN, y: 590, w: SET_W, h: 96 };
const SET_LOGOUT: Rect = { x: MARGIN, y: 700, w: SET_W, h: 96 };
const SET_MAIL: Rect = { x: MARGIN, y: 952, w: SET_W, h: 120 };

// --- tablica wyników: zakładki „ten miesiąc" | „wszystkie" + przycisk powrotu ---
const BOARD_TAB_M: Rect = { x: MARGIN, y: 132, w: (VW - MARGIN * 2) / 2 - 4, h: 58 };
const BOARD_TAB_A: Rect = { x: VW / 2 + 4, y: 132, w: (VW - MARGIN * 2) / 2 - 4, h: 58 };
const BOARD_BEST: Rect = { x: MARGIN, y: 856, w: VW - MARGIN * 2, h: 138 };
const BOARD_BACK: Rect = { x: MARGIN, y: 1026, w: VW - MARGIN * 2, h: 100 };

// logowanie / rejestracja — layout liczony w Game.authRects()

// dokumenty prawne (strony HTML w public/)
const DOC_TERMS_URL = "/regulamin.html";
const DOC_PRIVACY_URL = "/polityka-prywatnosci.html";
function openDoc(url: string) {
  if (url.startsWith("mailto:")) {
    try {
      window.location.href = url;
    } catch {
      /* ignore */
    }
    return;
  }
  // regulamin / polityka — nakładka z iframe, żeby nie wyrzucać z aplikacji
  const title = url.includes("regulamin") ? "Regulamin" : "Polityka prywatności";
  showDoc(url, title);
}
/** Otwiera link poza grą (Spotify itp.).
 *  Natywnie (Capacitor): target `_system` → Capacitor woła systemowy Intent
 *  (Android przekaże deep-link do aplikacji Spotify albo przeglądarki) —
 *  NIE nawigujemy WebView, bo z apki nie byłoby jak wrócić.
 *  Web: nowa karta, a gdy zablokowana — nawigacja. */
function openExternal(url: string) {
  try {
    if (isNative) {
      window.open(url, "_system");
      return;
    }
    const w = window.open(url, "_blank", "noopener");
    if (!w) window.location.href = url;
  } catch {
    if (isNative) return;
    try {
      window.location.href = url;
    } catch {
      /* ignore */
    }
  }
}
const PAUSE_RECT: Rect = { x: VW - 96, y: 24, w: 72, h: 64 };

// --- ekran rejestracji / logowania: głowa + rozmieszczenie pionowe ---
const AUTH_F1_Y = 268; // górna krawędź pierwszego pola (nick) — bez przesunięcia
const AUTH_HEAD_W_MIN = 250; // szerokość głowy przy wysokości bazowej
const AUTH_HEAD_W_MAX = 400; // …i przy dużym zapasie wysokości
const AUTH_HEAD_AR = 1182 / 1330; // wys/szer head.png
const AUTH_HEAD_GAP = 40; // odstęp głowa → pierwsze pole
const AUTH_MIN_TOP = 46; // minimalny margines głowy od górnej krawędzi (nie ucinać)
const AUTH_BOT_REG = 1078; // dolna krawędź bloku (link polityki) — tryb rejestracji
const AUTH_BOT_LOGIN = 968; // — tryb logowania
const PZ_RESUME: Rect = { x: MARGIN, y: 560, w: VW - MARGIN * 2, h: 100 };
const PZ_RESTART: Rect = { x: MARGIN, y: 682, w: VW - MARGIN * 2, h: 96 };
const PZ_MENU: Rect = { x: MARGIN, y: 800, w: VW - MARGIN * 2, h: 96 };
const RES_BOARD: Rect = { x: MARGIN, y: 916, w: VW - MARGIN * 2, h: 110 };
const RES_SPOTIFY: Rect = { x: MARGIN, y: 1034, w: VW - MARGIN * 2, h: 110 }; // 8px odstępu
const RES_PRIMARY: Rect = { x: MARGIN, y: 1152, w: VW - MARGIN * 2, h: 110 };

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

// ---- efekt combo (co 10) — per utwór ----------------------------------
type FxKind = "confetti" | "smoke" | "roses" | "iceShard";
interface FxParticle {
  kind: FxKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number; // konfetti/płatek: długość; dym: promień
  h: number; // konfetti/płatek: szerokość
  color: string;
  life: number;
  ttl: number;
  swayA: number;
  swayF: number;
  swayP: number;
  grow: number; // dym: przyrost promienia px/s
}
/** Który efekt leci przy combo co 10 dla danego utworu (domyślnie konfetti). */
const COMBO_FX: Record<string, FxKind> = {
  "ksiaze-z-bajki": "roses",
  pogrzebowka: "smoke",
  "byleby-nie-byla-ciepla": "iceShard",
};
/** Wygląd „głów" nut dla danego utworu. Brak wpisu = zwykłe kółka. */
const NOTE_SKIN: Record<string, "skull"> = {
  pogrzebowka: "skull",
};
const ROSE_COLORS = ["#e0344f", "#c8213f", "#ff6b83", "#a3172f", "#d94b63"];
// jasnoszary „sceniczny" dym (widoczny na ciemnym tle)
const SMOKE_COLORS = ["222,224,232", "200,202,212", "180,182,196", "158,160,176"];

const APP_VERSION = "0.9.0";
const SUPPORT_EMAIL = "impulsywni.media@gmail.com";

function bestScore(): number {
  return Number(localStorage.getItem("denis.best") || 0);
}

export class Game {
  private scene: Scene = "loading";
  private audio = new AudioEngine();

  private bg = new Image();
  private bgReady = false;
  private songBg: HTMLImageElement | null = null; // tło bieżącego utworu
  private bgCache = new Map<string, HTMLImageElement>();
  private character = new Character();

  private trackId = DEFAULT_TRACK;
  private hitIndex = 0; // strona karuzeli WYBIERZ HIT
  /** obszar postaci na ekranie WYBIERZ HIT (do umieszczania pieczątek) */
  private charRect: Rect = { x: 60, y: 392, w: VW - 120, h: 576 };
  private soundHintDone = false; // modal „włącz dźwięk" pokazany w tej sesji
  private soundModal = false;
  private offlineNotice = false; // „brak internetu — wynik niezapisany" na podsumowaniu
  /** pionowe przesunięcie układu UI w bieżącej klatce (ekran wyższy niż VH) */
  private vdy = 0;
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
  // efekt przy combo co 10 — per utwór: konfetti / dym / spadające róże
  private fx: FxParticle[] = [];
  private laneFlash = [0, 0, 0, 0];
  private lanePress = [0, 0, 0, 0];
  private comboPopAt = -10;
  private denisPopAt = -10;
  private denisMissAt = -10;
  private flowUpAt = -10;
  private bannerTxt = "";
  private bannerAt = -10;
  private shake = 0;
  // --- mechanika lodu (poziom „Byleby nie była ciepła") ---
  private iceActive = false;
  private iceTapsLeft = 0;
  private iceStartAt = -10; // songTime pojawienia się tafli (animacja zamarzania)
  private iceShatterAt = -10; // songTime rozbicia (animacja znikania)
  private evFired = new Set<number>(); // indeksy zdarzeń (przeszkód) już uruchomionych
  private spotlightStart = -10; // songTime początku reflektora
  private spotlightUntil = -10; // songTime końca reflektora
  private iceCracks: { x: number; y: number; a: number; born: number; len: number }[] = [];
  private iceSnap: HTMLCanvasElement | null = null; // kopia tła do rozmycia
  private iceLayer: HTMLCanvasElement | null = null; // zbuforowana grafika tafli
  private iceLayerKey = ""; // `${W}x${H}` — przerysuj warstwę przy zmianie rozmiaru
  private canvasFilterOK: boolean | null = null; // czy WebView wspiera ctx.filter
  private skullCache = new Map<string, HTMLCanvasElement>(); // nuty-czaszki (Pogrzebówka)
  private resultStarSeen = 0;
  private lastStarPopAt = 0;
  private authMode: "login" | "register" = "register";
  private authLogin = "";
  private authPassword = "";
  private authTerms = false;
  private authShowPw = false;
  private authError = "";
  /** którego pola dotyczy błąd (czerwony obrys): "login" | "password" | "both" | null */
  private authErrorField: "login" | "password" | "both" | null = null;
  private authErrorCloseRect: Rect | null = null;
  private authBusy = false;
  private modalOkRect: Rect | null = null;
  /** głosowanie „jaki poziom 6?" — null | wybór opcji | podziękowanie */
  private voteModal: null | "pick" | "thanks" = null;
  private voteRects: { r: Rect; id: string }[] = [];
  /** dostępność loginu przy rejestracji: "" | "checking" | "free" | "taken" */
  private authLoginState = "";
  private authCheckSeq = 0;
  private authCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private fields: FieldOverlay;
  private boardSongId = DEFAULT_TRACK;
  private boardPeriod: Period = "month";
  /** dokąd wraca „POWRÓT" z tablicy wyników (zależnie od tego, skąd weszliśmy) */
  private boardFrom: "hits" | "results" = "hits";
  private resultRank = 0;
  private resultsSavedBest = false;

  constructor(canvas?: HTMLCanvasElement | null) {
    this.fields = new FieldOverlay(canvas);
    this.bg.onload = () => {
      this.bgReady = true;
      if (this.scene === "loading") this.gotoStart();
    };
    this.bg.onerror = () => {
      if (this.scene === "loading") this.gotoStart();
    };
    this.bg.src = "assets/denis/denis-stage.png";
    setHapticsEnabled(true); // wibracje zawsze włączone
    this.audio.setSfxEnabled(true); // dźwięk zawsze włączony — gra bazuje na muzyce
    void this.syncSession(); // sprawdź sesję na serwerze
    void initPush(); // OneSignal (natywnie) + dosynchronizuj zgodę na powiadomienia
    // wczytaj beatmapę domyślnego utworu w tle (do wyświetlenia w menu)
    void this.preloadChart();
    // wczytaj z góry grafiki menu, żeby ekrany nie „mrugały" pustką
    for (const n of [
      "stage-bg.png", "wybierz-hit.png", "gear.png",
      "star-full.png", "star-half.png", "star-empty.png",
      "arrow-left.png", "arrow-right.png", "arrow-left-disabled.png", "arrow-right-disabled.png",
      "button-graj.png", "button-wyniki.png", "button-nagrody.png", "button-powrot.png", "button-rozumiem.png",
      "button-otworz-w-spotify.png", "button-od-nowa.png", "button-wyjdz.png",
      "button-tabela-wynikow.png", "button-kontynuuj.png",
      "reward-denis.png", "wkrotce.png", "przejdz-poprzedni-poziom.png", "head.png", "button-powiadom-mnie.png",
      ...SONGS.map((s) => `select-${s.id}.png`),
    ]) {
      loadImg(`assets/ui/${n}`);
    }
  }

  /** Weryfikuje sesję na serwerze i odtwarza postęp (po starcie / po zalogowaniu).
   *  Serwer jest źródłem prawdy o odblokowanych poziomach — dzięki temu progres
   *  wraca po wyczyszczeniu localStorage, na nowym telefonie i po ponownym
   *  zalogowaniu. Scalanie bierze zawsze wyższą wartość (lokalną lub serwerową). */
  private async syncSession() {
    try {
      const me = await fetchMe();
      if (me?.progress) {
        mergeServerStars(me.progress);
        mergeServerBest(me.progress);
        this.hitIndex = Math.min(this.hitIndex, this.maxHitIndex());
      }
    } catch {
      /* brak sieci — działamy na lokalnej kopii */
    }
  }

  /** Pierwszy ekran po wczytaniu: logowanie/rejestracja → WYBIERZ HIT. */
  private gotoStart() {
    if (!hasAccount()) this.scene = "auth";
    else this.enterHitsFresh();
  }

  /** Wejście do karuzeli od zera — z modalem „włącz dźwięk" (raz na sesję). */
  private enterHitsFresh() {
    this.hitIndex = Math.min(this.hitIndex, this.maxHitIndex());
    if (!this.soundHintDone) this.soundModal = true;
    this.scene = "hits";
    this.preloadHitAudio();
  }

  private async preloadChart() {
    try {
      const s = await loadTrack(this.trackId);
      if (this.scene !== "play") this.song = s;
      this.loadSongBg(s.bg);
      this.character.load({ character: s.character, characters: s.characters });
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


  // ---- pętla ----------------------------------------------------------

  update(dt: number, _nowMs: number) {
    this.syncFields();
    if (this.paused && this.resumeAt && performance.now() >= this.resumeAt) {
      this.paused = false;
      this.resumeAt = 0;
      void this.audio.resumePlayback();
    }
    if (this.scene === "play" && !this.awaitingStart && !this.paused) {
      this.songTime = this.audio.getSongTime();
      // watchdog: dźwięk nie ruszył (AudioContext utknął w suspended) —
      // zegar utworu stoi przy zerze; próbujemy wznowić, a po chwili poddajemy się.
      if (this.songStartedAt && this.songTime < 0.1 && !this.preparing) {
        const wall = performance.now() - this.songStartedAt;
        if (wall > 1200) void this.audio.resumePlayback();
        if (wall > 6000) {
          this.loadError =
            "Nie udało się uruchomić dźwięku. Spróbuj jeszcze raz.\n[" + this.audio.diag() + "]";
          this.audio.stop();
          this.songStartedAt = 0;
          this.scene = "hits";
        }
      } else if (this.songTime >= 0.1) {
        this.songStartedAt = 0; // wystartowało OK — watchdog wyłączony
      }
      // zdarzenia na osi czasu (przeszkody z edytora) — nuty lecą dalej (kara)
      const evs = this.song.events;
      if (evs) {
        for (let i = 0; i < evs.length; i++) {
          const e = evs[i];
          if (this.evFired.has(i) || this.songTime < e.at) continue;
          this.evFired.add(i);
          if (e.type === "ice") this.triggerIce(e.taps ?? 20);
          else if (e.type === "spotlight") {
            this.spotlightStart = this.songTime;
            this.spotlightUntil = this.songTime + (e.dur ?? 6);
            this.shake = Math.max(this.shake, 6);
            haptic("flowUp");
          }
        }
      }
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
    this.updateFx(dt);
  }

  // ---- efekt combo (co 10) — konfetti / dym / spadające róże ----------
  private static readonly CONFETTI_COLORS = [
    "#ff5e7e", "#ffd24c", "#8affc1", "#8ab6ff", "#ff9f43", "#ffffff",
  ];

  /** Efekt przypisany do bieżącego utworu. */
  private comboFxKind(): FxKind {
    return COMBO_FX[this.trackId] ?? "confetti";
  }

  private burstFx(kind: FxKind, x: number, y: number) {
    if (kind === "smoke") this.spawnSmoke(x, y);
    else if (kind === "roses") this.spawnRoses(x, y);
    else if (kind === "iceShard") this.spawnFrost(x, y);
    else this.spawnConfetti(x, y);
    if (this.fx.length > 360) this.fx.splice(0, this.fx.length - 360);
  }

  private spawnConfetti(x: number, y: number) {
    for (let i = 0; i < 82; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const spd = 240 + Math.random() * 430;
      this.fx.push({
        kind: "confetti",
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 46,
        vx: Math.cos(ang) * spd + (Math.random() - 0.5) * 130,
        vy: Math.sin(ang) * spd - 40,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        w: 8 + Math.random() * 13,
        h: 5 + Math.random() * 8,
        color: Game.CONFETTI_COLORS[(Math.random() * Game.CONFETTI_COLORS.length) | 0],
        life: 0,
        ttl: 1.7 + Math.random() * 1.1,
        swayA: 24 + Math.random() * 46,
        swayF: 1.6 + Math.random() * 1.8,
        swayP: Math.random() * Math.PI * 2,
        grow: 0,
      });
    }
  }

  /** Dym — wznoszący się, kłębiący pióropusz (styl kreskówkowy, dobrze widoczny). */
  private spawnSmoke(x: number, y: number) {
    const baseY = y + 90;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const col = (Math.random() - 0.5) * 2;
      this.fx.push({
        kind: "smoke",
        x: x + col * 22,
        y: baseY + (Math.random() - 0.5) * 26,
        vx: col * 30, // rozchodzi się na boki wznosząc się (pióropusz)
        vy: -95 - Math.random() * 60,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.9,
        w: 26 + Math.random() * 18,
        h: 0,
        color: SMOKE_COLORS[(Math.random() * SMOKE_COLORS.length) | 0],
        life: -(i / N) * 0.9,
        ttl: 1.5 + Math.random() * 1.0,
        swayA: 34 + Math.random() * 40,
        swayF: 0.7 + Math.random() * 0.8,
        swayP: Math.random() * Math.PI * 2,
        grow: 70 + Math.random() * 44,
      });
    }
  }

  /** Wystrzał płatków róż z punktu (x, y) — lecą w górę i na boki, potem
   *  opadają trzepocząc (Książę z bajki). Plus kilka dosypanych z góry, żeby
   *  efekt się utrzymał. */
  private spawnRoses(x: number, y: number) {
    for (let i = 0; i < 30; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4; // stożek w górę
      const spd = 260 + Math.random() * 340;
      this.fx.push({
        kind: "roses",
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 40,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 6,
        w: 15 + Math.random() * 12, // długość płatka
        h: 9 + Math.random() * 7, // szerokość
        color: ROSE_COLORS[(Math.random() * ROSE_COLORS.length) | 0],
        life: 0,
        ttl: 3.6 + Math.random() * 2,
        swayA: 46 + Math.random() * 60, // mocne trzepotanie
        swayF: 1.8 + Math.random() * 2.2,
        swayP: Math.random() * Math.PI * 2,
        grow: 0,
      });
    }
    // dosypka opadająca z góry — delikatny deszcz płatków po wybuchu
    for (let i = 0; i < 14; i++) {
      this.fx.push({
        kind: "roses",
        x: Math.random() * VW,
        y: -30 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 50,
        vy: 80 + Math.random() * 90,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 5,
        w: 15 + Math.random() * 12,
        h: 9 + Math.random() * 7,
        color: ROSE_COLORS[(Math.random() * ROSE_COLORS.length) | 0],
        life: -(i / 14) * 0.5,
        ttl: 4.5 + Math.random() * 2,
        swayA: 46 + Math.random() * 60,
        swayF: 1.8 + Math.random() * 2.2,
        swayP: Math.random() * Math.PI * 2,
        grow: 0,
      });
    }
  }

  /** Wystrzał odłamków lodu — combo co 10 przy „Byleby nie była ciepła".
   *  Lecą w górę i na boki, potem opadają; kilka „dosypanych" z góry, żeby
   *  efekt utrzymał się przez chwilę w tle. */
  private spawnFrost(x: number, y: number) {
    for (let i = 0; i < 46; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2; // stożek w górę
      const spd = 300 + Math.random() * 420;
      this.fx.push({
        kind: "iceShard",
        x: x + (Math.random() - 0.5) * 90,
        y: y + (Math.random() - 0.5) * 50,
        vx: Math.cos(ang) * spd + (Math.random() - 0.5) * 120,
        vy: Math.sin(ang) * spd,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 12,
        w: 5 + Math.random() * 10,
        h: 0,
        color: "#cfeeff",
        life: 0,
        ttl: 1.1 + Math.random() * 0.9,
        swayA: 10 + Math.random() * 22,
        swayF: 1.4 + Math.random() * 1.6,
        swayP: Math.random() * Math.PI * 2,
        grow: 0,
      });
    }
    for (let i = 0; i < 12; i++) {
      this.fx.push({
        kind: "iceShard",
        x: Math.random() * VW,
        y: -30 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 60,
        vy: 40 + Math.random() * 80,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8,
        w: 4 + Math.random() * 9,
        h: 0,
        color: "#cfeeff",
        life: -(i / 12) * 0.4,
        ttl: 2.2 + Math.random() * 1.2,
        swayA: 20 + Math.random() * 34,
        swayF: 0.8 + Math.random() * 1.0,
        swayP: Math.random() * Math.PI * 2,
        grow: 0,
      });
    }
  }

  private updateFx(dt: number) {
    if (!this.fx.length) return;
    const confDrag = Math.pow(0.55, dt);
    const roseDrag = Math.pow(0.85, dt); // opór poziomy
    const roseVDrag = Math.pow(0.4, dt); // opór pionowy — hamuje wystrzał, potem łagodny spadek
    const smokeXDrag = Math.pow(0.55, dt);
    const smokeYDrag = Math.pow(0.8, dt);
    for (const p of this.fx) {
      p.life += dt;
      if (p.life < 0) continue; // dym: czeka na swoją kolej emisji

      let sway = Math.sin(p.life * p.swayF + p.swayP) * p.swayA;
      if (p.kind === "confetti") {
        p.vy += 780 * dt;
        p.vx *= confDrag;
      } else if (p.kind === "roses") {
        // po wystrzale opór hamuje pęd, potem łagodne opadanie z trzepotaniem
        p.vx *= roseDrag;
        p.vy = p.vy * roseVDrag + 130 * dt;
      } else if (p.kind === "iceShard") {
        p.vx *= Math.pow(0.6, dt);
        p.vy += 900 * dt; // grawitacja — odłamki lecą i spadają
      } else {
        // dym: wznosi się, S-owy skręt (2 częstotliwości), rośnie umiarkowanie
        p.vx *= smokeXDrag;
        p.vy = p.vy * smokeYDrag - 4 * dt; // opór + minimalny wypór
        p.w += p.grow * dt;
        // curl narasta z wysokością (im wyżej, tym szerszy zawijas)
        const rise = Math.min(1, p.life / p.ttl);
        sway =
          (sway + Math.sin(p.life * p.swayF * 2.3 + p.swayP * 1.7) * p.swayA * 0.5) *
          (0.3 + 0.9 * rise);
      }
      p.x += (p.vx + sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.fx = this.fx.filter(
      (p) => p.life < p.ttl && p.y < this.sh() + 60 && p.y > -320,
    );
  }

  private drawFx(ctx: CanvasRenderingContext2D) {
    if (!this.fx.length) return;

    for (const p of this.fx) {
      if (p.kind !== "smoke" || p.life < 0) continue;
      const t = p.life / p.ttl;
      const inA = Math.min(1, p.life / 0.15);
      const outA = Math.pow(Math.max(0, 1 - t), 1.15); // rozwiewa się u góry
      const a = inA * outA * 0.62;
      if (a <= 0.004) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // 3 nachodzące garby → kłębiasta, nieregularna sylwetka
      for (const [ox, oy, rs] of [
        [0, 0, 1],
        [-0.55, 0.15, 0.72],
        [0.5, -0.1, 0.66],
      ] as [number, number, number][]) {
        const rr = p.w * rs;
        const cx = ox * p.w;
        const cy = oy * p.w;
        const g = ctx.createRadialGradient(cx, cy, rr * 0.15, cx, cy, rr);
        g.addColorStop(0, `rgba(${p.color},${a})`);
        g.addColorStop(0.55, `rgba(${p.color},${a * 0.7})`);
        g.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const p of this.fx) {
      if (p.kind === "smoke") continue; // narysowany wyżej

      const fade = p.life > p.ttl - 0.5 ? Math.max(0, (p.ttl - p.life) / 0.5) : 1;
      const flutter = Math.cos(p.life * 12 + p.x * 0.05);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

      if (p.kind === "roses") {
        // płatek: dwie krzywe, „trzepocze" przez skalowanie w poprzek
        ctx.scale(1, 0.45 + 0.55 * Math.abs(flutter));
        const l = p.w;
        const wdt = p.h;
        ctx.beginPath();
        ctx.moveTo(0, -l / 2);
        ctx.quadraticCurveTo(wdt, -l * 0.12, 0, l / 2);
        ctx.quadraticCurveTo(-wdt, -l * 0.12, 0, -l / 2);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = "rgba(90,10,25,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (p.kind === "iceShard") {
        // odłamek lodu — nieregularny trójkąt, lodowaty połysk
        const s = p.w;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, s * 0.5);
        ctx.lineTo(-s * 0.55, s * 0.7);
        ctx.closePath();
        const gg = ctx.createLinearGradient(-s, -s, s, s);
        gg.addColorStop(0, "rgba(255,255,255,0.95)");
        gg.addColorStop(1, "rgba(150,210,255,0.7)");
        ctx.fillStyle = gg;
        ctx.fill();
        ctx.strokeStyle = "rgba(120,180,235,0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // konfetti
        ctx.scale(1, 0.35 + 0.65 * Math.abs(flutter));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
  }

  private lastHoldTick = 0;
  private pulseHoldHaptics() {
    if (!this.held.some((h) => h)) return;
    if (this.songTime - this.lastHoldTick > 0.12) {
      this.lastHoldTick = this.songTime;
      haptic("holdTick");
    }
  }

  /** Realna wysokość widoku w jednostkach gry — zawsze skończona i >= VH. */
  private sh(): number {
    const v = viewport.vh;
    return Number.isFinite(v) && v >= VH ? Math.min(v, VH * 3) : VH;
  }

  /** Ile pikseli „nadmiaru wysokości" (ekran wyższy niż projekt 9:16). */
  private extraH(): number {
    return Math.max(0, this.sh() - VH);
  }

  /** Przesunięcie układu w pionie. „play" rysuje się w realnych współrzędnych
   *  ekranu (linia trafienia / klawisze liczone dynamicznie z `sh()` — patrz
   *  `hitY()`), więc bez offsetu; HUD siedzi wtedy przy górnej krawędzi, a tor
   *  rozciąga się na całą wysokość. Reszta ekranów wyśrodkowana; „hits"/„auth"
   *  przy górze. */
  private frameDY(): number {
    const extra = this.extraH();
    if (extra <= 0) return 0;
    if (this.scene === "play" || this.scene === "hits" || this.scene === "auth") return 0;
    return Math.round(extra / 2); // pozostałe ekrany — wyśrodkowane
  }

  /** Wyśrodkowanie menu pauzy w pionie (scena „play" rysuje się bez offsetu). */
  private pauseShift(): number {
    return Math.round(this.extraH() / 2);
  }

  /** Linia trafienia (puste kółka) — dosunięta do dołu ekranu. */
  private hitY(): number {
    return this.sh() - 162;
  }
  /** Dolna krawędź strefy klawiszy. */
  private padBot(): number {
    return this.sh() - 16;
  }
  /** Czas dojścia nuty od horyzontu do linii — skalowany z długością toru,
   *  żeby prędkość nut w pikselach była stała niezależnie od wysokości ekranu. */
  private approachSec(): number {
    return APPROACH * clamp((this.hitY() - HORIZON_Y) / (HIT_Y_BASE - HORIZON_Y), 1, 1.7);
  }

  /** Rect dolnego klastra „WYBIERZ HIT" dosunięty do dolnej krawędzi ekranu. */
  private hb(r: Rect): Rect {
    return { x: r.x, y: r.y + this.extraH(), w: r.w, h: r.h };
  }

  /** Wypełnia CAŁY widoczny obszar (także pas ponad/pod ramką UI). */
  private fillViewport(ctx: CanvasRenderingContext2D, style: string | CanvasGradient) {
    ctx.fillStyle = style;
    ctx.fillRect(0, -this.vdy, VW, this.sh());
  }

  /** Kręcący się złoty loader (kolor jak przyciski primary). */
  private drawSpinner(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = "round";
    // ślad
    ctx.lineWidth = r * 0.22;
    ctx.strokeStyle = "rgba(255,206,138,0.16)";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    // łuk — złoty gradient, obraca się
    ctx.rotate((t * 3.4) % (Math.PI * 2));
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#ffe27a");
    g.addColorStop(1, "#e8971c");
    ctx.strokeStyle = g;
    ctx.shadowColor = "rgba(255,180,60,0.55)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI * 0.15, Math.PI * 1.15);
    ctx.stroke();
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, VW, this.sh());
    this.vdy = this.frameDY();
    ctx.save();
    ctx.translate(0, this.vdy);
    switch (this.scene) {
      case "loading":
        this.drawLoading(ctx);
        break;
      case "auth":
        this.drawAuth(ctx);
        break;
      case "hits":
        this.drawHits(ctx);
        break;
      case "board":
        this.drawBoard(ctx);
        break;
      case "rewards":
        this.drawRewards(ctx);
        break;
      case "profile":
        this.drawProfile(ctx);
        break;
      case "play":
        this.drawPlay(ctx);
        break;
      case "results":
        this.drawResults(ctx);
        break;
    }

    if (this.soundModal) this.drawSoundModal(ctx);
    if (this.voteModal) this.drawVoteModal(ctx);
    if (this.offlineNotice && this.scene === "results") {
      this.drawModal(
        ctx,
        "📡",
        "BRAK POŁĄCZENIA",
        "Z powodu braku połączenia z internetem nie udało się zapisać wyniku do bazy.",
      );
    }

    if (this.preparing) {
      const secs = (performance.now() - this.prepStart) / 1000;
      // watchdog: nie zostawiaj gracza na zawsze na ekranie ładowania
      if (secs > 35) {
        this.loadError = `Wczytywanie utknęło na etapie: ${this.prepStep}. Sprawdź połączenie z serwerem i spróbuj ponownie.`;
        this.preparing = false;
        this.prepId++;
      } else {
        this.fillViewport(ctx, "rgba(4,4,10,0.8)");
        const cy = this.sh() / 2 - this.vdy;
        this.drawSpinner(ctx, VW / 2, cy - 34, 40);
        text(ctx, "stuknij, aby przerwać", VW / 2, cy + 58, { size: 21, color: "#8a7c6c" });
      }
    } else if (this.loadError && this.scene === "hits") {
      const lines = this.loadError.split("\n").flatMap((seg) => wrapText(seg, 46));
      lines.forEach((ln, i) =>
        text(ctx, ln, VW / 2, this.sh() - this.vdy - 150 + i * 24, { size: 16, color: "#ff8a97" }),
      );
    }

    ctx.restore();
  }

  // ---- wejście -------------------------------------------------------

  /** Który tor odpowiada współrzędnej x (tylko podczas gry). */
  laneAtX(x: number): number {
    if (this.scene !== "play") return -1;
    return clamp(Math.floor(x / (VW / LANES)), 0, LANES - 1);
  }

  onPress(lane: number, x: number, y: number) {
    // przelicz Y z układu ekranu na układ UI (ramka bywa przesunięta w pionie)
    y -= this.frameDY();
    if (this.preparing) return this.cancelPrepare();
    if (this.offlineNotice && this.scene === "results") {
      this.offlineNotice = false;
      return;
    }
    if (this.soundModal) {
      // to tylko potwierdzenie — dowolne stuknięcie zamyka.
      // Przy okazji odblokuj audio JUŻ TERAZ (czysty gest) — na iOS Safari
      // AudioContext trzeba stworzyć i wznowić w reakcji na dotknięcie.
      uiSound("buttons");
      void this.audio.unlock();
      this.soundModal = false;
      this.soundHintDone = true;
      return;
    }
    if (this.voteModal === "thanks") {
      if (!this.modalOkRect || inRect(this.modalOkRect, x, y)) {
        uiSound("buttons");
        this.voteModal = null;
      }
      return;
    }
    if (this.voteModal === "pick") {
      const hit = this.voteRects.find((v) => inRect(v.r, x, y));
      if (hit) {
        uiSound("buttons");
        submitVote(POLL_LEVEL6, hit.id);
        void enablePush(); // głos = świadoma zgoda na powiadomienia o nowej zawartości
        this.voteModal = "thanks";
      }
      return;
    }
    if (this.scene === "auth") return this.handleAuthTap(x, y);
    if (this.scene === "hits") return this.handleHitsTap(x, y);
    if (this.scene === "board") return this.handleBoardTap(x, y);
    if (this.scene === "rewards") return this.handleRewardsTap(x, y);
    if (this.scene === "profile") return this.handleProfileTap(x, y);
    if (this.scene === "results") return this.handleResultsTap(x, y);
    if (this.scene === "play") {
      if (this.paused) {
        if (this.resumeAt) return; // trwa odliczanie
        return this.handlePauseTap(x, y);
      }
      // lód: każde tapnięcie idzie w rozbijanie tafli (nie w tory, nie w pauzę)
      if (this.iceActive) return this.iceTap(x, y);
      if (x >= 0 && inRect(PAUSE_RECT, x, y)) return this.pauseGame();
      if (lane < 0 && x < 0) return; // np. spacja podczas gry
      if (lane < 0) lane = this.laneAtX(x);
      if (lane >= 0) this.pressLane(lane);
    }
  }

  /** Uruchamia „zamrożenie ekranu" — gra leci dalej w tle. */
  private triggerIce(taps: number) {
    this.iceActive = true;
    this.iceTapsLeft = Math.max(1, taps);
    this.iceStartAt = this.songTime;
    this.iceCracks = [];
    // puść trzymane nuty (jak przy pauzie) — nie da się ich utrzymać przez lód
    for (let l = 0; l < LANES; l++) {
      const h = this.held[l];
      if (h) {
        h.holding = false;
        h.judged = true;
        this.held[l] = null;
      }
    }
    this.shake = Math.max(this.shake, 9);
    haptic("flowUp");
    this.audio.sfx("iceForm");
  }

  private iceTap(x: number, y: number) {
    if (!this.iceActive || this.iceTapsLeft <= 0) return;
    this.iceTapsLeft--;
    this.iceCracks.push({
      x,
      y,
      a: Math.random() * Math.PI * 2,
      born: this.songTime,
      len: 70 + Math.random() * 60,
    });
    this.spawnIceShards(x, y, 6);
    this.shake = Math.max(this.shake, 4);
    haptic("holdTick");
    this.audio.sfx("iceCrack");
    if (this.iceTapsLeft <= 0) {
      this.iceActive = false;
      this.iceShatterAt = this.songTime;
      this.spawnIceShards(x, y, 26);
      this.shake = Math.max(this.shake, 16);
      haptic("combo");
      this.audio.sfx("iceShatter");
    }
  }

  private spawnIceShards(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 180 + Math.random() * 420;
      this.fx.push({
        kind: "iceShard",
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 120,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        w: 5 + Math.random() * 9,
        h: 0,
        color: "#cfeeff",
        life: 0,
        ttl: 0.6 + Math.random() * 0.6,
        swayA: 0,
        swayF: 0,
        swayP: 0,
        grow: 0,
      });
    }
  }

  onRelease(lane: number) {
    if (this.scene === "play" && lane >= 0) this.releaseLane(lane);
  }

  /** Sprzętowy „wstecz" (Android). true = obsłużone; false = można wyjść z apki. */
  handleBack(): boolean {
    if (this.voteModal) {
      uiSound("back");
      this.voteModal = null;
      return true;
    }
    if (this.soundModal) {
      uiSound("back");
      this.soundModal = false;
      this.soundHintDone = true;
      return true;
    }
    if (this.offlineNotice) {
      uiSound("back");
      this.offlineNotice = false;
      return true;
    }
    if (this.preparing) {
      uiSound("back");
      this.cancelPrepare();
      return true;
    }
    switch (this.scene) {
      case "board":
        uiSound("back");
        this.scene = this.boardFrom;
        return true;
      case "rewards":
      case "profile":
        uiSound("back");
        this.scene = "hits";
        return true;
      case "results":
        uiSound("back");
        this.enterHits();
        return true;
      case "play":
        if (this.paused) {
          if (this.resumeAt) return true; // trwa odliczanie — zignoruj
          uiSound("back");
          this.audio.stop();
          this.paused = false;
          this.scene = "hits";
        } else {
          uiSound("back");
          this.pauseGame();
        }
        return true;
      default:
        return false; // loading / auth / hits → wyjście z aplikacji
    }
  }

  /** Apka zeszła w tło — wstrzymaj rozgrywkę i dźwięk (nic się nie „przewija"). */
  onAppBackground() {
    if (this.scene === "play") {
      this.resumeAt = 0; // anuluj ewentualne odliczanie 3-2-1
      if (!this.paused) this.pauseGame();
      else this.audio.pause(); // już w menu pauzy — dobij suspend
    }
  }

  /** Apka wróciła na wierzch. NIE wznawiamy utworu automatycznie — jeśli byliśmy
   *  w grze, jesteśmy teraz w menu pauzy i gracz sam klika GRAJ!. */
  onAppForeground() {
    if (this.scene !== "play") void this.audio.resumePlayback();
    void syncPushState(); // user mógł cofnąć zgodę na powiadomienia w Ustawieniach
  }

  /** Wysokość natywnej klawiatury w px CSS (0 = schowana). Ekran logowania
   *  podnosi wtedy cały blok, żeby pole z focusem było nad klawiaturą. */
  private kbHeight = 0;
  onKeyboard(heightPx: number) {
    this.kbHeight = Math.max(0, heightPx || 0);
  }

  /** Szerokość głowy Denisa na ekranie auth — rośnie z zapasem wysokości. */
  private authHeadW(): number {
    return Math.round(clamp(AUTH_HEAD_W_MIN + this.extraH() * 0.55, AUTH_HEAD_W_MIN, AUTH_HEAD_W_MAX));
  }
  private authHeadH(): number {
    return Math.round(this.authHeadW() * AUTH_HEAD_AR);
  }
  /** Górna krawędź bloku auth (czubek głowy) przed przesunięciem. */
  private authTop(): number {
    return AUTH_F1_Y - AUTH_HEAD_GAP - this.authHeadH();
  }

  /** Pionowe przesunięcie całego bloku rejestracji/logowania.
   *  Cel: głowa ZAWSZE ma margines od góry (nie jest ucinana), a blok jest
   *  wyśrodkowany w dostępnej wysokości. Niezależne od tego, czy `extraH()`
   *  wyszło > 0 (na iOS Safari `innerHeight` bywa zaniżone). Liczone BEZ
   *  `authRects()`, żeby nie było rekurencji. */
  private authShift(): number {
    // klawiatura otwarta → podnieś blok tak, by pole HASŁA (f2) było tuż nad nią.
    // Głowa/przyciski mogą wtedy wyjechać poza kadr — to OK podczas pisania.
    if (this.kbHeight > 0) {
      const kbG = this.kbHeight / (viewport.scale || 1); // px klawiatury w jednostkach gry
      const f2Bottom = 368 + 86; // dolna krawędź pola hasła bez przesunięcia
      const want = this.sh() - kbG - 24 - f2Bottom; // 24 px zapasu nad klawiaturą
      const floor = 24 - 368; // nie wypychaj pola nicku wyżej niż 24 px od góry
      return Math.round(clamp(want, floor, this.authShiftResting()));
    }
    return this.authShiftResting();
  }

  /** Przesunięcie bloku auth przy schowanej klawiaturze (wyśrodkowanie). */
  private authShiftResting(): number {
    const bot = this.authMode === "register" ? AUTH_BOT_REG : AUTH_BOT_LOGIN;
    const top = this.authTop();
    const free = this.sh() - (bot - top); // wolne miejsce w pionie
    const centered = free / 2 - top; // przesunięcie centrujące blok
    const minShift = AUTH_MIN_TOP - top; // tyle, by głowa miała margines
    const maxShift = Math.max(minShift, this.sh() - bot - 12); // by dół nie uciekł z ekranu
    return Math.round(clamp(centered, minShift, maxShift));
  }

  /** Rozkład pól/przycisków ekranu „STWÓRZ KONTO" / „ZALOGUJ SIĘ". */
  private authRects() {
    const reg = this.authMode === "register";
    // pola i przyciski tej samej szerokości (jak w makiecie)
    const cx = 56;
    const cw = VW - 112;
    const btnH = 104;
    const dy = this.authShift();
    // pola blisko siebie w obu trybach (odstęp ~14 px jak w logowaniu)
    const f1: Rect = { x: cx, y: AUTH_F1_Y + dy, w: cw, h: 86 };
    const f2: Rect = { x: cx, y: 368 + dy, w: cw, h: 86 };
    if (reg) {
      return {
        f1,
        f2,
        hint: { x: cx, y: 468 + dy, w: cw, h: 66 } as Rect, // 2 linie pod hasłem
        terms: { x: cx, y: 552 + dy, w: cw, h: 76 } as Rect,
        primary: { x: cx, y: 648 + dy, w: cw, h: btnH } as Rect, // STWÓRZ KONTO
        altLabel: { x: cx, y: 786 + dy, w: cw, h: 34 } as Rect,
        alt1: { x: cx, y: 826 + dy, w: cw, h: btnH } as Rect, // ZALOGUJ SIĘ
        docT: { x: cx, y: 968 + dy, w: cw, h: 52 } as Rect,
        docP: { x: cx, y: 1026 + dy, w: cw, h: 52 } as Rect,
      };
    }
    return {
      f1,
      f2,
      primary: { x: cx, y: 512 + dy, w: cw, h: btnH } as Rect, // ZALOGUJ SIĘ
      altLabel: { x: cx, y: 668 + dy, w: cw, h: 34 } as Rect,
      alt1: { x: cx, y: 708 + dy, w: cw, h: btnH } as Rect, // STWÓRZ KONTO
      docT: { x: cx, y: 858 + dy, w: cw, h: 52 } as Rect,
      docP: { x: cx, y: 916 + dy, w: cw, h: 52 } as Rect,
    };
  }

  private setAuthMode(m: "login" | "register") {
    this.authMode = m;
    this.clearAuthError();
    this.authPassword = "";
    this.authShowPw = false;
    this.authLoginState = "";
    this.fields.clear(); // pola powstaną od nowa z właściwymi wartościami
  }

  private clearAuthError() {
    this.authError = "";
    this.authErrorField = null;
    this.authErrorCloseRect = null;
  }

  /** Ustawia komunikat błędu + zgaduje, którego pola dotyczy (czerwony obrys). */
  private setAuthError(msg: string) {
    this.authError = msg;
    const m = msg.toLowerCase();
    const pw = m.includes("hasł");
    const lg = m.includes("login") || m.includes("nick");
    this.authErrorField = pw && lg ? "both" : pw ? "password" : lg ? "login" : null;
  }

  /** Przelicza pozycje pól <input> (wołane przy resize / zmianie orientacji / klawiaturze). */
  repositionFields() {
    this.fields.reposition();
  }

  /** Czy użytkownik pisze teraz w polu tekstowym (klawiatura otwarta). */
  textInputActive(): boolean {
    return this.fields.isFocused();
  }

  /** Nakładka z prawdziwymi <input> — tylko na ekranie logowania. */
  private syncFields() {
    if (this.soundModal || this.scene !== "auth") {
      this.fields.clear();
      return;
    }
    this.fields.sync(this.authFieldSpecs());
  }

  private authFieldSpecs(): FieldSpec[] {
    const R = this.authRects() as Record<string, Rect | undefined>;
    const reg = this.authMode === "register";
    const specs: FieldSpec[] = [];
    if (R.f1) {
      specs.push({
        key: "loginname",
        type: "text",
        value: this.authLogin,
        placeholder: "Twój nick",
        autocomplete: "username",
        maxLength: 18,
        enterKeyHint: "next",
        x: R.f1.x, y: R.f1.y, w: R.f1.w, h: R.f1.h,
        status:
          reg && this.authLogin.length >= 3
            ? this.authLoginState === "free"
              ? "ok"
              : this.authLoginState === "taken"
                ? "bad"
                : null
            : null,
        error: this.authErrorField === "login" || this.authErrorField === "both",
        onInput: (v) => {
          this.authLogin = v.replace(/\s/g, "").slice(0, 18);
          this.clearAuthError();
          if (reg) this.queueLoginCheck();
        },
      });
    }
    if (R.f2) {
      specs.push({
        key: "pw",
        type: this.authShowPw ? "text" : "password",
        value: this.authPassword,
        placeholder: reg ? "Ustaw hasło" : "Hasło",
        autocomplete: reg ? "new-password" : "current-password",
        enterKeyHint: "go",
        x: R.f2.x, y: R.f2.y, w: R.f2.w, h: R.f2.h,
        error: this.authErrorField === "password" || this.authErrorField === "both",
        onInput: (v) => {
          this.authPassword = v;
          this.clearAuthError();
        },
        onEnter: () => this.submitAuth(),
        reveal: {
          revealed: this.authShowPw,
          onToggle: () => {
            this.authShowPw = !this.authShowPw;
          },
        },
      });
    }
    return specs;
  }

  /** Debounce sprawdzenia, czy login jest wolny (podpowiedź przy rejestracji). */
  private queueLoginCheck() {
    this.authLoginState = "";
    if (this.authCheckTimer) clearTimeout(this.authCheckTimer);
    const login = this.authLogin;
    if (!/^[\p{L}\p{N}._-]{3,18}$/u.test(login)) return;
    const seq = ++this.authCheckSeq;
    this.authLoginState = "checking";
    this.authCheckTimer = setTimeout(() => {
      void apiCheckLogin(login).then((free) => {
        if (seq !== this.authCheckSeq || this.authLogin !== login) return;
        this.authLoginState = free ? "free" : "taken";
      });
    }, 450);
  }

  /** Wysyła formularz (przycisk główny albo Enter w polu hasła). */
  private submitAuth() {
    if (this.authBusy) return;
    this.fields.blur();
    this.authBusy = true;
    const done = (r: { ok: boolean; error?: string }, fail: string) => {
      this.authBusy = false;
      if (r.ok) {
        this.clearAuthError();
        void this.syncSession(); // odtwórz postęp tego konta z serwera
        this.enterHitsFresh();
      } else {
        this.setAuthError(r.error ?? fail);
      }
    };
    if (this.authMode === "register") {
      void apiRegister(this.authLogin, this.authPassword, this.authPassword, {
        terms: this.authTerms,
      }).then((r) => done(r, "Nie udało się utworzyć konta."));
    } else {
      void apiLogin(this.authLogin, this.authPassword).then((r) =>
        done(r, "Logowanie nie powiodło się."),
      );
    }
  }

  private handleAuthTap(x: number, y: number) {
    if (x < 0) return; // klawiatura / spacja — nic nie rób
    // stuknięcie w canvas = poza polami (pola i oczko to elementy DOM) → chowamy klawiaturę
    this.fields.blur();

    // ✕ na banerze błędu (u góry ekranu)
    if (this.authError && this.authErrorCloseRect && inRect(this.authErrorCloseRect, x, y)) {
      uiSound("back");
      this.clearAuthError();
      return;
    }
    const R = this.authRects() as Record<string, Rect | undefined>;

    if (R.docT && inRect(R.docT, x, y)) {
      uiSound("buttons");
      return void openDoc(DOC_TERMS_URL);
    }
    if (R.docP && inRect(R.docP, x, y)) {
      uiSound("buttons");
      return void openDoc(DOC_PRIVACY_URL);
    }
    if (R.terms && inRect(R.terms, x, y)) {
      uiSound("buttons");
      this.authTerms = !this.authTerms;
      if (this.authTerms) this.clearAuthError();
      return;
    }
    if (R.alt1 && inRect(R.alt1, x, y)) {
      uiSound("buttons");
      return this.setAuthMode(this.authMode === "login" ? "register" : "login");
    }
    if (R.primary && inRect(R.primary, x, y)) {
      uiSound("buttons");
      this.submitAuth();
    }
  }

  // ---- WYBIERZ HIT (karuzela poziomów) --------------------------------

  /** Najwyższy index strony dostępny w karuzeli. */
  private maxHitIndex(): number {
    if (devUnlocked()) return SONGS.length - 1; // konto Konrad — wszystkie poziomy
    const lastPublic = SONGS.map((s) => !s.devOnly).lastIndexOf(true);
    return Math.max(1, Math.min(lastPublic, clearedStreak() + 1));
  }

  private enterHits() {
    this.hitIndex = Math.min(this.hitIndex, this.maxHitIndex());
    this.scene = "hits";
    this.preloadHitAudio();
  }

  /** W tle dekoduje audio bieżącego poziomu, żeby GRAJ! startował bez czekania. */
  private preloadedAudioFor = "";
  private preloadHitAudio() {
    const meta = SONGS[this.hitIndex];
    if (!meta || !meta.playable || !levelUnlocked(this.hitIndex) || this.preloadedAudioFor === meta.id) return;
    this.preloadedAudioFor = meta.id;
    void (async () => {
      try {
        const song = await loadTrack(meta.id);
        // tylko pobierz bajty — NIE twórz AudioContextu w tle (iOS Safari:
        // kontekst musi powstać w geście GRAJ!, inaczej zostaje „suspended")
        if (song.audioUrl) await this.audio.prefetch(song.audioUrl);
      } catch {
        /* brak sieci / nie ma pliku — trudno, poleci przy GRAJ! */
      }
    })();
  }

  private handleHitsTap(x: number, y: number) {
    if (x < 0) return;
    if (inRect(HIT_GEAR, x, y)) {
      uiSound("buttons");
      this.scene = "profile";
      void syncPushState(); // przełącznik ma odbić stan zgód systemowych
      return;
    }
    if (inRect(HIT_ARROW_L, x, y)) {
      if (this.hitIndex > 0) {
        uiSound("buttons");
        this.hitIndex--;
        this.preloadHitAudio();
      }
      return;
    }
    if (inRect(HIT_ARROW_R, x, y)) {
      if (this.hitIndex < this.maxHitIndex()) {
        uiSound("buttons");
        this.hitIndex++;
        this.preloadHitAudio();
      }
      return;
    }
    const meta = SONGS[this.hitIndex];
    if (!meta) return;

    // utwór „wkrótce": „Powiadom mnie" (górny) + odsłuch na Spotify (dolny)
    if (!meta.playable) {
      const wide = { x: MARGIN, y: HIT_GRAJ.y, w: VW - MARGIN * 2, h: HIT_GRAJ.h };
      const spotBelow = { x: MARGIN, y: HIT_RES.y, w: VW - MARGIN * 2, h: HIT_REW.h };
      if (inRect(this.hb(wide), x, y)) {
        uiSound("buttons");
        // „Powiadom mnie" → najpierw głosowanie „jaki poziom 6?", potem zgoda
        if (!votedChoice(POLL_LEVEL6)) this.voteModal = "pick";
        else if (!pushOptedInSync()) void enablePush();
        return;
      }
      if (inRect(this.hb(spotBelow), x, y)) {
        uiSound("buttons");
        const url = spotifyUrl(meta.id);
        if (url) openExternal(url);
      }
      return;
    }

    if (inRect(this.hb(HIT_REW), x, y)) {
      uiSound("buttons");
      this.scene = "rewards";
      return;
    }

    if (meta.playable && inRect(this.hb(HIT_RES), x, y)) {
      uiSound("buttons");
      this.boardSongId = meta.id;
      this.boardFrom = "hits";
      this.scene = "board";
      void refreshBoard(this.boardSongId, this.boardPeriod);
      return;
    }
    if (inRect(this.hb(HIT_GRAJ), x, y) && meta.playable && levelUnlocked(this.hitIndex)) {
      uiSound("play");
      // odblokuj audio JESZCZE w geście dotknięcia (kluczowe dla iOS)
      void this.audio.unlock();
      this.trackId = meta.id;
      this.burstFx(this.comboFxKind(), VW / 2, 660); // efekt jak dla combo tego utworu
      haptic("combo");
      void this.startPlay();
    }
  }

  /** Przesunięcie palcem w bok na karuzeli „WYBIERZ HIT". */
  onSwipe(dir: 1 | -1) {
    if (this.scene !== "hits" || this.preparing || this.soundModal) return;
    const next = this.hitIndex + dir;
    if (dir < 0 && next >= 0) {
      this.hitIndex = next;
      this.preloadHitAudio();
    } else if (dir > 0 && next <= this.maxHitIndex()) {
      this.hitIndex = next;
      this.preloadHitAudio();
    }
  }

  private handleBoardTap(x: number, y: number) {
    if (x < 0 || inRect(BOARD_BACK, x, y)) {
      uiSound("back");
      this.scene = this.boardFrom;
      return;
    }
    if (inRect(BOARD_TAB_M, x, y) && this.boardPeriod !== "month") {
      uiSound("buttons");
      this.boardPeriod = "month";
      void refreshBoard(this.boardSongId, "month");
      return;
    }
    if (inRect(BOARD_TAB_A, x, y) && this.boardPeriod !== "all") {
      uiSound("buttons");
      this.boardPeriod = "all";
      void refreshBoard(this.boardSongId, "all");
    }
  }

  private handleRewardsTap(x: number, y: number) {
    if (x < 0 || inRect(BACK, x, y) || inRect(REW_HOME, x, y)) {
      uiSound("back");
      this.scene = "hits";
    }
  }

  private handleProfileTap(x: number, y: number) {
    if (x < 0 || inRect(BACK, x, y)) {
      uiSound("back");
      this.scene = "hits";
      return;
    }
    if (inRect(SET_TERMS, x, y)) {
      uiSound("buttons");
      return void openDoc(DOC_TERMS_URL);
    }
    if (inRect(SET_PRIV, x, y)) {
      uiSound("buttons");
      return void openDoc(DOC_PRIVACY_URL);
    }
    if (inRect(SET_MAIL, x, y)) {
      uiSound("buttons");
      return void openDoc(`mailto:${SUPPORT_EMAIL}`);
    }
    if (inRect(SET_PUSH, x, y)) {
      uiSound("buttons");
      if (pushOptedInSync()) void disablePush();
      else void enablePush();
      return;
    }
    if (inRect(SET_LOGOUT, x, y)) {
      uiSound("back");
      // TYLKO wylogowanie — konto, wyniki i postęp zostają na serwerze i wrócą
      // po ponownym zalogowaniu. Kasujemy jedynie lokalną kopię na tym urządzeniu.
      clearSession();
      this.hitIndex = 0;
      this.gotoStart();
      return;
    }
    if (inRect(SET_DELETE, x, y)) {
      let sure = false;
      try {
        sure = !!window.confirm?.(
          "Usunąć konto oraz cały postęp i wyniki na tym urządzeniu? Tej operacji nie można cofnąć.",
        );
      } catch {
        sure = false;
      }
      if (sure) {
        deleteAccount();
        this.hitIndex = 0;
        this.gotoStart();
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
    const idx = SONGS.findIndex((s) => s.id === this.trackId);

    // KONTYNUUJ → karuzela: następny poziom gdy zaliczony TERAZ i odblokowany,
    // inaczej ten sam (do poprawy wyniku / ponownej próby)
    if (x < 0 || inRect(RES_PRIMARY, x, y)) {
      uiSound("buttons");
      const canAdvance = passed && idx >= 0 && levelUnlocked(idx + 1);
      this.hitIndex = clamp(canAdvance ? idx + 1 : Math.max(0, idx), 0, this.maxHitIndex());
      this.enterHits();
      return;
    }
    if (inRect(RES_SPOTIFY, x, y)) {
      uiSound("buttons");
      const url = spotifyUrl(this.trackId);
      if (url) openExternal(url);
      return;
    }
    if (inRect(RES_BOARD, x, y)) {
      uiSound("buttons");
      this.boardSongId = this.trackId;
      this.boardFrom = "results";
      this.scene = "board";
      void refreshBoard(this.boardSongId, this.boardPeriod);
    }
  }

  // ---- przejścia stanów --------------------------------------------

  private async startPlay() {
    if (this.preparing) return;
    this.soundModal = false;
    this.audio.stop(); // ucisz ewentualny poprzedni przebieg zanim ruszymy nowy
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
      this.character.load({ character: song.character, characters: song.characters });

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
    // `this.fx` NIE czyścimy — efekt z przycisku GRAJ! ma dolecieć w trakcie
    // odliczania 3-2-1 (róże/dym opadają jeszcze przez chwilę). Cząstki i tak gasną.
    this.shake = 0;
    this.bannerAt = -10;
    this.flowUpAt = -10;
    this.lastHoldTick = 0;
    this.resultStarSeen = 0;
    this.paused = false;
    this.resumeAt = 0;
    this.resultsSavedBest = false;
    this.songTime = 0;
    this.scene = "play";
    this.preparing = false;
    markDiscovered(this.song.id);
    // audio odblokowane w geście GRAJ! → startujemy od razu, bez ekranu „stuknij"
    this.beginSong();
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
    y -= this.pauseShift(); // menu pauzy jest wyśrodkowane w pionie
    if (x < 0 || inRect(PZ_RESUME, x, y)) {
      uiSound("play");
      this.resumeAt = performance.now() + 3050; // pełne odliczanie 3-2-1
      return;
    }
    if (inRect(PZ_RESTART, x, y)) {
      uiSound("buttons");
      this.paused = false;
      void this.startPlay();
      return;
    }
    if (inRect(PZ_MENU, x, y)) {
      uiSound("back");
      this.audio.stop();
      this.paused = false;
      this.scene = "hits";
    }
  }

  /** Uruchamia utwór z bieżącego gestu użytkownika (odblokowuje audio na iOS). */
  private songStartedAt = 0; // performance.now() startu utworu — dla watchdoga

  private beginSong() {
    this.awaitingStart = false;
    this.songTime = 0;
    this.iceActive = false;
    this.iceTapsLeft = 0;
    this.iceCracks = [];
    this.evFired.clear();
    this.iceStartAt = -10;
    this.iceShatterAt = -10;
    this.spotlightStart = -10;
    this.spotlightUntil = -10;
    this.audio.stop(); // ucisz poprzedni przebieg (pauza → „OD NOWA" nie nakłada dźwięku)
    try {
      void this.audio.ctx?.resume?.();
    } catch {
      /* ignore */
    }
    this.audio.start(this.song);
    this.songStartedAt = performance.now();
  }

  /** Przerywa trwające wczytywanie i wraca do karuzeli. */
  private cancelPrepare() {
    this.prepId++;
    this.preparing = false;
    this.loadError = "";
    this.songStartedAt = 0;
    this.audio.stop();
    this.scene = "hits";
  }

  private finish() {
    this.audio.stop();
    this.resultsAt = performance.now();
    if (!this.resultsSavedBest) {
      this.resultsSavedBest = true;
      if (this.score > bestScore()) {
        try {
          localStorage.setItem("denis.best", String(this.score));
        } catch {
          /* ignore */
        }
      }
      const gained = Math.floor(this.starFill());
      this.resultRank = submitScore(this.trackId, this.score, gained);
      recordStars(this.trackId, gained);
      // submitScore -> postScore odświeża obie zakładki po zapisie
      // brak internetu → wynik nie trafił do bazy (info na podsumowaniu)
      let online = true;
      try {
        online = navigator.onLine !== false;
      } catch {
        /* ignore */
      }
      this.offlineNotice = !online;
    }
    this.scene = "results";
  }

  /** Sceny wymagające pełnych ~60 kl./s (rozgrywka + animacja licznika wyniku). */
  highFps(): boolean {
    if (this.scene === "play") return true;
    if (this.scene === "results" && performance.now() - this.resultsAt < 2600) return true;
    return false;
  }

  // ---- logika rytmiczna -------------------------------------------

  /** Automatyczna kalibracja: opóźnienie wyjścia audio (BT, bufor OS). Bez ręcznego ustawiania. */
  private offsetSec() {
    const c = this.audio.ctx as (AudioContext & { outputLatency?: number }) | null;
    const l = c?.outputLatency ?? c?.baseLatency ?? 0.03;
    return typeof l === "number" && isFinite(l) ? clamp(l, 0, 0.4) : 0.03;
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
    // próg combo co 10 — wybuch confetti za postacią + mocna wibracja
    if (this.combo >= 10 && this.combo % 10 === 0) {
      this.shake = Math.max(this.shake, 6);
      this.audio.sfx("combo");
      haptic("combo");
      this.pushBanner(`COMBO ×${this.combo}`);
      const cy = (this.song.characterY ?? 706) - 210 * (this.song.characterScale ?? 1);
      this.burstFx(this.comboFxKind(), VW / 2, cy);
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

  // ---- projekcja perspektywiczna toru ---------------------------
  //
  // `e` (0..~1.4): 0 = horyzont (daleko), 1 = linia trafienia, >1 = strefa
  // klawiszy pod linią. Wszystko jest liniowe względem `e`, więc krawędzie
  // torów to proste; wrażenie 3D daje easing czasu w `eForTime`.

  private eForTime(t: number): number {
    const rel = (t - this.songTime) / this.approachSec(); // 1 = świeżo, 0 = na linii
    const travel = 1 - rel; // 0 daleko, 1 na linii
    if (travel <= 0) return travel * 0.6; // nuta zeszła poniżej linii
    if (travel >= 1) return 1 + (travel - 1) * 1.6;
    // łagodne przyspieszenie perspektywiczne (blisko liniowe u dołu)
    return Math.pow(travel, 1.32);
  }

  private yForE(e: number): number {
    return HORIZON_Y + e * (this.hitY() - HORIZON_Y);
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

  private drawStage(ctx: CanvasRenderingContext2D, darken: number, pulse: number, plain = false) {
    // w grze z animowaną postacią i bez własnego tła: czysta ciemna scena
    // (żeby nie było drugiego Denisa z domyślnego zdjęcia)
    const top = -this.vdy;
    const vh = this.sh();
    const img = this.songBg ?? (plain ? null : this.bgReady ? this.bg : null);
    if (img && img.width) {
      const iw = img.width;
      const ih = img.height;
      const scale = Math.max(VW / iw, vh / ih) * (1 + pulse * 0.015);
      const w = iw * scale;
      const h = ih * scale;
      ctx.drawImage(img, (VW - w) / 2, top + (vh - h) / 2 - 20, w, h);
    } else {
      const bgg = ctx.createLinearGradient(0, top, 0, top + vh);
      bgg.addColorStop(0, "#1a1520");
      bgg.addColorStop(0.5, "#12101a");
      bgg.addColorStop(1, "#0a0810");
      this.fillViewport(ctx, bgg);
    }
    const g = ctx.createLinearGradient(0, top, 0, top + vh);
    g.addColorStop(0, `rgba(5,5,12,${0.35 + darken * 0.4})`);
    g.addColorStop(0.55, `rgba(5,5,12,${0.15 + darken * 0.35})`);
    g.addColorStop(1, `rgba(5,5,12,${0.75 + darken * 0.2})`);
    this.fillViewport(ctx, g);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const lightY = top + this.sh() * 0.32;
    const lights: [number, number][] = [
      [VW * 0.12, lightY],
      [VW * 0.88, lightY],
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
    this.fillViewport(ctx, "#07070d");
    this.drawSpinner(ctx, VW / 2, this.sh() / 2 - this.vdy, 34);
  }

  // ---- ekran: rejestracja / logowanie --------------------------
  // Pola (ramka + wartość + oczko) to elementy DOM z `FieldOverlay` ułożone na
  // prostokątach f1/f2 — dzięki temu na telefonie wysuwa się natywna klawiatura.

  /** Kwadratowy checkbox z etykietą, wyrównaną w pionie do środka pola. */
  private checkboxRow(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    on: boolean,
    lines: string[],
  ) {
    const cs = 38;
    const cx0 = r.x;
    const cyMid = r.y + r.h / 2;
    const cy0 = cyMid - cs / 2;
    ctx.save();
    ctx.fillStyle = on ? "#ff9f43" : "rgba(255,255,255,0.12)";
    roundRect(ctx, cx0, cy0, cs, cs, 10);
    ctx.fill();
    ctx.strokeStyle = on ? "#ffc471" : "rgba(255,255,255,0.42)";
    ctx.lineWidth = 2.5;
    roundRect(ctx, cx0, cy0, cs, cs, 10);
    ctx.stroke();
    if (on) {
      ctx.strokeStyle = "#1a0d12";
      ctx.lineWidth = 4.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cx0 + 9, cyMid + 1);
      ctx.lineTo(cx0 + 16, cyMid + 9);
      ctx.lineTo(cx0 + 30, cyMid - 9);
      ctx.stroke();
    }
    ctx.restore();
    const tx = cx0 + cs + 18;
    const lh = 26;
    const startY = cyMid - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, i) =>
      text(ctx, ln, tx, startY + i * lh, {
        size: 19,
        align: "left",
        weight: "700",
        color: "#e6d6c3",
      }),
    );
  }

  private authLink(ctx: CanvasRenderingContext2D, r: Rect, label: string, color = "#ffce8a") {
    text(ctx, label, r.x + r.w / 2, r.y + r.h / 2, {
      size: 21,
      weight: "900",
      font: HEAD_FONT,
      color,
      letterSpacing: "2px",
    });
  }

  private drawAuth(ctx: CanvasRenderingContext2D) {
    this.drawUiBg(ctx);
    const R = this.authRects() as Record<string, Rect | undefined>;
    const reg = this.authMode === "register";

    // głowa Denisa na górze (zamiast nagłówka „STWÓRZ KONTO / ZALOGUJ SIĘ")
    // — na wyższych ekranach większa
    const head = this.uiImg("head.png");
    if (imgReady(head)) {
      const hw = this.authHeadW();
      const hh = hw * (head.naturalHeight / head.naturalWidth);
      const headBottom = (R.f1?.y ?? AUTH_F1_Y) - AUTH_HEAD_GAP; // odstęp nad pierwszym polem
      ctx.drawImage(head, VW / 2 - hw / 2, headBottom - hh, hw, hh);
    } else {
      text(ctx, reg ? "STWÓRZ KONTO" : "ZALOGUJ SIĘ", VW / 2, 150, {
        size: 58,
        weight: "900",
        font: HEAD_FONT,
        color: "#fff7ec",
        shadows: HEAD_SHADOWS,
        letterSpacing: "2px",
      });
    }

    // dostępność loginu pokazuje ikona ✓/✗ w polu (FieldSpec.status) — bez tekstu obok

    // info pod hasłem (rejestracja): wymagania + brak odzyskiwania
    if (R.hint) {
      text(
        ctx,
        "Min. 8 znaków, wielka litera i znak specjalny.",
        R.hint.x + 4,
        R.hint.y + 12,
        { size: 18, align: "left", color: "#d3c3b2" },
      );
      text(
        ctx,
        "Hasła nie odzyskasz. Zapisz je w bezpiecznym miejscu.",
        R.hint.x + 4,
        R.hint.y + 42,
        { size: 18, align: "left", color: "#c3ae9a" },
      );
    }

    // zgoda (rejestracja)
    if (R.terms) {
      this.checkboxRow(ctx, R.terms, this.authTerms, [
        "Akceptuję Regulamin i Politykę prywatności",
      ]);
    }

    // przyciski — oba z PNG, identycznych rozmiarów
    if (R.primary) {
      this.uiButton(ctx, R.primary, reg ? "stworz-konto" : "zaloguj-sie", {
        fallback: reg ? "STWÓRZ KONTO" : "ZALOGUJ SIĘ",
      });
    }
    if (R.altLabel) {
      text(ctx, reg ? "Masz już konto?" : "Nie masz jeszcze konta?", VW / 2, R.altLabel.y + 17, {
        size: 23,
        weight: "800",
        color: "#f0e2d0",
      });
    }
    if (R.alt1) {
      this.uiButton(ctx, R.alt1, reg ? "zaloguj-sie" : "stworz-konto", {
        fallback: reg ? "ZALOGUJ SIĘ" : "STWÓRZ KONTO",
      });
    }

    // dokumenty
    if (R.docT) this.authLink(ctx, R.docT, "REGULAMIN", "#ffb64a");
    if (R.docP) this.authLink(ctx, R.docP, "POLITYKA PRYWATNOŚCI", "#ffb64a");

    // komunikat błędu — miękki czerwony baner u góry, szerokość jak input, z ✕
    if (this.authError) {
      const bx = 56;
      const bw = VW - 112; // ta sama szerokość co pola / przyciski
      const lines = wrapText(this.authError, 40); // zawija dopiero gdy naprawdę długie
      const size = 25;
      const lh = 33;
      const padV = 20;
      const bh = Math.max(78, lines.length * lh + padV * 2);
      const by = 20;

      ctx.save();
      ctx.fillStyle = "rgba(150,16,16,0.36)";
      roundRect(ctx, bx, by, bw, bh, 16);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ff2323";
      roundRect(ctx, bx, by, bw, bh, 16);
      ctx.stroke();
      ctx.restore();

      const close: Rect = { x: bx + bw - 52, y: by + 6, w: 46, h: 46 };
      this.authErrorCloseRect = close;

      const blockTop = by + (bh - lines.length * lh) / 2;
      lines.forEach((ln, i) =>
        text(ctx, ln, bx + 22, blockTop + lh / 2 + i * lh, {
          size,
          weight: "900",
          color: "#ff4242",
          align: "left",
        }),
      );

      ctx.save();
      ctx.strokeStyle = "#ff8a8a";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      const ccx = close.x + close.w / 2;
      const ccy = close.y + close.h / 2;
      const cr = 12;
      ctx.beginPath();
      ctx.moveTo(ccx - cr, ccy - cr);
      ctx.lineTo(ccx + cr, ccy + cr);
      ctx.moveTo(ccx + cr, ccy - cr);
      ctx.lineTo(ccx - cr, ccy + cr);
      ctx.stroke();
      ctx.restore();
    } else {
      this.authErrorCloseRect = null;
    }

    if (this.authBusy) {
      text(ctx, "Łączę z serwerem…", VW / 2, VH - 44, { size: 17, weight: "800", color: "#ffce8a" });
    }
  }

  // ---- ekran: tablica wyników (per utwór, wejście z karuzeli) ----------

  private drawBoard(ctx: CanvasRenderingContext2D) {
    this.drawUiBg(ctx);
    const meta = SONGS.find((s) => s.id === this.boardSongId);
    text(ctx, (meta?.title ?? "").toUpperCase(), VW / 2, 84, {
      size: 32,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      shadows: HEAD_SHADOWS,
    });

    // zakładki: TEN MIESIĄC | WSZYSTKIE
    const tab = (r: Rect, label: string, active: boolean) => {
      ctx.fillStyle = active ? "#ff9f43" : "rgba(255,255,255,0.07)";
      roundRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      if (!active) {
        ctx.strokeStyle = "rgba(255,206,138,0.28)";
        ctx.lineWidth = 2;
        roundRect(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.stroke();
      }
      text(ctx, label, r.x + r.w / 2, r.y + r.h / 2, {
        size: 19,
        weight: "900",
        font: HEAD_FONT,
        color: active ? "#1a0d12" : "#c9b7a6",
        letterSpacing: "1px",
      });
    };
    tab(BOARD_TAB_M, "TEN MIESIĄC", this.boardPeriod === "month");
    tab(BOARD_TAB_A, "WSZYSTKIE", this.boardPeriod === "all");

    const rows = topN(this.boardSongId, this.boardPeriod, 10);
    const rowH = 52;
    const drawRow = (r: { rank: number; nick: string; score: number; me?: boolean }, ry: number) => {
      if (r.me) {
        ctx.fillStyle = "rgba(255,159,67,0.18)";
        roundRect(ctx, MARGIN - 6, ry - rowH / 2 + 3, VW - (MARGIN - 6) * 2, rowH - 6, 12);
        ctx.fill();
      }
      const col = r.me ? "#ffce8a" : "#fff";
      const medal =
        r.rank === 1 ? "#ffd24c" : r.rank === 2 ? "#cfd8e6" : r.rank === 3 ? "#e0a878" : "#9a8c7e";
      text(ctx, `${r.rank}`, MARGIN + 12, ry, { size: 22, align: "left", weight: "800", color: medal });
      text(ctx, r.nick + (r.me ? "  (Ty)" : ""), MARGIN + 72, ry, { size: 21, align: "left", color: col });
      text(ctx, r.score.toLocaleString("pl-PL"), VW - MARGIN - 12, ry, {
        size: 21,
        align: "right",
        weight: "700",
        color: col,
      });
    };

    let y = 226;
    rows.forEach((r) => {
      drawRow(r, y);
      y += rowH;
    });

    const me = myEntry(this.boardSongId, this.boardPeriod);

    // moja pozycja poza TOP 10 — pod cienką kreską
    if (me && me.rank > 10) {
      const ly = y + 6;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN + 8, ly);
      ctx.lineTo(VW - MARGIN - 8, ly);
      ctx.stroke();
      drawRow({ rank: me.rank, nick: me.nick, score: me.score, me: true }, ly + 6 + rowH / 2);
    }

    // TWÓJ NAJLEPSZY WYNIK
    const b = BOARD_BEST;
    ctx.fillStyle = "rgba(255,159,67,0.14)";
    roundRect(ctx, b.x, b.y, b.w, b.h, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,206,138,0.42)";
    ctx.lineWidth = 2;
    roundRect(ctx, b.x, b.y, b.w, b.h, 16);
    ctx.stroke();
    text(ctx, "TWÓJ NAJLEPSZY WYNIK", VW / 2, b.y + 30, {
      size: 16,
      weight: "800",
      color: "#ffce8a",
      letterSpacing: "3px",
    });
    if (me) {
      text(ctx, me.score.toLocaleString("pl-PL"), VW / 2, b.y + 76, {
        size: 42,
        weight: "900",
        font: HEAD_FONT,
        color: "#fff7ec",
        shadows: HEAD_SHADOWS,
      });
      text(ctx, `miejsce ${me.rank}`, VW / 2, b.y + 114, {
        size: 18,
        weight: "700",
        color: "#c9b7a6",
      });
    } else {
      text(ctx, "—", VW / 2, b.y + 76, { size: 42, weight: "900", font: HEAD_FONT, color: "#6b6055" });
      text(
        ctx,
        this.boardPeriod === "month" ? "zagraj tę rundę w tym miesiącu" : "zagraj tę rundę",
        VW / 2,
        b.y + 114,
        { size: 16, color: "#9a8c7e" },
      );
    }

    this.uiButton(ctx, BOARD_BACK, "powrot", { fallback: "POWRÓT" });
  }

  // ---- modal „włącz dźwięk" ----------------------------------

  /** Uniwersalny modal (ikona + tytuł + treść + przycisk ROZUMIEM). */
  private drawModal(
    ctx: CanvasRenderingContext2D,
    icon: string,
    title: string,
    body: string,
    okKey = "rozumiem",
    okFallback = "ROZUMIEM",
  ) {
    this.fillViewport(ctx, "rgba(4,4,10,0.82)");
    const pw = VW - 120;
    const px = 60;
    const lines = wrapText(body, 30);
    const lineH = 34;
    const bodyStart = 210;
    const bodyEnd = bodyStart + (lines.length - 1) * lineH + 18;
    const gap = 28; // oddech między tekstem a przyciskiem
    const btnH = MODAL_OK.h;
    const ph = bodyEnd + gap + btnH + 44;
    const py = (VH - ph) / 2;
    ctx.fillStyle = "#15121c";
    roundRect(ctx, px, py, pw, ph, 26);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,180,90,0.55)";
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, pw, ph, 26);
    ctx.stroke();

    text(ctx, icon, VW / 2, py + 76, { size: 62 });
    text(ctx, title, VW / 2, py + 154, {
      size: 38,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      shadows: HEAD_SHADOWS,
    });
    lines.forEach((ln, i) =>
      text(ctx, ln, VW / 2, py + bodyStart + i * lineH, { size: 20, color: "#c9b7a6" }),
    );
    // przycisk — zapamiętany prostokąt, żeby trafienie zgadzało się z rysunkiem
    this.modalOkRect = {
      x: VW / 2 - MODAL_OK.w / 2,
      y: py + bodyEnd + gap,
      w: MODAL_OK.w,
      h: btnH,
    };
    this.uiButton(ctx, this.modalOkRect, okKey, { fallback: okFallback });
  }

  /** Modal głosowania „Do czego chcesz się pobawić na Poziomie 6?" —
   *  pokazywany po kliknięciu „Powiadom mnie" na ekranie utworu „wkrótce". */
  private drawVoteModal(ctx: CanvasRenderingContext2D) {
    if (this.voteModal === "thanks") {
      this.drawModal(
        ctx,
        "🎉",
        "DZIĘKUJEMY!",
        "Dziękuję za udział w głosowaniu! Nie usuwaj aplikacji, abyśmy mogli wysłać Ci powiadomienie o nowych poziomach.",
        "ok",
        "OK",
      );
      return;
    }
    this.fillViewport(ctx, "rgba(4,4,10,0.86)");
    const pw = VW - 96;
    const px = 48;
    const titleLines = wrapText("Do czego chcesz się pobawić na Poziomie 6?", 22);
    const btnH = 82;
    const gap = 16;
    const titleTop = 92;
    const listTop = titleTop + titleLines.length * 42 + 26;
    const ph = listTop + POLL_LEVEL6_OPTIONS.length * (btnH + gap) - gap + 40;
    const py = Math.max(36, (VH - ph) / 2);

    ctx.fillStyle = "#15121c";
    roundRect(ctx, px, py, pw, ph, 26);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,180,90,0.55)";
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, pw, ph, 26);
    ctx.stroke();

    titleLines.forEach((ln, i) =>
      text(ctx, ln, VW / 2, py + titleTop + i * 42, {
        size: 30,
        weight: "900",
        font: HEAD_FONT,
        color: "#fff7ec",
        shadows: HEAD_SHADOWS,
      }),
    );

    this.voteRects = [];
    const bw = pw - 88;
    POLL_LEVEL6_OPTIONS.forEach((o, i) => {
      const r: Rect = { x: VW / 2 - bw / 2, y: py + listTop + i * (btnH + gap), w: bw, h: btnH };
      this.styledBtn(ctx, r, o.label, "gold");
      this.voteRects.push({ r, id: o.id });
    });
  }

  private drawSoundModal(ctx: CanvasRenderingContext2D) {
    this.drawModal(
      ctx,
      "🔊",
      "WŁĄCZ DŹWIĘK",
      "Ustaw telefon na dźwięk i wyłącz tryb cichy, gra działa w rytm muzyki.",
    );
  }

  // ---- wspólne elementy UI ----------------------------------

  private uiImg(name: string): HTMLImageElement {
    return loadImg(`assets/ui/${name}`);
  }

  /** Tło sceny: grafika `assets/ui/stage-bg.png` (cover) albo ciemny gradient.
   *  `gray` = wersja czarno-biała (dla zablokowanego poziomu). */
  private drawUiBg(ctx: CanvasRenderingContext2D, gray = false) {
    const top = -this.vdy;
    const vh = this.sh();
    const midY = top + vh / 2;
    const bg = this.uiImg("stage-bg.png");
    if (imgReady(bg)) {
      // „cover" na cały widoczny obszar (rozciągnięte tło na wyższych telefonach)
      const s = Math.max(VW / bg.naturalWidth, vh / bg.naturalHeight);
      const w = bg.naturalWidth * s;
      const h = bg.naturalHeight * s;
      const src: CanvasImageSource = gray ? desaturated(bg) : bg;
      ctx.drawImage(src, (VW - w) / 2, midY - h / 2, w, h);
      return;
    }
    const g = ctx.createRadialGradient(VW / 2, top + vh * 0.32, 40, VW / 2, midY, vh * 0.95);
    if (gray) {
      g.addColorStop(0, "#26262a");
      g.addColorStop(1, "#08080a");
    } else {
      g.addColorStop(0, "#2a141d");
      g.addColorStop(1, "#0a0508");
    }
    this.fillViewport(ctx, g);
  }

  /** Przycisk z grafiki `assets/ui/button-<name>.png` (napis wbudowany).
   *  `r` wyznacza szerokość i górę; wysokość liczona z proporcji obrazka.
   *  Zapas (brak PNG): prosty złoty prostokąt z napisem `fallback`. */
  private uiButton(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    name: string,
    opts: {
      disabled?: boolean;
      fallback?: string;
      style?: "gold" | "dark-gold" | "dark-green";
    } = {},
  ) {
    const { disabled = false, fallback = name.toUpperCase(), style = "gold" } = opts;
    const img = this.uiImg(`button-${name}.png`);
    if (imgReady(img)) {
      const h = (img.naturalHeight / img.naturalWidth) * r.w;
      const y = r.y + (r.h - h) / 2;
      if (disabled) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.drawImage(desaturated(img), r.x, y, r.w, h);
        ctx.restore();
      } else {
        ctx.drawImage(img, r.x, y, r.w, h);
      }
      return;
    }
    // zapas: rysowany w stylu makiety
    this.styledBtn(ctx, r, fallback, disabled ? "dark-gold" : style);
  }

  /** Strzałka nawigacji (grafika z assets/ui). `dir` = "left" | "right", `on` = aktywna. */
  private arrowBtn(ctx: CanvasRenderingContext2D, r: Rect, dir: "left" | "right", on: boolean) {
    const img = this.uiImg(`arrow-${dir}${on ? "" : "-disabled"}.png`);
    if (imgReady(img)) {
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      return;
    }
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r.w / 2, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#f2a51e" : "rgba(120,120,128,0.35)";
    ctx.fill();
    text(ctx, dir === "left" ? "‹" : "›", cx, cy - 1, {
      size: 34,
      weight: "900",
      font: HEAD_FONT,
      color: on ? "#3a1e05" : "rgba(255,255,255,0.35)",
    });
    ctx.restore();
  }

  /** Rząd 5 gwiazdek, `fill` ułamkowo 0..5. Grafiki z assets/ui, zapas: rysowane. */
  private starRow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: number) {
    const gap = r * 2.5;
    const full = this.uiImg("star-full.png");
    const half = this.uiImg("star-half.png");
    const empty = this.uiImg("star-empty.png");
    const havePng = imgReady(full) && imgReady(half) && imgReady(empty);
    for (let i = 0; i < 5; i++) {
      const v = clamp(fill - i, 0, 1);
      const x = cx - gap * 2 + i * gap;
      if (havePng) {
        const img = v > 0.75 ? full : v >= 0.25 ? half : empty;
        ctx.drawImage(img, x - r, cy - r, r * 2, r * 2);
      } else {
        this.drawStar(ctx, x, cy, r, v);
      }
    }
  }

  // ---- ekran: WYBIERZ HIT (karuzela poziomów) ----------------

  private drawHits(ctx: CanvasRenderingContext2D) {
    const idx = this.hitIndex;
    const meta = SONGS[idx]; // undefined dla „już wkrótce"
    // „wkrótce" (niedostępny utwór) pokazujemy w kolorze; zablokowany progresją — b&w
    const locked = meta.playable && !levelUnlocked(idx);
    const unlocked = !locked;

    this.drawUiBg(ctx, locked);

    // logo — wyśrodkowane, dolna krawędź tuż nad „POZIOM N"
    const logo = this.uiImg("wybierz-hit.png");
    if (imgReady(logo)) {
      const w = VW - 150;
      const h = (logo.naturalHeight / logo.naturalWidth) * w;
      const ly = Math.max(HIT_LOGO.y, HIT_LEVEL_Y - 40 - h);
      ctx.drawImage(logo, (VW - w) / 2, ly, w, h);
    } else {
      text(ctx, "WYBIERZ HIT", VW / 2, HIT_LEVEL_Y - 90, {
        size: 64,
        weight: "900",
        font: HEAD_FONT,
        color: "#ffd24c",
        shadows: HEAD_SHADOWS,
      });
    }

    // zębatka — nad logo, żeby zawsze była widoczna
    const gear = this.uiImg("gear.png");
    ctx.save();
    ctx.fillStyle = "rgba(8,6,12,0.55)";
    ctx.beginPath();
    ctx.arc(HIT_GEAR.x + HIT_GEAR.w / 2, HIT_GEAR.y + HIT_GEAR.h / 2, HIT_GEAR.w * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (imgReady(gear)) ctx.drawImage(gear, HIT_GEAR.x, HIT_GEAR.y, HIT_GEAR.w, HIT_GEAR.h);
    else text(ctx, "⚙", HIT_GEAR.x + HIT_GEAR.w / 2, HIT_GEAR.y + HIT_GEAR.h / 2, { size: 44, color: "#ffce8a" });

    // POZIOM N
    text(ctx, `POZIOM ${idx + 1}`, VW / 2, HIT_LEVEL_Y, {
      size: 24,
      weight: "900",
      font: HEAD_FONT,
      color: "#ffd24c",
      letterSpacing: "4px",
      shadows: HEAD_SHADOWS,
    });

    // strzałki na wysokości tytułu
    this.arrowBtn(ctx, HIT_ARROW_L, "left", idx > 0);
    this.arrowBtn(ctx, HIT_ARROW_R, "right", idx < this.maxHitIndex());

    // tytuł (auto-zmniejszanie, żeby zmieścił się między strzałkami)
    const title = meta.title.toUpperCase();
    const maxTitleW = HIT_ARROW_R.x - (HIT_ARROW_L.x + HIT_ARROW_L.w) - 20;
    let tSize = 42;
    ctx.save();
    const measure = () => {
      ctx.font = `900 ${tSize}px ${HEAD_FONT}`;
      const w = ctx.measureText(title)?.width;
      return typeof w === "number" ? w : 0;
    };
    while (tSize > 26 && measure() > maxTitleW) tSize -= 2;
    ctx.restore();
    text(ctx, title, VW / 2, HIT_TITLE_Y, {
      size: tSize,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      shadows: HEAD_SHADOWS,
    });

    // gwiazdki (najlepszy wynik dla tego utworu)
    this.starRow(ctx, VW / 2, HIT_STARS_Y, 20, bestStars(meta.id));

    // postać (b&w tylko gdy zablokowana progresją)
    this.drawSelectChar(ctx, idx, unlocked);

    // confetti (po kliknięciu GRAJ!)
    this.drawFx(ctx);

    // --- poziom „wkrótce" (utwór jeszcze niedostępny) ---
    if (!meta.playable) {
      // czerwona pieczątka „WKRÓTCE" ukośnie na postaci
      this.drawCharStamp(ctx, "wkrotce.png", -13, "WKRÓTCE");

      const wide = { x: MARGIN, y: HIT_GRAJ.y, w: VW - MARGIN * 2, h: HIT_GRAJ.h };
      const spotBelow = { x: MARGIN, y: HIT_RES.y, w: VW - MARGIN * 2, h: HIT_REW.h };

      if (pushOptedInSync()) {
        // po zapisaniu się — potwierdzenie zamiast przycisku
        const rc = this.hb(wide);
        ctx.save();
        ctx.fillStyle = "rgba(93,242,160,0.12)";
        roundRect(ctx, rc.x, rc.y, rc.w, rc.h, 16);
        ctx.fill();
        ctx.strokeStyle = "rgba(93,242,160,0.5)";
        ctx.lineWidth = 2;
        roundRect(ctx, rc.x, rc.y, rc.w, rc.h, 16);
        ctx.stroke();
        ctx.restore();
        text(ctx, "✓  Damy Ci znać!", rc.x + rc.w / 2, rc.y + 30, {
          size: 22,
          weight: "900",
          font: HEAD_FONT,
          color: "#8affc1",
        });
        text(ctx, "Wyślemy powiadomienie do aplikacji,", rc.x + rc.w / 2, rc.y + 60, {
          size: 16,
          weight: "700",
          color: "#dff5e8",
        });
        text(ctx, "gdy poziom będzie gotowy.", rc.x + rc.w / 2, rc.y + 82, {
          size: 16,
          weight: "700",
          color: "#dff5e8",
        });
      } else {
        // „Powiadom mnie" — daj znać, gdy poziom będzie gotowy
        this.uiButton(ctx, this.hb(wide), "powiadom-mnie", {
          fallback: "POWIADOM MNIE",
          style: "gold",
        });
      }
      // + odsłuch utworu na Spotify
      this.uiButton(ctx, this.hb(spotBelow), "otworz-w-spotify", {
        fallback: "OTWÓRZ W SPOTIFY",
        style: "dark-green",
      });
      return;
    }

    // poziom zablokowany progresją → ukośna pieczątka „PRZEJDŹ POPRZEDNI POZIOM"
    // na postaci (zamiast napisu pod przyciskiem)
    if (!unlocked) {
      this.drawCharStamp(ctx, "przejdz-poprzedni-poziom.png", -8, "PRZEJDŹ POPRZEDNI POZIOM");
    }

    // GRAJ!
    const graj = this.hb(HIT_GRAJ);
    this.uiButton(ctx, graj, "graj", { disabled: !unlocked, fallback: "GRAJ!" });

    // WYNIKI | NAGRODY
    this.uiButton(ctx, this.hb(HIT_RES), "wyniki", { fallback: "WYNIKI" });
    this.uiButton(ctx, this.hb(HIT_REW), "nagrody", { fallback: "NAGRODY" });
  }

  private drawSelectChar(ctx: CanvasRenderingContext2D, idx: number, unlocked: boolean) {
    const meta = SONGS[idx];
    // postać wypełnia całą wolną przestrzeń w pionie: od tuż pod gwiazdkami do
    // tuż nad przyciskiem GRAJ! (który jest dosunięty do dołu ekranu). Dzięki
    // temu na wyższych telefonach nie ma pustej dziury u góry.
    const top = HIT_STARS_Y + 26;
    const bottom = this.hb(HIT_GRAJ).y - 14;
    const box: Rect = { x: 0, y: top, w: VW, h: Math.max(320, bottom - top) };
    this.charRect = box;

    let src: HTMLImageElement | null = null;
    const named = this.uiImg(`select-${meta.id}.png`);
    if (imgReady(named)) src = named;
    else {
      // zapas: pierwsza klatka animacji „ujecie1" tego utworu
      const fb = loadImg(`assets/char/${meta.id}/ujecie1/dance.png`);
      if (imgReady(fb)) src = fb;
    }
    if (!src) {
      text(ctx, "?", VW / 2, box.y + box.h / 2, {
        size: 160,
        weight: "900",
        color: "rgba(255,255,255,0.12)",
      });
      return;
    }
    // przytnij przezroczyste marginesy PNG — inaczej „puste" zapasy grafiki
    // zostawiają dziurę mimo dopasowania do wysokości
    const pic = trimmedImage(src);
    const ar = pic.width / pic.height;
    // wypełnij WYSOKOŚĆ pasa; szerokość może lekko wyjść poza ekran —
    // ograniczamy do ~1,12×VW, żeby nie ucinać sylwetki
    let h = box.h;
    let w = h * ar;
    if (w > VW * 1.12) {
      w = VW * 1.12;
      h = w / ar;
    }
    const dx = VW / 2 - w / 2;
    const dy = box.y + box.h - h;
    this.charRect = { x: dx, y: dy, w, h };
    ctx.drawImage(unlocked ? pic : desaturated(pic), dx, dy, w, h);
  }

  /** Rysuje ukośną pieczątkę PNG wyśrodkowaną na postaci (WKRÓTCE / zablokowane). */
  private drawCharStamp(ctx: CanvasRenderingContext2D, file: string, deg: number, fallbackText?: string) {
    const c = this.charRect;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h * 0.5;
    const stamp = this.uiImg(file);
    if (imgReady(stamp)) {
      const w = VW - 20;
      const h = (stamp.naturalHeight / stamp.naturalWidth) * w;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(stamp, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else if (fallbackText) {
      text(ctx, fallbackText, cx, cy, {
        size: 60,
        weight: "900",
        font: HEAD_FONT,
        color: "#e0322e",
        stroke: "#e0322e",
        strokeWidth: 8,
      });
    }
  }

  // ---- ekran: NAGRODY ---------------------------------------

  private drawRewards(ctx: CanvasRenderingContext2D) {
    this.drawUiBg(ctx);
    text(ctx, "‹ WRÓĆ", BACK.x + 14, BACK.y + 34, {
      size: 24,
      align: "left",
      color: "#ffce8a",
      weight: "700",
    });
    text(ctx, "NAGRODY", VW / 2, 130, {
      size: 48,
      weight: "900",
      font: HEAD_FONT,
      color: "#ffd24c",
      shadows: HEAD_SHADOWS,
    });

    const rd = this.uiImg("reward-denis.png");
    if (imgReady(rd)) {
      const w = 380;
      const h = (rd.naturalHeight / rd.naturalWidth) * w;
      ctx.drawImage(rd, VW / 2 - w / 2, 220, w, h);
    }
    wrapText("Wciąż rozbudowujemy naszą grę! Daj nam trochę czasu, a wkrótce wrócimy z konkursami!", 26).forEach(
      (ln, i) =>
        text(ctx, ln, VW / 2, 860 + i * 40, {
          size: 28,
          weight: "900",
          font: HEAD_FONT,
          color: "#fff7ec",
          shadows: HEAD_SHADOWS,
        }),
    );
    this.uiButton(ctx, REW_HOME, "powrot", { fallback: "POWRÓT" });
  }

  // ---- ekran: USTAWIENIA -----------------------------------

  /** Wiersz-przycisk ustawień (obramowany, etykieta + „›"). */
  private linkRow(ctx: CanvasRenderingContext2D, r: Rect, label: string, color = "#ffce8a") {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    roundRect(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    roundRect(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.stroke();
    text(ctx, label, r.x + 24, r.y + r.h / 2, {
      size: 22,
      align: "left",
      weight: "800",
      color,
    });
    text(ctx, "›", r.x + r.w - 26, r.y + r.h / 2, { size: 30, align: "right", color });
  }

  /** Wiersz ustawień z przełącznikiem on/off (pigułka po prawej). */
  private toggleRow(ctx: CanvasRenderingContext2D, r: Rect, label: string, sub: string, on: boolean) {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    roundRect(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    roundRect(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.stroke();
    text(ctx, label, r.x + 24, r.y + r.h / 2 - 11, {
      size: 21,
      align: "left",
      weight: "800",
      color: "#ffce8a",
    });
    text(ctx, sub, r.x + 24, r.y + r.h / 2 + 15, { size: 14, align: "left", color: "#9a8c7e" });
    // pigułka
    const pw = 68;
    const ph = 34;
    const px = r.x + r.w - pw - 20;
    const py = r.y + (r.h - ph) / 2;
    ctx.fillStyle = on ? "#e8971c" : "rgba(255,255,255,0.14)";
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = "#fff7ec";
    ctx.beginPath();
    ctx.arc(on ? px + pw - ph / 2 : px + ph / 2, py + ph / 2, ph / 2 - 5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawProfile(ctx: CanvasRenderingContext2D) {
    this.drawUiBg(ctx);
    text(ctx, "‹ WRÓĆ", BACK.x + 14, BACK.y + 34, {
      size: 26,
      align: "left",
      color: "#ffce8a",
      weight: "700",
    });
    text(ctx, "USTAWIENIA", VW / 2, 130, {
      size: 44,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      shadows: HEAD_SHADOWS,
    });

    this.linkRow(ctx, SET_TERMS, "Regulamin");
    this.linkRow(ctx, SET_PRIV, "Polityka prywatności");

    // Powiadomienia o nowej zawartości (nowe poziomy / utwory)
    this.toggleRow(
      ctx,
      SET_PUSH,
      "Powiadomienia o nowej zawartości",
      "Nowe poziomy i utwory. Nie wysyłamy reklam.",
      pushOptedInSync(),
    );

    // Usuń konto i dane — przedostatnie, neutralny kolor
    this.linkRow(ctx, SET_DELETE, "Usuń konto i dane", "#e0d0bd");
    // Wyloguj się — ostatnie, czerwone
    this.linkRow(ctx, SET_LOGOUT, "Wyloguj się", "#ff8a97");

    // stopka: Impulsywni + kontakt
    text(ctx, "IMPULSYWNI", VW / 2, SET_MAIL.y + 8, {
      size: 22,
      weight: "900",
      font: HEAD_FONT,
      color: "#ffce8a",
      letterSpacing: "3px",
    });
    text(ctx, "kreatywne rozwiązania dla branży muzycznej", VW / 2, SET_MAIL.y + 44, {
      size: 16,
      color: "#c9b7a6",
    });
    text(ctx, SUPPORT_EMAIL, VW / 2, SET_MAIL.y + 78, {
      size: 18,
      weight: "700",
      color: "#ff9f43",
    });

    text(ctx, `DENIS Impulsywni Live · wersja ${APP_VERSION}`, VW / 2, VH - 44, {
      size: 14,
      color: "#6b6055",
    });
  }

  // ---- ekran: gra --------------------------------------------

  private drawPlay(ctx: CanvasRenderingContext2D) {
    const pulse = this.beatPulse();

    const plainStage = this.character.hasContent() && !this.songBg;

    // ---- trzęsienie ekranu ----
    const sh = this.shake;
    const sx = sh ? (Math.random() - 0.5) * sh : 0;
    const sy = sh ? (Math.random() - 0.5) * sh : 0;
    ctx.save();
    ctx.translate(sx, sy);

    const missGlow = clamp(1 - (this.songTime - this.denisMissAt) / 0.3, 0, 1);
    const popGlow = this.songTime - this.denisPopAt < 0.15 ? 0.5 : 0;
    const heat = this.flowTier / MAX_FLOW_TIER;
    this.drawStage(
      ctx,
      0.34 + missGlow * 0.12 - heat * 0.06,
      pulse + popGlow + heat * 0.35,
      plainStage,
    );

    if (heat > 0.01 || missGlow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this.fillViewport(
        ctx,
        missGlow > 0.05 ? `rgba(255,45,60,${missGlow * 0.14})` : `rgba(255,150,60,${heat * 0.05})`,
      );
      ctx.restore();
    }

    this.drawPlayfield(ctx, pulse);
    this.drawNotes(ctx);
    this.drawFx(ctx); // za postacią
    this.drawCharacter(ctx); // pierwszy plan — przed nutami
    this.drawJudgePopups(ctx);
    this.drawIce(ctx); // tafla lodu — pod HUD (gracz widzi spadające życie)
    this.drawSpotlight(ctx); // ciemność + snop światła (przeszkoda z edytora)
    this.drawComboFlash(ctx); // flesze z krawędzi przy combo >= 30 (każdy utwór)
    this.drawHud(ctx);
    this.drawCountdown(ctx);
    if (this.paused) this.drawPause(ctx);

    ctx.restore(); // koniec trzęsienia
  }

  // ---- postać na pierwszym planie -----------------------------------
  //
  // Ruch jest ten sam niezależnie od trafień (tylko groove do bitu).
  // Prawdziwe animacje: `src/character.ts` (sprite sheet / sekwencja PNG,
  // kilka na osi czasu utworu). Bez grafik rysujemy wektorowy placeholder.

  private drawCharacter(ctx: CanvasRenderingContext2D) {
    // na wyższych ekranach zsuwamy postać w dół razem z wydłużonym torem,
    // żeby stała mniej więcej w tej samej części kadru co przy wysokości bazowej
    const groundY = (this.song.characterY ?? 706) + this.extraH() * 0.5;
    const targetH = 440 * (this.song.characterScale ?? 1);
    if (this.character.draw(ctx, VW / 2, groundY, this.songTime, this.song.bpm, targetH)) return;

    // --- placeholder wektorowy (do czasu podesłania grafik) ---
    const beat = 60 / this.song.bpm;
    const t = Math.max(this.songTime, 0);
    const phase = (t % beat) / beat;
    const cx = VW / 2;
    const bounce = -Math.abs(Math.sin(phase * Math.PI)) * 14;
    const sway = Math.sin((t / beat) * Math.PI) * 12;
    const tilt = Math.sin((t / beat) * Math.PI) * 0.045;
    const land = Math.pow(Math.max(0, -Math.sin(phase * Math.PI * 2)), 1.4);

    ctx.save();
    ctx.translate(cx + sway, groundY + bounce);
    ctx.rotate(tilt);
    ctx.scale(1 + land * 0.07, 1 - land * 0.07);
    ctx.globalAlpha = 0.9;

    const col = "#c98a5a";
    const rim = "rgba(255,220,180,0.9)";
    ctx.lineCap = "round";
    const legSwing = Math.sin((t / beat) * Math.PI * 2) * 12;

    ctx.strokeStyle = col;
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(-10, -120);
    ctx.lineTo(-18 - legSwing, 0);
    ctx.moveTo(10, -120);
    ctx.lineTo(18 + legSwing, 0);
    ctx.stroke();

    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.lineTo(0, -230);
    ctx.stroke();

    ctx.lineWidth = 18;
    const aBase = -220;
    const a = Math.sin((t / beat) * Math.PI * 2) * 0.4;
    ctx.beginPath();
    ctx.moveTo(0, aBase);
    ctx.lineTo(Math.sin(-0.5 + a) * 70, aBase - Math.cos(-0.5 + a) * 70);
    ctx.moveTo(0, aBase);
    ctx.lineTo(Math.sin(0.5 + a) * 70, aBase - Math.cos(0.5 + a) * 70);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, -270, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -270, 30, Math.PI * 0.8, Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();
  }

  private drawPause(ctx: CanvasRenderingContext2D) {
    ctx.save();

    if (this.resumeAt) {
      // odliczanie 3-2-1 po wznowieniu: NIE zasłaniamy pola gry — gracz musi
      // widzieć zamrożone nuty i przygotować się. Tylko lekki scrim + liczba.
      this.fillViewport(ctx, "rgba(4,4,10,0.30)");
      const left = Math.ceil((this.resumeAt - performance.now()) / 1000);
      if (left >= 1) {
        const frac = 1 - ((this.resumeAt - performance.now()) / 1000 - (left - 1));
        text(ctx, String(left), VW / 2, this.sh() / 2 - this.vdy, {
          size: 200 - frac * 40,
          weight: "900",
          font: HEAD_FONT,
          color: "#fff7ec",
          glow: "#ffb457",
          glowBlur: 44,
        });
      }
      ctx.restore();
      return;
    }

    this.drawUiBg(ctx);
    this.fillViewport(ctx, "rgba(4,4,10,0.6)");
    ctx.translate(0, this.pauseShift()); // wyśrodkuj menu na wyższych ekranach
    text(ctx, "PAUZA", VW / 2, 420, {
      size: 72,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      letterSpacing: "6px",
      shadows: HEAD_SHADOWS,
    });

    this.uiButton(ctx, PZ_RESUME, "graj", { fallback: "GRAJ!", style: "gold" });
    this.uiButton(ctx, PZ_RESTART, "od-nowa", { fallback: "OD NOWA", style: "dark-gold" });
    this.uiButton(ctx, PZ_MENU, "wyjdz", { fallback: "WYJDŹ Z GRY", style: "dark-gold" });

    ctx.restore();
  }

  // ---- pole gry (perspektywa) -----------------------------------

  private drawPlayfield(ctx: CanvasRenderingContext2D, pulse: number) {
    const hitY = this.hitY();
    const padBot = this.padBot();
    const grad = ctx.createLinearGradient(0, HORIZON_Y, 0, this.sh());
    grad.addColorStop(0, "rgba(6,3,10,0)");
    grad.addColorStop(0.4, "rgba(6,3,10,0.5)");
    grad.addColorStop(1, "rgba(6,3,10,0.86)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, HORIZON_Y, VW, this.sh() - HORIZON_Y);

    const eBot = 1 + (padBot - hitY) / (hitY - HORIZON_Y);
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
      const lg = ctx.createLinearGradient(0, HORIZON_Y, 0, padBot);
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
    ctx.moveTo(this.hitX(0) - LANE_GAP_HIT * 0.62, hitY);
    ctx.lineTo(this.hitX(LANES - 1) + LANE_GAP_HIT * 0.62, hitY);
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
      ctx.arc(x, hitY, r, 0, Math.PI * 2);
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

      if (NOTE_SKIN[this.trackId] === "skull") {
        // czaszki „szczękają" w rytm — wszystkie zsynchronizowane po songTime
        const jaw = Math.min(2, (((Math.sin(this.songTime * 8) + 1) / 2) * 3) | 0);
        const bob = Math.sin(this.songTime * 6 + n.lane * 1.3) * r * 0.06;
        const d = r * 2.5;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12 + (n.dur > 0 ? 8 : 0);
        ctx.drawImage(this.skullSprite(col, jaw), x - d / 2, y - d / 2 + bob, d, d);
        ctx.restore();
        continue;
      }

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
      ctx.arc(x, this.hitY(), r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Sprite czaszki (nuta w „Pogrzebówce") — rysowany raz na (kolor toru × pozycja
   *  szczęki) i cache'owany. `jaw` 0..2 = szczęka zamknięta → otwarta. */
  private skullSprite(col: string, jaw: number): HTMLCanvasElement {
    const key = `${col}|${jaw}`;
    const hit = this.skullCache.get(key);
    if (hit) return hit;

    const S = 96;
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    const c = cv.getContext("2d");
    if (!c) return cv;
    c.translate(S / 2, S / 2 + 3);
    const s = S * 0.4;
    const jd = s * (0.05 + jaw * 0.12); // opadnięcie szczęki
    const bone = "#f2ecdc";
    const boneDk = "#d7cfba";

    // szczęka (pod czaszką)
    c.fillStyle = boneDk;
    roundRect(c, -s * 0.4, s * 0.5 + jd, s * 0.8, s * 0.36, s * 0.16);
    c.fill();
    c.fillStyle = bone;
    for (let i = -1; i <= 1; i++) c.fillRect(i * s * 0.22 - s * 0.055, s * 0.52 + jd, s * 0.11, s * 0.13);

    // czaszka
    c.fillStyle = bone;
    c.beginPath();
    c.moveTo(-s * 0.85, s * 0.12);
    c.bezierCurveTo(-s * 1.02, -s * 0.98, s * 1.02, -s * 0.98, s * 0.85, s * 0.12);
    c.bezierCurveTo(s * 0.82, s * 0.44, s * 0.52, s * 0.56, s * 0.4, s * 0.56);
    c.lineTo(-s * 0.4, s * 0.56);
    c.bezierCurveTo(-s * 0.52, s * 0.56, -s * 0.82, s * 0.44, -s * 0.85, s * 0.12);
    c.closePath();
    c.fill();

    // zęby górne
    c.fillStyle = boneDk;
    for (let i = -2; i <= 2; i++) c.fillRect(i * s * 0.17 - s * 0.045, s * 0.4, s * 0.09, s * 0.14);

    // oczodoły
    c.fillStyle = "#191309";
    c.beginPath();
    c.ellipse(-s * 0.34, -s * 0.1, s * 0.27, s * 0.33, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(s * 0.34, -s * 0.1, s * 0.27, s * 0.33, 0, 0, Math.PI * 2);
    c.fill();
    // blask w oczach — kolor toru
    c.fillStyle = col;
    c.beginPath();
    c.arc(-s * 0.25, -s * 0.02, s * 0.11, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(s * 0.43, -s * 0.02, s * 0.11, 0, Math.PI * 2);
    c.fill();

    // nos
    c.fillStyle = "#191309";
    c.beginPath();
    c.moveTo(0, s * 0.05);
    c.lineTo(-s * 0.12, s * 0.32);
    c.lineTo(s * 0.12, s * 0.32);
    c.closePath();
    c.fill();

    this.skullCache.set(key, cv);
    return cv;
  }

  private drawJudgePopups(ctx: CanvasRenderingContext2D) {
    for (const p of this.popups) {
      const life = (this.songTime - p.at) / 0.55;
      if (life < 0 || life >= 1) continue;
      ctx.save();
      ctx.globalAlpha = 1 - life * life;
      ctx.translate(p.x, this.hitY() - 92 - life * 44);
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

  // ---- lód (poziom „Byleby nie była ciepła") ------------------------

  private drawIce(ctx: CanvasRenderingContext2D) {
    const sinceShatter = this.songTime - this.iceShatterAt;
    const shattering = !this.iceActive && sinceShatter >= 0 && sinceShatter < 0.45;
    if (!this.iceActive && !shattering) return;

    const formT = clamp((this.songTime - this.iceStartAt) / 0.32, 0, 1);
    const fade = clamp(this.iceActive ? formT : 1 - sinceShatter / 0.45, 0, 1);
    const A = fade * 0.8; // krycie tafli (wariant „Gruby szron")
    const blurPx = 7 * fade; // rozmycie tła narasta przy zamarzaniu, schodzi przy rozbiciu
    const top = -this.vdy;
    const H = this.sh();
    const cv = ctx.canvas;

    // 1. rozmycie tła — postać + nuty za taflą.
    //    Robione na 1/3 rozdzielczości (blur skaluje się z liczbą pikseli),
    //    z powrotem skalowane w górę — dodatkowo zmiękcza, taniej ~9×.
    if (this.canvasFilterOK === null) {
      this.canvasFilterOK = typeof ctx.filter === "string";
    }
    if (this.canvasFilterOK && blurPx > 0.4 && cv.width > 1 && cv.height > 1) {
      const dw = Math.max(1, Math.round(cv.width / 3));
      const dh = Math.max(1, Math.round(cv.height / 3));
      let snap = this.iceSnap;
      if (!snap) snap = this.iceSnap = document.createElement("canvas");
      if (snap.width !== dw || snap.height !== dh) {
        snap.width = dw;
        snap.height = dh;
      }
      const sx = snap.getContext("2d");
      if (sx) {
        sx.clearRect(0, 0, dw, dh);
        sx.drawImage(cv, 0, 0, dw, dh);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = fade;
        ctx.filter = `blur(${(blurPx / 4).toFixed(2)}px)`; // /3 downscale + upscale i tak zmiękcza
        ctx.drawImage(snap, -24, -24, cv.width + 48, cv.height + 48);
        ctx.filter = "none";
        ctx.restore();
      }
    }

    // 2. tafla — zbuforowana grafika (budowana raz, stały rozmiar, rozciągana)
    let layer: HTMLCanvasElement | null = null;
    try {
      layer = this.ensureIceLayer();
    } catch {
      layer = null; // awaria budowy → sam korpus poniżej
    }
    ctx.save();
    ctx.globalAlpha = A;
    if (layer) {
      ctx.drawImage(layer, 0, top, VW, H);
    } else {
      // fallback bez tafli — samo chłodne przyciemnienie, żeby lód był czytelny
      ctx.fillStyle = "rgba(200,226,245,0.9)";
      ctx.fillRect(0, top, VW, H);
    }
    ctx.restore();

    // 3. pęknięcia od każdego tapnięcia — na wierzchu, pełna moc
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineCap = "round";
    for (const c of this.iceCracks) {
      const grow = clamp((this.songTime - c.born) / 0.22, 0, 1);
      const branches = 4;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(140,205,255,0.9)";
      ctx.shadowBlur = 6;
      for (let b = 0; b < branches; b++) {
        const ang = c.a + (b / branches) * Math.PI * 2 + (b % 2 ? 0.3 : -0.2);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        const segs = 3;
        for (let s = 1; s <= segs; s++) {
          const t = (s / segs) * c.len * grow;
          const px = c.x + Math.cos(ang) * t + (((c.born * 97 + b * 13 + s) % 7) - 3) * 3;
          const py = c.y + Math.sin(ang) * t + (((c.born * 53 + b * 7 + s) % 7) - 3) * 3;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // licznik „ROZBIJ LÓD!"
    if (this.iceActive) {
      const beat = 1 + Math.sin(this.songTime * 14) * 0.06;
      ctx.save();
      ctx.translate(VW / 2, this.sh() / 2 - this.vdy - 30);
      text(ctx, "ROZBIJ LÓD!", 0, -46, {
        size: 40,
        weight: "900",
        font: HEAD_FONT,
        color: "#eaf7ff",
        glow: "#7fd4ff",
        glowBlur: 22,
        letterSpacing: "2px",
      });
      ctx.scale(beat, beat);
      text(ctx, String(this.iceTapsLeft), 0, 44, {
        size: 96,
        weight: "900",
        font: HEAD_FONT,
        color: "#ffffff",
        glow: "#8fd4ff",
        glowBlur: 30,
      });
      ctx.restore();
    }
  }

  /** Buduje (raz) bufor tafli lodu w STAŁYM rozmiarze projektu (VW×VH) —
   *  przy rysowaniu jest rozciągany do realnej wysokości ekranu. Stały,
   *  mały canvas = brak presji pamięci canvasu na iOS Safari. */
  private ensureIceLayer(): HTMLCanvasElement | null {
    let layer = this.iceLayer;
    if (!layer) layer = this.iceLayer = document.createElement("canvas");
    if (this.iceLayerKey !== "1") {
      layer.width = VW;
      layer.height = VH;
      const lx = layer.getContext("2d");
      if (!lx) return null;
      lx.clearRect(0, 0, VW, VH);
      this.drawIceSheet(lx, VW, VH);
      this.iceLayerKey = "1";
    }
    return layer;
  }

  /** Grafika tafli „Gruby szron" — rysowana RAZ do bufora (`this.iceLayer`),
   *  potem tylko składana z animowanym kryciem. Deterministyczna (stały seed),
   *  bez rekurencji — koszt budowy ~kilka ms nawet na słabym telefonie. */
  private drawIceSheet(ctx: CanvasRenderingContext2D, W: number, H: number) {
    let s = 20259;
    const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

    // mroźny korpus tafli
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(224,240,252,0.95)");
    g.addColorStop(0.5, "rgba(202,228,247,0.9)");
    g.addColorStop(1, "rgba(178,213,240,0.95)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // matowy nalot szronu — ziarnistość krótkich kresek (jeden path, jeden stroke)
    ctx.strokeStyle = "rgba(245,251,255,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 320; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const a = rng() * Math.PI;
      const l = 2 + rng() * 6;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
    ctx.stroke();

    // dendryt szronu — polilinia z krótkimi gałązkami. BEZ ctx.shadow (dławi
    // na mobile). Segmenty liczymy RAZ, rysujemy dwoma przelotami: szeroka
    // blada poświata + cienki jasny rdzeń.
    const buildDendrite = (x0: number, y0: number, dx: number, dy: number, len: number): number[][] => {
      const px = -dy;
      const py = dx;
      const N = 5;
      const segs: number[][] = [];
      let cx = x0;
      let cy = y0;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const j = (rng() - 0.5) * len * 0.16;
        const x = x0 + dx * len * t + px * j;
        const y = y0 + dy * len * t + py * j;
        segs.push([cx, cy, x, y]);
        if (i < N) {
          const side = rng() < 0.5 ? 1 : -1;
          const bl = len * (0.2 + rng() * 0.16) * (1 - t);
          segs.push([x, y, x + (dx * 0.35 + px * side) * bl, y + (dy * 0.35 + py * side) * bl]);
        }
        cx = x;
        cy = y;
      }
      return segs;
    };
    const frostEdge = (glow: string, core: string, count: number, min: number, span: number) => {
      const segs: number[][] = [];
      const add = (a: number[][]) => {
        for (const s2 of a) segs.push(s2);
      };
      for (let i = 0; i < count; i++) {
        add(buildDendrite(0, ((i + rng()) / count) * H, 1, (rng() - 0.5) * 0.55, min + rng() * span));
        add(buildDendrite(W, ((i + rng()) / count) * H, -1, (rng() - 0.5) * 0.55, min + rng() * span));
      }
      const cols = Math.max(3, Math.round(count / 2.6));
      for (let i = 0; i < cols; i++) {
        add(buildDendrite(((i + rng()) / cols) * W, 0, (rng() - 0.5) * 0.55, 1, min * 0.85 + rng() * span * 0.85));
        add(buildDendrite(((i + rng()) / cols) * W, H, (rng() - 0.5) * 0.55, -1, min * 0.85 + rng() * span * 0.85));
      }
      const paint = (col: string, wgt: number) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = wgt;
        ctx.beginPath();
        for (const p of segs) {
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(p[2], p[3]);
        }
        ctx.stroke();
      };
      paint(glow, 4);
      paint(core, 1.5);
    };
    frostEdge("rgba(150,200,244,0.26)", "rgba(120,166,210,0.5)", 22, 90, 150);
    frostEdge("rgba(210,236,255,0.34)", "rgba(250,253,255,0.9)", 22, 70, 120);

    // kryształy 6-ramienne — rogi + trochę rozsianych
    const starAt = (x: number, y: number, r: number) => {
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const rr = k % 2 ? r * 0.4 : r;
        const sx2 = x + Math.cos(a) * rr;
        const sy2 = y + Math.sin(a) * rr;
        if (k) ctx.lineTo(sx2, sy2);
        else ctx.moveTo(sx2, sy2);
      }
      ctx.closePath();
    };
    const crystals = (n: number, spread: number, cx: number, cy: number, maxR: number) => {
      for (let i = 0; i < n; i++) {
        starAt(cx + (rng() - 0.5) * spread, cy + (rng() - 0.5) * spread, 3 + rng() * maxR);
        ctx.fillStyle = `rgba(240,249,255,${0.14 + rng() * 0.24})`;
        ctx.fill();
      }
    };
    ([[0, 0], [W, 0], [0, H], [W, H]] as [number, number][]).forEach((c) =>
      crystals(30, 380, c[0], c[1], 12),
    );
    crystals(16, W, W / 2, H / 2, 7);

    // iskrzenie
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.4 + rng() * 0.5})`;
      ctx.beginPath();
      ctx.arc(rng() * W, rng() * H, 0.6 + rng() * 2, 0, 6.283);
      ctx.fill();
    }

    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.16, W / 2, H / 2, H * 0.7);
    vg.addColorStop(0, "rgba(236,247,255,0)");
    vg.addColorStop(1, "rgba(224,242,255,0.72)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /** REFLEKTOR (przeszkoda z edytora): ekran ciemnieje, zostaje snop światła
   *  nad linią trafienia. Intensywność stała 57%. HUD rysuje się później = ostry. */
  private drawSpotlight(ctx: CanvasRenderingContext2D) {
    const left = this.spotlightUntil - this.songTime;
    if (left <= 0) return;
    // płynne wejście (0.4 s) i wyjście (0.5 s)
    const fadeIn = clamp((this.songTime - this.spotlightStart) / 0.4, 0, 1);
    const fadeOut = clamp(left / 0.5, 0, 1);
    const m = Math.min(fadeIn, fadeOut); // 0..1
    if (m <= 0.001) return;

    const top = -this.vdy;
    const H = this.sh();
    const cx = VW / 2;
    const cy = this.hitY() - 40;
    const rad = 300 + Math.sin(this.songTime * 3) * 12; // 380 - 0.57*150 ≈ 295

    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, rad);
    g.addColorStop(0, "rgba(2,2,6,0)");
    g.addColorStop(0.5, `rgba(2,2,6,${0.12 * m})`);
    g.addColorStop(1, `rgba(2,2,6,${0.96 * m})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, top, VW, H);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const gl = ctx.createRadialGradient(cx, cy, 10, cx, cy, rad * 0.8);
    gl.addColorStop(0, `rgba(255,235,190,${0.28 * m})`);
    gl.addColorStop(1, "rgba(255,220,160,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, top, VW, H);
    ctx.restore();
  }

  /** Flesze paparazzi z krawędzi — obligatoryjnie w KAŻDYM utworze, gdy combo
   *  >= 30, aż do zbicia combo. Pulsują na bit. Intensywność stała 57%. */
  private drawComboFlash(ctx: CanvasRenderingContext2D) {
    if (this.combo < 30) return;
    const beat = 60 / Math.max(60, this.song.bpm);
    const phase = (this.songTime % beat) / beat;
    const a = Math.max(0, 1 - phase * 5) * 0.57 + 0.05 * 0.57;
    if (a <= 0.01) return;
    const top = -this.vdy;
    const H = this.sh();
    const bw = 230;

    const bar = (grad: CanvasGradient, x: number, w: number) => {
      ctx.fillStyle = grad;
      ctx.fillRect(x, top, w, H);
    };
    const gL = ctx.createLinearGradient(0, 0, bw, 0);
    gL.addColorStop(0, `rgba(255,255,255,${a})`);
    gL.addColorStop(1, "rgba(255,255,255,0)");
    bar(gL, 0, bw);
    const gR = ctx.createLinearGradient(VW, 0, VW - bw, 0);
    gR.addColorStop(0, `rgba(255,255,255,${a})`);
    gR.addColorStop(1, "rgba(255,255,255,0)");
    bar(gR, VW - bw, bw);
    const gT = ctx.createLinearGradient(0, top, 0, top + 200);
    gT.addColorStop(0, `rgba(255,255,255,${a * 0.9})`);
    gT.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gT;
    ctx.fillRect(0, top, VW, 200);
  }

  private drawCountdown(ctx: CanvasRenderingContext2D) {
    const first = this.song.notes[0]?.time ?? 3;
    const rel = first - this.songTime;
    if (rel <= 0.05 || rel > 3.2) return;
    const n = Math.ceil(rel);
    const f = n - rel;
    ctx.save();
    ctx.globalAlpha = clamp(1 - f, 0.15, 1);
    text(ctx, String(n), VW / 2, this.sh() / 2 - this.vdy - 60, {
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
    this.drawUiBg(ctx);

    const now = performance.now();
    const reveal = clamp((now - this.resultsAt) / 1800, 0, 1);
    const eased = 1 - Math.pow(1 - reveal, 3);
    const finalR = this.rating();
    const shown = clamp(finalR, 0, 1) * eased;
    const shownStars = this.starsFor(shown);
    const revealDone = reveal >= 1;
    const passed = finalR >= PASS_RATING;
    const lvlIdx = SONGS.findIndex((s) => s.id === this.trackId);

    // --- nagłówek ---
    text(ctx, `POZIOM ${lvlIdx + 1}`, VW / 2, 92, {
      size: 22,
      weight: "900",
      font: HEAD_FONT,
      color: "#ffce8a",
      letterSpacing: "4px",
      shadows: HEAD_SHADOWS,
    });
    text(ctx, this.song.title.toUpperCase(), VW / 2, 146, {
      size: 46,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      shadows: HEAD_SHADOWS,
    });

    // --- gwiazdki ---
    const spY = 190;
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
      const r = 23 * (1 + pop * 0.5);
      this.drawStar(ctx, VW / 2 - 108 + i * 54, spY + 37, r, f);
    }

    // --- licznik ---
    const gp = { x: 88, y: 288, w: VW - 176, h: 468 };
    const cx = VW / 2;
    const cy = gp.y + 232;
    const R = 172;
    const A0 = Math.PI * 0.75;
    const SWEEP = Math.PI * 1.5;
    const ang = (r: number) => A0 + clamp(r, 0, 1) * SWEEP;

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, A0 + SWEEP);
    ctx.stroke();
    ctx.strokeStyle = shown >= PASS_RATING ? "#ffd24c" : "#ff7a3d";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, ang(shown));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    for (let k = 0; k <= 10; k++) {
      const a = ang(k / 10);
      const r1 = R - 14;
      const r2 = R + (k % 5 === 0 ? 14 : 8);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    const pa = ang(PASS_RATING);
    ctx.strokeStyle = "#ff5e5e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pa) * (R - 18), cy + Math.sin(pa) * (R - 18));
    ctx.lineTo(cx + Math.cos(pa) * (R + 20), cy + Math.sin(pa) * (R + 20));
    ctx.stroke();
    text(ctx, "70%", cx + Math.cos(pa) * (R + 44), cy + Math.sin(pa) * (R + 44), {
      size: 15,
      weight: "800",
      color: "#ff8a8a",
    });
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang(shown));
    ctx.fillStyle = "#fff7ec";
    ctx.shadowColor = "#ffb457";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(0, -9);
    ctx.lineTo(R - 30, 0);
    ctx.lineTo(0, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#1a0d12";
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffce8a";
    ctx.lineWidth = 3;
    ctx.stroke();

    text(ctx, `${Math.round(shown * 100)}%`, cx, cy + 82, {
      size: 58,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      glow: "#ffb457",
      glowBlur: 14,
    });

    const hasNext = lvlIdx >= 0 && lvlIdx + 1 < SONGS.length && SONGS[lvlIdx + 1].playable;
    const nextUnlocked = hasNext && levelUnlocked(lvlIdx + 1); // po recordStars() w finish()
    const starsNow = Math.floor(this.starFill());

    if (revealDone) {
      const vFade = clamp((now - this.resultsAt - 1800) / 400, 0, 1);
      const lockedNext = passed && hasNext && !nextUnlocked;
      ctx.save();
      ctx.globalAlpha = vFade;
      // nagłówek: zaliczone (zielony) / za mało na kolejny poziom (bursztyn) /
      // niezaliczone (czerwony)
      const headline = lockedNext ? "NIEWIELE ZABRAKŁO" : passed ? "ZALICZONE!" : "NIE ZALICZONE";
      const headColor = lockedNext ? "#ffb44a" : passed ? "#5ef2a0" : "#ff6b7d";
      text(ctx, headline, cx, gp.y + gp.h - (lockedNext ? 92 : 52), {
        size: lockedNext ? 34 : passed ? 42 : 36,
        weight: "900",
        font: HEAD_FONT,
        color: headColor,
        glow: lockedNext ? "#ff9f43" : passed ? "#5ef2a0" : "#ff5e7e",
        glowBlur: 18,
        letterSpacing: "1px",
      });
      if (lockedNext) {
        // wyraźna informacja: rundę zaliczono, ale to za mało na kolejny poziom
        const bw = VW - 96;
        const bx = (VW - bw) / 2;
        const by = gp.y + gp.h - 66;
        const bh = 76;
        ctx.fillStyle = "rgba(255,170,60,0.16)";
        roundRect(ctx, bx, by, bw, bh, 14);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,190,90,0.55)";
        ctx.lineWidth = 2;
        roundRect(ctx, bx, by, bw, bh, 14);
        ctx.stroke();
        text(ctx, "TO ZA MAŁO NA KOLEJNY POZIOM", cx, by + 24, {
          size: 20,
          weight: "900",
          font: HEAD_FONT,
          color: "#ffce8a",
          letterSpacing: "1px",
        });
        text(
          ctx,
          `Potrzebujesz ${"★".repeat(UNLOCK_STARS)} (86%) — masz ${"★".repeat(Math.max(0, starsNow))}`,
          cx,
          by + 52,
          { size: 18, weight: "700", color: "#f0d9bd" },
        );
      } else if (passed && nextUnlocked) {
        text(ctx, "Następny poziom odblokowany!", cx, gp.y + gp.h - 14, {
          size: 19,
          weight: "800",
          color: "#8affc1",
        });
      }
      ctx.restore();
    }

    // --- punkty + miejsce ---
    text(ctx, `${this.score.toLocaleString("pl-PL")} PKT`, VW / 2, 824, {
      size: 58,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff7ec",
      shadows: HEAD_SHADOWS,
    });
    if (this.resultRank > 0) {
      text(ctx, `MIEJSCE ${this.resultRank}`, VW / 2, 880, {
        size: 30,
        weight: "900",
        font: HEAD_FONT,
        color: "#ffce8a",
        letterSpacing: "2px",
        shadows: HEAD_SHADOWS,
      });
    }

    // --- przyciski (po animacji licznika) ---
    if (!revealDone) {
      text(ctx, "stuknij, aby pominąć", VW / 2, VH - 34, { size: 15, color: "#6b6055" });
      return;
    }
    const fadeIn = clamp((now - this.resultsAt - 1800) / 400, 0, 1);
    ctx.save();
    ctx.globalAlpha = fadeIn;

    this.uiButton(ctx, RES_BOARD, "tabela-wynikow", { fallback: "TABELA WYNIKÓW", style: "dark-gold" });
    this.uiButton(ctx, RES_SPOTIFY, "otworz-w-spotify", { fallback: "OTWÓRZ W SPOTIFY", style: "dark-green" });
    this.uiButton(ctx, RES_PRIMARY, "kontynuuj", { fallback: "KONTYNUUJ", style: "gold" });

    ctx.restore();
  }

  /** Przycisk rysowany w kodzie w stylu makiety. */
  private styledBtn(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    label: string,
    style: "gold" | "dark-gold" | "dark-green",
  ) {
    const rad = Math.min(r.h / 2, 26);
    const lip = Math.round(r.h * 0.14);
    const faceH = r.h - lip;

    // cień
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 7;
    ctx.fillStyle = "#000";
    roundRect(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.fill();
    ctx.restore();

    // krawędź
    const edge = ctx.createLinearGradient(0, r.y + faceH - 6, 0, r.y + r.h);
    edge.addColorStop(0, "#b05206");
    edge.addColorStop(1, "#70380b");
    ctx.fillStyle = edge;
    roundRect(ctx, r.x, r.y + lip, r.w, r.h - lip, rad);
    ctx.fill();

    // twarz
    if (style === "gold") {
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + faceH);
      g.addColorStop(0, "#ffe27e");
      g.addColorStop(0.5, "#ffc63c");
      g.addColorStop(1, "#f5a81c");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = "#1d0d07";
    }
    roundRect(ctx, r.x, r.y, r.w, faceH, rad);
    ctx.fill();

    // obrys
    ctx.lineWidth = style === "gold" ? 2 : 3;
    ctx.strokeStyle =
      style === "dark-green" ? "#1db954" : style === "dark-gold" ? "#c9791a" : "rgba(120,64,8,0.5)";
    roundRect(ctx, r.x, r.y, r.w, faceH, rad);
    ctx.stroke();

    // górny bevel (tylko złoty)
    if (style === "gold") {
      ctx.save();
      roundRect(ctx, r.x, r.y, r.w, faceH, rad);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r.x + rad, r.y + 3);
      ctx.lineTo(r.x + r.w - rad, r.y + 3);
      ctx.stroke();
      ctx.restore();
    }

    text(ctx, label, r.x + r.w / 2, r.y + faceH / 2 + 1, {
      size: label.length > 12 ? 32 : 36,
      weight: "900",
      font: HEAD_FONT,
      color: "#fff",
      stroke: style === "gold" ? "#70380b" : "rgba(0,0,0,0.55)",
      strokeWidth: style === "gold" ? 5 : 4,
      shadows: [{ dx: 0, dy: 2, color: "rgba(0,0,0,0.4)" }],
    });
  }
}

