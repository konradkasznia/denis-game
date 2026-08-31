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
  private srcNode: AudioBufferSourceNode | null = null;

  get running() {
    return this._running;
  }

  /** Musi być wywołane w reakcji na gest użytkownika (tap / klik). */
  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** Czas utworu w sekundach (ujemny w trakcie lead-inu przed startem). */
  getSongTime(): number {
    if (!this.ctx || !this._running) return 0;
    return this.ctx.currentTime - this.startTime;
  }

  isTrackLoaded(url: string) {
    return this.trackBuffers.has(url);
  }

  /** Wczytuje i dekoduje plik audio (raz na URL). */
  async loadTrack(url: string): Promise<void> {
    await this.unlock();
    if (this.trackBuffers.has(url)) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`audio ${res.status}: ${url}`);
    const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
    this.trackBuffers.set(url, buf);
  }

  stop() {
    this._running = false;
    try {
      this.srcNode?.stop();
    } catch {
      /* ignore */
    }
    this.srcNode = null;
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
    o.start(t);
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
    n.start(t);
    n.stop(t + 0.2);

    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(180, t);
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.master!);
    o.start(t);
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
    n.start(t);
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
    o.start(t);
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
    o.start(t);
    o.stop(t + 0.25);
  }
}
