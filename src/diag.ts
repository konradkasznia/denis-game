// Diagnostyka natywnej apki iOS: krótkie komunikaty do logu systemowego iPhone'a
// (MainViewController w ios/App/App/AppDelegate.swift → os_log z prefiksem
// DENISDIAG). Czytane z Windowsa przez `ios syslog` (go-ios), bo bez Maca nie
// ma Web Inspectora. Na webie i Androidzie (brak handlera) to no-op.

const handler: { postMessage(m: string): void } | undefined = (window as any).webkit?.messageHandlers?.diag;

const t0 = performance.now();

export function diag(msg: string): void {
  if (!handler) return;
  try {
    handler.postMessage(`${((performance.now() - t0) / 1000).toFixed(2)}s ${msg}`);
  } catch {
    /* ignore */
  }
}

export const diagActive = !!handler;

/** Liczniki alokacji (tylko natywnie z diagnostyką): płótna i bufory audio. */
export const diagStats = { canvases: 0, canvasMB: 0, audioBufs: 0, audioMB: 0, offline: 0, images: 0 };

function hookAllocations() {
  const cw = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
  const ch = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height");
  if (cw?.set && ch?.set && cw.get && ch.get) {
    const add = (el: HTMLCanvasElement, w: number, h: number) => {
      const mb = (w * h * 4) / 1048576;
      diagStats.canvasMB += mb;
      if (mb > 8) diag(`canvas big ${w}x${h} ${mb.toFixed(0)}MB`);
      void el;
    };
    Object.defineProperty(HTMLCanvasElement.prototype, "width", {
      ...cw,
      set(v: number) {
        cw.set!.call(this, v);
        add(this, Number(v), ch.get!.call(this));
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
  }
  const OAC = (window as any).OfflineAudioContext;
  if (OAC) {
    (window as any).OfflineAudioContext = function (...a: any[]) {
      diagStats.offline++;
      diag(`OfflineAudioContext ${JSON.stringify(a).slice(0, 80)}`);
      return new OAC(...a);
    };
    (window as any).OfflineAudioContext.prototype = OAC.prototype;
  }
  const OrigImage = window.Image;
  (window as any).Image = function (w?: number, h?: number) {
    diagStats.images++;
    return new OrigImage(w, h);
  };
  (window as any).Image.prototype = OrigImage.prototype;
  setInterval(() => {
    const s = diagStats;
    diag(`hb canv=${s.canvases} canvMB=${s.canvasMB.toFixed(0)} img=${s.images} abuf=${s.audioBufs} abufMB=${s.audioMB.toFixed(0)} off=${s.offline}`);
  }, 1000);
}

if (handler) {
  try {
    hookAllocations();
  } catch (e) {
    diag(`hook fail ${(e as Error)?.message}`);
  }
  window.addEventListener("error", (e) => diag(`ERR ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => diag(`REJ ${String((e as PromiseRejectionEvent).reason).slice(0, 200)}`));
  diag(`boot dpr=${devicePixelRatio} ${innerWidth}x${innerHeight}`);
}
