// Syntezowany podkład muzyczny + zegar-wzorzec (master clock) dla rozgrywki.
//
// Cały czas w grze liczymy względem AudioContext.currentTime, dzięki czemu
// nuty i dźwięk nie rozjeżdżają się nawet przy spadkach klatek.
//
// Docelowo: zamiast syntezy ładujemy prawdziwy plik (decodeAudioData) i gramy
// bufor; reszta API (getSongTime / start / stop) zostaje bez zmian.

import type { SongDef } from "./chart.ts";

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private startTime = 0;
  private _running = false;
  private trackBuffers = new Map<string, AudioBuffer>();
  private trackRaw = new Map<string, ArrayBuffer>(); // pobrane bajty przed dekodowaniem
  private srcNode: AudioBufferSourceNode | null = null;
  private sfxGain: GainNode | null = null;
  private _sfxOn = true;
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
    this.trackBuffers.clear(); // bufory były dekodowane starym kontekstem
  }

  private async _unlock() {
    if (!this.ctx) this.buildCtx();
    const tap = () => {
      // klasyczny trik odblokowania audio na iOS: krótki cichy bufor w geście
      try {
        const s = this.ctx!.createBufferSource();
        s.buffer = this.ctx!.createBuffer(1, 1, 22050);
        s.connect(this.ctx!.destination);
        s.start(0);
      } catch {
        /* ignore */
      }
    };
    tap();
    // resume() na iOS potrafi wisieć — próbujemy, ale nie blokujemy w nieskończoność
    if (this.ctx!.state === "suspended") {
      this.resumeTries++;
      await Promise.race([
        this.ctx!.resume().then(
          () => {},
          (e) => {
            this.lastAudioErr = String((e as Error)?.message || e).slice(0, 60);
          },
        ),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }
    // wciąż zablokowany kontekst (typowe na iOS po nieudanej próbie) — zbuduj
    // świeży i odblokuj go w TYM SAMYM geście
    if (this.ctx!.state !== "running") {
      try {
        await this.ctx!.close();
      } catch {
        /* ignore */
      }
      this.buildCtx();
      this.ctxRebuilt = true;
      tap();
      this.resumeTries++;
      await Promise.race([
        this.ctx!.resume().then(
          () => {},
          (e) => {
            this.lastAudioErr = String((e as Error)?.message || e).slice(0, 60);
          },
        ),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
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

  /** Czas utworu w sekundach (ujemny w trakcie lead-inu przed startem). */
  getSongTime(): number {
    if (!this.ctx || !this._running) return 0;
    return this.ctx.currentTime - this.startTime;
  }

  // --- diagnostyka (do ekranu błędu na telefonie) ---
  resumeTries = 0;
  ctxRebuilt = false;
  lastAudioErr = "";
  diag(): string {
    const c = this.ctx;
    return [
      `state=${c ? c.state : "brak"}`,
      `t=${c ? c.currentTime.toFixed(2) : "-"}`,
      `start=${this.startTime.toFixed(2)}`,
      `run=${this._running ? 1 : 0}`,
      `resume×${this.resumeTries}`,
      this.ctxRebuilt ? "rebuilt" : "",
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
    const buf = await this.decode(arr);
    this.trackBuffers.set(url, buf);
    this.trackRaw.delete(url);
  }

  /** Wstrzymuje zegar i dźwięk (suspend zamraża AudioContext.currentTime). */
  pause() {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  /** Wznawia po pauzie (wołać z gestu użytkownika). */
  async resumePlayback() {
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  get paused() {
    return this._running && this.ctx?.state === "suspended";
  }

  stop() {
    this._running = false;
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

  /** Uruchamia zegar utworu: prawdziwy plik audio albo syntezowany podkład. */
  start(song: SongDef) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    // wyczyść wszystko z poprzedniego przebiegu (defensywnie — gdyby stop() nie padł)
    this.killScheduled();
    try {
      this.srcNode?.stop();
    } catch {
      /* ignore */
    }
    this.srcNode = null;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(0.9, ctx.currentTime);

    // --- prawdziwy plik audio ---
    if (song.audioUrl && this.trackBuffers.has(song.audioUrl)) {
      const src = ctx.createBufferSource();
      src.buffer = this.trackBuffers.get(song.audioUrl)!;
      src.connect(this.master);
      const t0 = ctx.currentTime + 0.25;
      this.startTime = t0;
      this._running = true;
      src.start(t0);
      this.srcNode = src;
      return;
    }

    // --- syntezowany podkład ---
    const beat = 60 / song.bpm;
    const step = beat / 4;
    const t0 = ctx.currentTime + 0.25;
    this.startTime = t0;
    this._running = true;

    // Progresja basu: Am – F – C – G (po jednym akordzie na 2 takty)
    const roots = [55.0, 43.65, 65.41, 49.0]; // A1, F1, C2, G1
    const arpSemis = [0, 7, 12, 7];

    for (let bar = 0; bar < song.bars; bar++) {
      const barStart = t0 + bar * 16 * step;
      const root = roots[Math.floor(bar / 2) % roots.length];
      const playBeat = bar >= song.startBar;

      // stopa
      [0, 4, 8, 12].forEach((s) => this.kick(barStart + s * step));
      // werbel
      [4, 12].forEach((s) => this.snare(barStart + s * step));
      // hi-hat na ósemkach
      for (let s = 0; s < 16; s += 2) this.hat(barStart + s * step, s % 4 === 0 ? 0.14 : 0.09);
      // bas — pulsujące ósemki, oktawowy bounce
      for (let s = 0; s < 16; s += 2) {
        const oct = s % 4 === 0 ? 1 : 2;
        this.bass(barStart + s * step, root * oct, step * 1.6);
      }
      // delikatne arpeggio w gęstszych taktach
      const busy = playBeat && ((bar >= 8 && bar < 14) || (bar >= 18 && bar < 24));
      if (busy) {
        [2, 6, 10, 14].forEach((s, i) => {
          const semi = arpSemis[i % arpSemis.length];
          this.pluck(barStart + s * step, root * 4 * Math.pow(2, semi / 12));
        });
      }
    }
  }

  // ---- głosy syntezy ----------------------------------------------------

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 1.0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(this.master!);
    this.track(o).start(t);
    o.stop(t + 0.3);
  }

  private snare(t: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp).connect(g).connect(this.master!);
    this.track(n).start(t);
    n.stop(t + 0.2);

    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(180, t);
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.master!);
    this.track(o).start(t);
    o.stop(t + 0.13);
  }

  private hat(t: number, gain: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp).connect(g).connect(this.master!);
    this.track(n).start(t);
    n.stop(t + 0.06);
  }

  private bass(t: number, freq: number, dur: number) {
    const ctx = this.ctx!;
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
    o.connect(lp).connect(g).connect(this.master!);
    this.track(o).start(t);
    o.stop(t + dur + 0.05);
  }

  private pluck(t: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master!);
    this.track(o).start(t);
    o.stop(t + 0.25);
  }
}
