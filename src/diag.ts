// Diagnostyka natywnej apki iOS. Wpisy idą dwoma drogami:
//  - do logu systemowego iPhone'a (MainViewController w ios/App/App/AppDelegate.swift,
//    prefiks DENISDIAG), gdy handler `diag` jest dostępny;
//  - paczkami co sekundę na serwer (`/api/diag` → logi Vercela), bo log systemowy
//    bywa niedostępny, a bez Maca nie ma Web Inspectora.
// Na webie i Androidzie to no-op.

import { apiBase } from "./net.ts";
import { platform } from "./native.ts";

const handler: { postMessage(m: string): void } | undefined =
  typeof window !== "undefined" ? (window as any).webkit?.messageHandlers?.diag : undefined;

// Domyślnie WYŁĄCZONE (wersja w App Store nie wysyła żadnych logów). Na czas
// szukania błędów: build z VITE_DIAG=1 (np. `VITE_DIAG=1 npm run build` + deploy).
const diagEnabled = (import.meta as { env?: Record<string, string> }).env?.VITE_DIAG === "1";
export const diagActive = diagEnabled && typeof window !== "undefined" && platform === "ios";

const t0 = performance.now();
const sid = Math.random().toString(36).slice(2, 8);
let queue: string[] = [];
let lastFlush = 0;

function flush() {
  if (!queue.length) return;
  const lines = queue;
  queue = [];
  lastFlush = performance.now();
  try {
    void fetch(`${apiBase()}/api/diag`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ s: sid, lines }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function diag(msg: string): void {
  if (!diagActive) return;
  const line = `${((performance.now() - t0) / 1000).toFixed(2)}s ${msg}`;
  try {
    handler?.postMessage(line);
  } catch {
    /* ignore */
  }
  queue.push(line);
  // szybko, bo proces może zaraz zginąć (jetsam) — nie czekamy na pełną sekundę
  if (performance.now() - lastFlush > 250) flush();
}

/** Liczniki alokacji: płótna, bufory audio, obrazki. */
export const diagStats = { canvases: 0, canvasMB: 0, audioBufs: 0, audioMB: 0, offline: 0, images: 0, decodes: 0 };

function hookAllocations() {
  const cw = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
  const ch = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height");
  if (cw?.set && cw.get && ch?.get) {
    Object.defineProperty(HTMLCanvasElement.prototype, "width", {
      ...cw,
      set(this: HTMLCanvasElement, v: number) {
        cw.set!.call(this, v);
        const mb = (Number(v) * ch.get!.call(this) * 4) / 1048576;
        diagStats.canvasMB += mb;
        if (mb > 8) diag(`canvas big ${v}x${ch.get!.call(this)} ${mb.toFixed(0)}MB`);
      },
    });
  }
  const origCreate = Document.prototype.createElement;
  Document.prototype.createElement = function (this: Document, tag: string, o?: ElementCreationOptions) {
    if (String(tag).toLowerCase() === "canvas") diagStats.canvases++;
    return origCreate.call(this, tag, o);
  } as typeof Document.prototype.createElement;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (AC) {
    const origBuf = AC.prototype.createBuffer;
    AC.prototype.createBuffer = function (c: number, len: number, sr: number) {
      diagStats.audioBufs++;
      diagStats.audioMB += (c * len * 4) / 1048576;
      return origBuf.call(this, c, len, sr);
    };
    const origDecode = AC.prototype.decodeAudioData;
    AC.prototype.decodeAudioData = function (...a: any[]) {
      diagStats.decodes++;
      diag(`decodeAudioData ${(a[0]?.byteLength / 1e6).toFixed(2)}MB`);
      return origDecode.apply(this, a);
    };
    const origCtor = AC;
    let ctxCount = 0;
    const Wrapped = function (...a: any[]) {
      ctxCount++;
      diag(`new AudioContext #${ctxCount}`);
      return new origCtor(...a);
    } as any;
    Wrapped.prototype = origCtor.prototype;
    if ((window as any).AudioContext) (window as any).AudioContext = Wrapped;
    else (window as any).webkitAudioContext = Wrapped;
  }
  const OAC = (window as any).OfflineAudioContext;
  if (OAC) {
    const W = function (...a: any[]) {
      diagStats.offline++;
      diag(`OfflineAudioContext ${JSON.stringify(a).slice(0, 80)}`);
      return new OAC(...a);
    } as any;
    W.prototype = OAC.prototype;
    (window as any).OfflineAudioContext = W;
  }
  const OrigImage = window.Image;
  const WI = function (w?: number, h?: number) {
    diagStats.images++;
    return new OrigImage(w, h);
  } as any;
  WI.prototype = OrigImage.prototype;
  (window as any).Image = WI;
  setInterval(() => {
    const s = diagStats;
    diag(`hb canv=${s.canvases} canvMB=${s.canvasMB.toFixed(0)} img=${s.images} abuf=${s.audioBufs} abufMB=${s.audioMB.toFixed(0)} dec=${s.decodes} off=${s.offline}`);
    flush();
  }, 1000);
}

if (diagActive) {
  try {
    hookAllocations();
  } catch (e) {
    diag(`hook fail ${(e as Error)?.message}`);
  }
  window.addEventListener("error", (e) => diag(`ERR ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => diag(`REJ ${String((e as PromiseRejectionEvent).reason).slice(0, 200)}`));
  diag(`boot ${location.origin} dpr=${devicePixelRatio} ${innerWidth}x${innerHeight} handler=${!!handler}`);
  addEventListener("pagehide", flush);
}
