// Syntezowany podkład muzyczny + zegar-wzorzec (master clock) dla rozgrywki.
//
// Cały czas w grze liczymy względem AudioContext.currentTime, dzięki czemu
// nuty i dźwięk nie rozjeżdżają się nawet przy spadkach klatek.
//
// Docelowo: zamiast syntezy ładujemy prawdziwy plik (decodeAudioData) i gramy
// bufor; reszta API (getSongTime / start / stop) zostaje bez zmian.

import type { SongDef } from "./chart.ts";

/** Dźwięki interfejsu — grane przez TEN SAM AudioContext co muzyka (jedna
 *  sesja audio). HTMLAudioElement na iOS potrafił przerwać WebAudio → cisza. */
export type UiKind = "play" | "back" | "buttons" | "pauza";

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private startTime = 0;
  private leadIn = 0.25; // odstęp start()→pierwszy dźwięk (= ciche odliczanie 3-2-1)
  private lastSongT = -Infinity; // zegar utworu NIGDY nie cofa się w trakcie grania
  private _running = false;
  // awaryjny zegar na performance.now() — używany, gdy AudioContext.currentTime
  // nie rusza (błąd iOS Safari: state="running", a zegar stoi na 0)
  private wallStartMs = 0;
  private ctxAtStart = 0;
  private pausedTotalMs = 0; // suma czasu spędzonego w pauzie (zegar ścienny)
  private pauseStartMs = 0; // != 0 => właśnie trwa pauza
  private pauseSeq = 0; // numer pauzy — chroni opóźniony suspend przed nowym przebiegiem
  private trackBuffers = new Map<string, AudioBuffer>();
  private trackRaw = new Map<string, ArrayBuffer>(); // pobrane bajty przed dekodowaniem
  private srcNode: AudioBufferSourceNode | null = null;
  private mp3Buf: AudioBuffer | null = null; // bufor aktualnie granego podkładu (mp3 LUB pre-render syntezy) — do wznowienia po tle
  private synthBuf: AudioBuffer | null = null; // pre-renderowany podkład syntezowany (cache per utwór)
  private synthBufId = "";
  private curSong: SongDef | null = null; // aktualnie grany utwór (do ewentualnego re-schedule syntezy)
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null; // dźwięki interfejsu (menu / przyciski)
  private uiBuffers = new Map<UiKind, AudioBuffer>();
  private uiLoading = false;
  private keepAlive: AudioBufferSourceNode | null = null; // cichy loop — trzyma
  // wątek renderu audio żywy na iOS (inaczej `currentTime` zamiera na 0)
  private _sfxOn = true;
  private _uiOn = true;
  // --- muzyka tła menu (loop-background.mp3) — wszędzie poza rozgrywką ---
  private loopBuf: AudioBuffer | null = null;
  private loopSrc: AudioBufferSourceNode | null = null;
  private loopGain: GainNode | null = null;
  private loopWanted = false; // chcemy, żeby grała (może czekać na kontekst)
  private loopLoading = false;
  private static readonly LOOP_VOL = 0.32;
  // wszystkie zaplanowane głosy syntezy (całe bary są kolejkowane z góry) —
  // trzymamy referencje, żeby `stop()` NAPRAWDĘ je uciszył (inaczej po pauzie +
  // „OD NOWA" stary podkład wznawia się razem z nowym → podwójny dźwięk).
  private scheduled: AudioScheduledSourceNode[] = [];

  private track<T extends AudioScheduledSourceNode>(n: T): T {
    this.scheduled.push(n);
    return n;
  }

  private killScheduled() {
    for (const n of this.scheduled) {
      try {
        n.stop();
      } catch {
        /* już zatrzymany / jeszcze nie wystartował */
      }
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.scheduled = [];
  }

  get running() {
    return this._running;
  }

  get state() {
    return this.ctx?.state ?? "none";
  }

  private _unlocking: Promise<void> | null = null;

  /** Musi być wywołane w reakcji na gest użytkownika (tap / klik). */
  unlock(): Promise<void> {
    // scal równoległe wywołania (GRAJ! woła unlock() 2× — w geście i w startPlay)
    if (!this._unlocking) {
      this._unlocking = this._unlock().finally(() => {
        this._unlocking = null;
      });
    }
    return this._unlocking;
  }

  private buildCtx() {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(this.ctx);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.22;
    this.sfxGain.connect(this.master);
    this.uiGain = this.ctx.createGain();
    this.uiGain.gain.value = 0.5;
    // prosto do wyjścia — dźwięki UI nie mają być tłumione wyciszaniem `master`
    // (stop() robi rampę do 0), a przy wyjściu z gry „cofnij" ma być słyszalne
    this.uiGain.connect(this.ctx.destination);
    this.trackBuffers.clear(); // bufory były dekodowane starym kontekstem
    this.uiBuffers.clear();
    void this.loadUiClips();
    // muzyka tła menu — własne wzmocnienie prosto do wyjścia, żeby rampa `master`
    // (stop() zjeżdża do zera) ani pauza utworu jej nie dotykały
    this.loopGain = this.ctx.createGain();
    this.loopGain.gain.value = 0.0001;
    this.loopGain.connect(this.ctx.destination);
    this.loopSrc = null; // źródło ze starego kontekstu jest martwe
    this.loopBuf = null; // bufor był dekodowany starym kontekstem
    void this.loadLoopClip();
    this.startKeepAlive();
  }

  /** Wczytuje 3 klipy UI do buforów tego kontekstu (raz). */
  private async loadUiClips() {
    if (this.uiLoading || !this.ctx) return;
    this.uiLoading = true;
    const kinds: UiKind[] = ["play", "back", "buttons", "pauza"];
    await Promise.all(
      kinds.map(async (k) => {
        if (this.uiBuffers.has(k)) return;
        try {
          const res = await fetch(`assets/ui/Sounds/${k}.mp3`);
          if (!res.ok) return;
          const buf = await this.decode((await res.arrayBuffer()).slice(0));
          this.uiBuffers.set(k, buf);
        } catch {
          /* dźwięk UI jest opcjonalny */
        }
      }),
    );
    this.uiLoading = false;
  }


  /** Wczytuje pętlę tła (raz na kontekst). Klip jest opcjonalny — brak pliku
   *  albo błąd dekodowania oznacza po prostu ciszę w menu. */

  /** MP3 ma na starcie „encoder delay", a na końcu padding — kilkadziesiąt ms
   *  ciszy, której nie ma w oryginalnym PCM. `loop = true` zapętla bufor
   *  wiernie, więc ta cisza słychać jako dziurę na styku pętli. Przycinamy
   *  bufor do fragmentu z realnym sygnałem — to jest gapless dla MP3.
   *  (Zmierzone dla loop-background.mp3: 1306 próbek na starcie + 893 na końcu
   *  = 46 ms przerwy; po przycięciu 3.4807 s = równe 8 taktów przy 138 BPM.) */
  private trimForLoop(buf: AudioBuffer): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) return buf;
    const n = buf.length;
    const chans: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    const TH = 0.003; // ok. -50 dBFS — cisza kodera, nie cichy początek muzyki
    const amp = (i: number) => {
      let m = 0;
      for (const d of chans) {
        const a = Math.abs(d[i]);
        if (a > m) m = a;
      }
      return m;
    };
    let first = 0;
    while (first < n && amp(first) <= TH) first++;
    let last = n - 1;
    while (last > first && amp(last) <= TH) last--;
    const len = last - first + 1;
    if (first === 0 && len === n) return buf; // nic do przycięcia
    if (len < buf.sampleRate * 0.2) return buf; // prawie sama cisza — nie ruszamy
    try {
      const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        out.getChannelData(c).set(chans[c].subarray(first, first + len));
      }
      return out;
    } catch {
      return buf; // brak pamięci / dziwny kontekst — lepiej z dziurą niż bez muzyki
    }
  }
  private async loadLoopClip() {
    if (this.loopLoading || !this.ctx || this.loopBuf) return;
    this.loopLoading = true;
    try {
      const res = await fetch("assets/ui/Sounds/loop-background.mp3");
      if (res.ok) {
        const raw = await this.decode((await res.arrayBuffer()).slice(0));
        this.loopBuf = this.trimForLoop(raw); // bez tego slychac dziure na styku petli
      }
    } catch {
      /* muzyka tła jest opcjonalna */
    }
    this.loopLoading = false;
    if (this.loopWanted) this.startLoop(); // scena zdążyła poprosić, zanim był bufor
  }

  /** Włącza muzykę tła menu (poza rozgrywką). Można wołać wielokrotnie.
   *  Przed odblokowaniem audio zapamiętuje tylko chęć — ruszy po `unlock()`. */
  startLoop() {
    this.loopWanted = true;
    if (!this.ctx || !this.loopGain) return; // kontekstu jeszcze nie ma
    if (!this.loopBuf) {
      void this.loadLoopClip();
      return;
    }
    if (this.loopSrc) return; // już gra
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.loopBuf;
      src.loop = true;
      src.connect(this.loopGain);
      src.start();
      this.loopSrc = src;
      const g = this.loopGain.gain;
      const t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(AudioEngine.LOOP_VOL, t + 0.6); // łagodne wejście
    } catch {
      /* ignore */
    }
  }

  /** Wycisza i zatrzymuje pętlę tła (wejście do rozgrywki, zejście w tło). */
  stopLoop(fadeSec = 0.35) {
    this.loopWanted = false;
    const src = this.loopSrc;
    this.loopSrc = null;
    if (!this.ctx || !this.loopGain || !src) return;
    const g = this.loopGain.gain;
    const t = this.ctx.currentTime;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(0.0001, t + fadeSec);
    } catch {
      /* ignore */
    }
    try {
      src.stop(t + fadeSec + 0.05);
    } catch {
      /* ignore */
    }
  }

  /** Pauza rozgrywki Z dźwiękiem: najpierw gra klip „pauza", a kontekst
   *  zawieszamy dopiero gdy wybrzmi (suspend zamroziłby go w pół sekundy). */
  pauseWithSting() {
    const d = this._uiOn ? (this.uiBuffers.get("pauza")?.duration ?? 0) : 0;
    if (d > 0) this.uiSfx("pauza"); // MUSI polecieć przed pause() (patrz guard w uiSfx)
    this.pause(Math.min(d, 2));
  }
  setUiEnabled(on: boolean) {
    this._uiOn = on;
  }

  /** Testy: „przewiń" lead-in do zwykłego 0.25 s (jak poza odliczaniem). */
  skipLeadIn() {
    this.leadIn = 0.25;
    if (this.ctx) this.startTime = this.ctx.currentTime + 0.25;
    this.lastSongT = -Infinity;
  }

  /** Krótki dźwięk interfejsu (GRAJ / cofnij / przycisk). No-op, gdy kontekst
   *  jeszcze nie istnieje (pierwsze stuknięcia przed modalem „włącz dźwięk"). */
  uiSfx(kind: UiKind) {
    if (!this._uiOn || !this.ctx || !this.uiGain) return;
    const buf = this.uiBuffers.get(kind);
    if (!buf) {
      void this.loadUiClips();
      return;
    }
    // NIE wznawiamy kontekstu, gdy gra jest w PAUZIE (pauseStartMs != 0) —
    // inaczej klik „GRAJ" w menu pauzy wznawiał muzykę pod odliczaniem 3-2-1
    if ((this.ctx.state as string) !== "running") {
      if (this.pauseStartMs) return; // pauza gry — klik zostaje bez dźwięku
      void this.ctx.resume().catch(() => {});
    }
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      s.connect(this.uiGain);
      s.start();
    } catch {
      /* ignore */
    }
  }

  /** Cichy, zapętlony bufor grający bez końca — trzyma wątek renderu audio
   *  żywy na iOS Safari (bez tego `AudioContext.currentTime` zamiera na 0). */
  private startKeepAlive() {
    if (!this.ctx || this.keepAlive) return;
    try {
      const buf = this.ctx.createBuffer(1, 2205, 22050); // 0.1 s ciszy
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.ctx.destination);
      src.start(0);
      this.keepAlive = src;
    } catch {
      /* ignore */
    }
  }

  private async _unlock() {
    // KLUCZOWE dla iOS: kontekst i „kopnięcie" muszą powstać synchronicznie
    // w geście. Żadnego await PRZED tym. Nie zamykamy/nie odbudowujemy ctx
    // poza gestem — to daje `state:running` z martwym zegarem (`currentTime`
    // stoi na 0), czyli dokładnie objaw który gonimy.
    if (!this.ctx) this.buildCtx();
    const ctx = this.ctx!;

    // cichy bufor — klasyczny odblokowywacz iOS
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
    this.startKeepAlive(); // zapętlona cisza — trzyma zegar żywy

    if (ctx.state !== "running") {
      this.resumeTries++;
      await Promise.race([
        ctx.resume().then(
          () => {},
          (e) => {
            this.lastAudioErr = String((e as Error)?.message || e).slice(0, 60);
          },
        ),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
    // poczekaj aż zegar naprawdę ruszy (do ~1.2 s). Jeśli nie ruszy —
    // `start()` i tak ustawi startTime bezpiecznie względem tego, co jest.
    for (let i = 0; i < 12 && this.ctx!.currentTime === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** decodeAudioData w wersji Promise ORAZ callback (starsze Safari). */
  private decode(arr: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = (b: AudioBuffer) => {
        if (!settled) {
          settled = true;
          resolve(b);
        }
      };
      const err = (e: unknown) => {
        if (!settled) {
          settled = true;
          reject(e instanceof Error ? e : new Error("decodeAudioData failed"));
        }
      };
      try {
        const p = this.ctx!.decodeAudioData(arr, ok, err);
        if (p && typeof (p as Promise<AudioBuffer>).then === "function") {
          (p as Promise<AudioBuffer>).then(ok, err);
        }
      } catch (e) {
        err(e);
      }
      setTimeout(() => err(new Error("decodeAudioData timeout (15s)")), 15000);
    });
  }

  /** Ile sekund minęło od startu utworu wg zegara ściennego (z odjęciem pauz).
   *  Lead-in 0.25 s NIE jest tu odejmowany. */
  private wallElapsed(): number {
    const pausedMs = this.pausedTotalMs + (this.pauseStartMs ? performance.now() - this.pauseStartMs : 0);
    return (performance.now() - this.wallStartMs - pausedMs) / 1000;
  }

  /** Czy zegar AudioContextu faktycznie chodzi. „Martwy" = błąd iOS, gdzie
   *  `currentTime` STOI (jest kilka sekund za zegarem ściennym). Przejściowe
   *  zacięcie wątku (haptyka, dekodowanie) daje lag rzędu 0.1–0.3 s i NIE
   *  może przełączać zegara — inaczej `getSongTime()` skacze (nuty się cofają). */
  clockAlive(): boolean {
    if (!this.ctx || !this.wallStartMs) return true;
    const w = this.wallElapsed();
    const ctxElapsed = this.ctx.currentTime - this.ctxAtStart;
    return w < 1.0 || ctxElapsed > w - 0.9;
  }

  /** Czas utworu w sekundach (ujemny w trakcie lead-inu przed startem).
   *  Preferuje zegar AudioContextu; gdy ten NIE nadąża (błąd iOS —
   *  `currentTime` zamiera), przechodzi na performance.now().
   *  MONOTONICZNY — nigdy nie zwraca mniej niż poprzednio (nuty się nie cofają). */
  getSongTime(): number {
    if (!this.ctx || !this._running) return this.lastSongT === -Infinity ? 0 : this.lastSongT;
    const raw = !this.wallStartMs
      ? this.ctx.currentTime - this.startTime
      : this.clockAlive()
        ? this.ctx.currentTime - this.startTime
        : this.wallElapsed() - this.leadIn;
    if (raw > this.lastSongT) this.lastSongT = raw;
    return this.lastSongT;
  }

  // --- diagnostyka (do ekranu błędu na telefonie) ---
  resumeTries = 0;
  lastAudioErr = "";
  diag(): string {
    const c = this.ctx;
    return [
      `state=${c ? c.state : "brak"}`,
      `t=${c ? c.currentTime.toFixed(2) : "-"}`,
      `clock=${this.clockAlive() ? "ok" : "MARTWY"}`,
      `run=${this._running ? 1 : 0}`,
      `resume×${this.resumeTries}`,
      this.lastAudioErr ? `err:${this.lastAudioErr}` : "",
    ]
      .filter(Boolean)
      .join("  ");
  }

  isTrackLoaded(url: string) {
    return this.trackBuffers.has(url);
  }

  setSfxEnabled(on: boolean) {
    this._sfxOn = on;
  }

  /** Krótki dźwięk reakcji na trafienie (nakłada się na muzykę). */
  sfx(
    kind:
      | "perfect"
      | "great"
      | "good"
      | "miss"
      | "flow"
      | "combo"
      | "iceForm"
      | "iceCrack"
      | "iceShatter",
  ) {
    if (!this._sfxOn || !this.ctx || !this.sfxGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(this.sfxGain);

    if (kind === "iceForm" || kind === "iceCrack" || kind === "iceShatter") {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      if (kind === "iceForm") {
        // narastające „zamarzanie" — szum przez pasmo opadające, z lekkim brzękiem
        bp.type = "bandpass";
        bp.Q.value = 6;
        bp.frequency.setValueAtTime(5200, t);
        bp.frequency.exponentialRampToValueAtTime(900, t + 0.5);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        n.connect(bp).connect(g);
        this.track(n).start(t);
        n.stop(t + 0.6);
      } else if (kind === "iceCrack") {
        // pojedynczy trzask — krótki, ostry, wysoki
        bp.type = "highpass";
        bp.frequency.value = 2600;
        g.gain.setValueAtTime(0.6, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        n.connect(bp).connect(g);
        this.track(n).start(t);
        n.stop(t + 0.1);
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.setValueAtTime(1800 + Math.random() * 1400, t);
        o.frequency.exponentialRampToValueAtTime(400, t + 0.05);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.14, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.connect(og).connect(this.sfxGain);
        this.track(o).start(t);
        o.stop(t + 0.08);
      } else {
        // rozbicie — mocny wybuch szumu + spadające odłamki
        bp.type = "bandpass";
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(3400, t);
        bp.frequency.exponentialRampToValueAtTime(700, t + 0.4);
        g.gain.setValueAtTime(0.8, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        n.connect(bp).connect(g);
        this.track(n).start(t);
        n.stop(t + 0.5);
        for (let i = 0; i < 5; i++) {
          const o = ctx.createOscillator();
          o.type = "triangle";
          const f = 1400 + Math.random() * 2200;
          const st = t + 0.02 + Math.random() * 0.18;
          o.frequency.setValueAtTime(f, st);
          o.frequency.exponentialRampToValueAtTime(f * 0.4, st + 0.12);
          const og = ctx.createGain();
          og.gain.setValueAtTime(0.12, st);
          og.gain.exponentialRampToValueAtTime(0.0001, st + 0.14);
          o.connect(og).connect(this.sfxGain);
          this.track(o).start(st);
          o.stop(st + 0.16);
        }
      }
      return;
    }

    if (kind === "miss") {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      n.connect(lp).connect(g);
      this.track(n).start(t);
      n.stop(t + 0.18);
      return;
    }

    const o = ctx.createOscillator();
    o.type = "triangle";
    const base =
      kind === "perfect" ? 1320 : kind === "great" ? 1040 : kind === "good" ? 820 : kind === "flow" ? 1660 : 990;
    o.frequency.setValueAtTime(base, t);
    if (kind === "flow") o.frequency.exponentialRampToValueAtTime(base * 2, t + 0.18);
    if (kind === "combo") o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.1);
    const dur = kind === "flow" ? 0.24 : kind === "combo" ? 0.15 : 0.07;
    const peak = kind === "perfect" ? 0.5 : kind === "flow" ? 0.55 : 0.34;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.track(o).start(t);
    o.stop(t + dur + 0.03);
  }

  /** Pobiera SAME BAJTY pliku audio — BEZ tworzenia AudioContext.
   *  Kluczowe dla iOS Safari: kontekst musi powstać dopiero w geście GRAJ!,
   *  a nie w tle przy wchodzeniu do karuzeli (inaczej zostaje „suspended"
   *  i `resume()` z gestu już go nie odblokowuje). */
  async prefetch(url: string): Promise<void> {
    if (this.trackBuffers.has(url) || this.trackRaw.has(url)) return;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`audio HTTP ${res.status}`);
      this.trackRaw.set(url, await res.arrayBuffer());
    } finally {
      clearTimeout(to);
    }
  }

  /** Wczytuje i dekoduje plik audio (raz na URL). onStep raportuje etap. */
  async loadTrack(url: string, onStep?: (s: string) => void): Promise<void> {
    await this.unlock();
    if (this.trackBuffers.has(url)) return;
    let arr = this.trackRaw.get(url);
    if (!arr) {
      onStep?.("pobieranie pliku");
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`audio HTTP ${res.status}`);
        arr = await res.arrayBuffer();
      } finally {
        clearTimeout(to);
      }
    }
    onStep?.("dekodowanie dźwięku");
    // decodeAudioData „odłącza" (detach) przekazany ArrayBuffer — dajemy kopię,
    // żeby przy błędzie/timeout dekodowania oryginał w trackRaw nadał się do retry
    const buf = await this.decode(arr.slice(0));
    this.trackBuffers.set(url, buf);
    this.trackRaw.delete(url);
  }

  /** Wstrzymuje zegar i dźwięk (suspend zamraża AudioContext.currentTime).
   *  Zapisujemy moment pauzy, żeby awaryjny zegar ścienny odjął ten czas. */
  pause(stingSec = 0) {
    if (this._running && !this.pauseStartMs) this.pauseStartMs = performance.now();
    const seq = ++this.pauseSeq;
    // Podkład milknie NATYCHMIAST, niezależnie od tego, kiedy zawiesimy kontekst.
    // Przy wznowieniu `resumeFromBackground()` i tak odtwarza źródło od właściwej
    // sekundy utworu (zegar ścienny), więc zatrzymanie źródła nic nie psuje.
    try {
      this.srcNode?.stop();
    } catch {
      /* już zatrzymane */
    }
    this.srcNode = null;
    this.killScheduled(); // synteza „na żywo" też musi umilknąć
    const ctx = this.ctx;
    if (!ctx) return;
    if (stingSec > 0) {
      // Kontekst musi jeszcze chwilę chodzić, żeby wybrzmiał dźwięk pauzy —
      // suspend zamroziłby go w pół dźwięku. O tyle, o ile `currentTime`
      // pobiegnie, przesuwamy `startTime`, żeby zegar utworu stał w miejscu.
      const at = ctx.currentTime;
      setTimeout(() => {
        if (seq !== this.pauseSeq || !this.pauseStartMs) return; // wznowiono / nowy przebieg
        this.startTime += ctx.currentTime - at;
        if ((ctx.state as string) === "running") void ctx.suspend();
      }, stingSec * 1000);
      return;
    }
    if ((ctx.state as string) === "running") void ctx.suspend();
  }

  /** Wznawia po pauzie (wołać z gestu użytkownika). */
  async resumePlayback() {
    if (this.pauseStartMs) {
      this.pausedTotalMs += performance.now() - this.pauseStartMs;
      this.pauseStartMs = 0;
    }
    // WebKit ma dodatkowy stan "interrupted" (Siri / telefon / cisza) — też
    // wymaga resume(); "closed" pomijamy, bo resume rzuci.
    const s = this.ctx?.state as string | undefined;
    if (this.ctx && s && s !== "running" && s !== "closed") {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  /** Wznowienie po powrocie z tła (kliknięcie GRAJ w menu pauzy). iOS podczas
   *  dłuższej przerwy potrafi ubić źródło podkładu i keep-alive — samo `resume()`
   *  wtedy nie przywraca dźwięku. Odbudowujemy keep-alive oraz źródło od właściwej
   *  sekundy utworu (przechował ją zegar ścienny). Dotyczy i mp3, i pre-renderu
   *  syntezy (oba w `mp3Buf`); dla syntezy „na żywo" (fallback bez OfflineAudioContext)
   *  przekładamy aranż od bieżącej sekundy. */
  async resumeFromBackground() {
    await this.resumePlayback();
    if (!this.ctx || !this.master || !this._running) return;
    // keep-alive mógł zostać zakończony przez iOS — daj świeży
    try {
      this.keepAlive?.stop();
    } catch {
      /* już zatrzymany */
    }
    this.keepAlive = null;
    this.startKeepAlive();

    try {
      this.srcNode?.stop();
    } catch {
      /* ignore */
    }
    this.srcNode = null;
    const pos = Math.max(0, this.wallElapsed() - this.leadIn);

    if (this.mp3Buf) {
      const dur = this.mp3Buf.duration;
      if (pos >= dur - 0.1) return; // utwór i tak dobiega końca — gra zaraz zejdzie do wyników
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.mp3Buf;
        src.connect(this.master);
        src.start(0, Math.min(pos, dur - 0.05));
        this.srcNode = src;
      } catch {
        /* ignore */
      }
      return;
    }

    // synteza „na żywo" — przełóż aranż tak, by pozycja 0 utworu wypadła `pos` s temu
    if (this.curSong) {
      this.killScheduled();
      this.renderArrangement(
        this.ctx,
        this.master,
        this.noiseBuffer ?? this.makeNoise(this.ctx),
        this.curSong,
        this.ctx.currentTime - pos,
        (n) => this.track(n),
      );
    }
  }

  get paused() {
    const s = this.ctx?.state as string | undefined;
    return this._running && (s === "suspended" || s === "interrupted");
  }

  stop() {
    this._running = false;
    this.pauseStartMs = 0; // czysty stan — po stop() nie jesteśmy „w pauzie"
    this.pausedTotalMs = 0;
    this.lastSongT = -Infinity;
    this.mp3Buf = null;
    this.curSong = null;
    try {
      this.srcNode?.stop();
    } catch {
      /* ignore */
    }
    this.srcNode = null;
    this.killScheduled(); // ucisz wszystkie zakolejkowane głosy podkładu
    if (this.ctx) {
      try {
        this.master?.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
        this.master?.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.05);
      } catch {
        /* ignore */
      }
    }
  }

  /** Uruchamia zegar utworu. Priorytet: 1) plik audio, 2) pre-render syntezy
   *  (gra się jak plik — wznowienie po tle działa), 3) synteza na żywo (fallback).
   *  `leadInSec` = ile sekund od TERAZ zacznie grać dźwięk (3 na czas odliczania). */
  start(song: SongDef, leadInSec = 0.25) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.leadIn = leadInSec;
    // wyczyść wszystko z poprzedniego przebiegu (defensywnie — gdyby stop() nie padł)
    this.killScheduled();
    try {
      this.srcNode?.stop();
    } catch {
      /* ignore */
    }
    this.srcNode = null;
    if ((ctx.state as string) !== "running") void ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(0.9, ctx.currentTime);
    this.wallStartMs = performance.now();
    this.ctxAtStart = ctx.currentTime;
    this.pausedTotalMs = 0;
    this.pauseStartMs = 0;
    this.lastSongT = -Infinity; // nowy przebieg — zegar może wrócić do ~0
    this.curSong = song;
    const t0 = ctx.currentTime + this.leadIn;
    this.startTime = t0;
    this._running = true;

    // 1) prawdziwy plik audio
    if (song.audioUrl && this.trackBuffers.has(song.audioUrl)) {
      this.playBuffer(this.trackBuffers.get(song.audioUrl)!, t0);
      return;
    }
    // 2) pre-renderowany podkład syntezowany — jeden węzeł, jak plik
    if (this.synthBuf && this.synthBufId === song.id) {
      this.playBuffer(this.synthBuf, t0);
      return;
    }
    // 3) fallback: kolejkowanie syntezy na żywo. Po dłuższym zejściu w tło iOS
    //    potrafi ubić te głosy — resumeFromBackground() przekłada aranż.
    this.mp3Buf = null;
    this.renderArrangement(ctx, this.master, this.noiseBuffer ?? this.makeNoise(ctx), song, t0, (n) =>
      this.track(n),
    );
  }

  /** Gra bufor podkładu (plik mp3 albo pre-render syntezy) od pozycji 0 utworu,
   *  startując o `t0`. Zabezpieczenie iOS: gdy zegar ctx nie ruszy w ~0.45 s,
   *  restart źródła od właściwej sekundy (zegar ścienny). */
  private playBuffer(buf: AudioBuffer, t0: number) {
    const ctx = this.ctx!;
    this.mp3Buf = buf;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master!);
    src.start(t0);
    this.srcNode = src;
    setTimeout(() => {
      if (this._running && this.srcNode === src && !this.clockAlive()) {
        try {
          src.stop();
        } catch {
          /* ignore */
        }
        try {
          const s2 = ctx.createBufferSource();
          s2.buffer = buf;
          s2.connect(this.master!);
          const pos = Math.max(0, this.wallElapsed() - this.leadIn);
          s2.start(0, Math.min(pos, (buf.duration ?? pos) - 0.05));
          this.srcNode = s2;
        } catch {
          /* ignore */
        }
      }
    }, 450);
  }

  /** Pre-renderuje syntezowany podkład do jednego bufora (OfflineAudioContext).
   *  Dzięki temu `start()` gra go jak plik mp3: jeden węzeł, wznowienie od dowolnej
   *  sekundy po powrocie z tła, zero setek kolejkowanych oscylatorów które iOS ubija.
   *  Wołane w `prepareSong` przed odliczaniem. Cache per utwór (bpm/bars różnią render). */
  async renderSynth(song: SongDef): Promise<void> {
    if (this.synthBuf && this.synthBufId === song.id) return;
    const OAC: typeof OfflineAudioContext | undefined =
      (window as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .OfflineAudioContext ||
      (window as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OAC) return; // brak → start() użyje ścieżki „na żywo"
    const step = 60 / (song.bpm || 120) / 4;
    const barCount = Math.min(song.bars, 48);
    const sr = 44100;
    const lenSec = barCount * 16 * step + 0.6;
    let oac: OfflineAudioContext;
    try {
      oac = new OAC(1, Math.max(1, Math.ceil(lenSec * sr)), sr);
    } catch {
      return;
    }
    const master = oac.createGain();
    master.gain.value = 0.9;
    const comp = oac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(oac.destination);
    // pozycja 0 bufora = pozycja 0 utworu (bez ciszy lead-in — dobiera ją start()/resume)
    this.renderArrangement(oac, master, this.makeNoise(oac), song, 0);
    try {
      const buf = await oac.startRendering();
      this.synthBuf = buf;
      this.synthBufId = song.id;
    } catch {
      this.synthBuf = null;
      this.synthBufId = "";
    }
  }

  // ---- głosy syntezy ----------------------------------------------------

  private makeNoise(ctx: BaseAudioContext): AudioBuffer {
    const len = ctx.sampleRate * 1.0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Kolejkuje cały aranż podkładu (perkusja + bas + arp) do podanego kontekstu.
   *  Używane i na żywo (`ctx` = AudioContext, `sink` śledzi głosy do `killScheduled`),
   *  i offline (`ctx` = OfflineAudioContext, bez śledzenia) — patrz `renderSynth`. */
  private renderArrangement(
    ctx: BaseAudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    song: SongDef,
    t0: number,
    sink?: (n: AudioScheduledSourceNode) => void,
  ) {
    const keep = sink ?? (() => {});
    const beat = 60 / song.bpm;
    const step = beat / 4;

    const roots = [55.0, 43.65, 65.41, 49.0]; // A1, F1, C2, G1
    const arpSemis = [0, 7, 12, 7];

    // twardy limit taktów: ~66 węzłów/takt — 48 taktów jest bezpieczne dla
    // ścieżki „na żywo" (offline i tak radzi sobie z więcej, ale trzymamy spójnie).
    const barCount = Math.min(song.bars, 48);
    for (let bar = 0; bar < barCount; bar++) {
      const barStart = t0 + bar * 16 * step;
      const root = roots[Math.floor(bar / 2) % roots.length];
      const playBeat = bar >= song.startBar;

      [0, 4, 8, 12].forEach((s) => this.kick(ctx, dest, barStart + s * step, keep));
      [4, 12].forEach((s) => this.snare(ctx, dest, noise, barStart + s * step, keep));
      for (let s = 0; s < 16; s += 2)
        this.hat(ctx, dest, noise, barStart + s * step, s % 4 === 0 ? 0.14 : 0.09, keep);
      for (let s = 0; s < 16; s += 2) {
        const oct = s % 4 === 0 ? 1 : 2;
        this.bass(ctx, dest, barStart + s * step, root * oct, step * 1.6, keep);
      }
      const busy = playBeat && ((bar >= 8 && bar < 14) || (bar >= 18 && bar < 24));
      if (busy) {
        [2, 6, 10, 14].forEach((s, i) => {
          const semi = arpSemis[i % arpSemis.length];
          this.pluck(ctx, dest, barStart + s * step, root * 4 * Math.pow(2, semi / 12), keep);
        });
      }
    }
  }

  private kick(ctx: BaseAudioContext, dest: AudioNode, t: number, keep: (n: AudioScheduledSourceNode) => void) {
    if (t < ctx.currentTime) return; // głos w przeszłości (re-schedule po tle) — pomiń
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
    keep(o);
  }

  private snare(
    ctx: BaseAudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    t: number,
    keep: (n: AudioScheduledSourceNode) => void,
  ) {
    if (t < ctx.currentTime) return;
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp).connect(g).connect(dest);
    n.start(t);
    n.stop(t + 0.2);
    keep(n);

    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(180, t);
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.13);
    keep(o);
  }

  private hat(
    ctx: BaseAudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    t: number,
    gain: number,
    keep: (n: AudioScheduledSourceNode) => void,
  ) {
    if (t < ctx.currentTime) return;
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp).connect(g).connect(dest);
    n.start(t);
    n.stop(t + 0.06);
    keep(n);
  }

  private bass(
    ctx: BaseAudioContext,
    dest: AudioNode,
    t: number,
    freq: number,
    dur: number,
    keep: (n: AudioScheduledSourceNode) => void,
  ) {
    if (t < ctx.currentTime) return;
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = freq;
    lp.type = "lowpass";
    lp.frequency.value = 420;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    keep(o);
  }

  private pluck(
    ctx: BaseAudioContext,
    dest: AudioNode,
    t: number,
    freq: number,
    keep: (n: AudioScheduledSourceNode) => void,
  ) {
    if (t < ctx.currentTime) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.25);
    keep(o);
  }
}
