// Nakładka z prawdziwymi polami <input> nad canvasem.
//
// Gra rysuje ramkę pola i etykietę na canvasie, a tu kładziemy dokładnie na tym
// miejscu przezroczysty <input>, żeby na telefonie wysuwała się natywna
// klawiatura (bez okienek prompt). Pozycje przeliczamy z układu gry (VW×VH) na
// piksele ekranu przez `viewport.scale` i prostokąt canvasu.

import { viewport } from "./viewport.ts";

export interface FieldSpec {
  key: string;
  type: "email" | "password" | "text";
  value: string;
  placeholder?: string;
  autocomplete?: string;
  maxLength?: number;
  enterKeyHint?: "next" | "go" | "done" | "send";
  /** prostokąt w układzie gry */
  x: number;
  y: number;
  w: number;
  h: number;
  onInput: (v: string) => void;
  onEnter?: () => void;
}

const BASE_CSS = [
  "position:fixed",
  "margin:0",
  "border:0",
  "outline:0",
  "background:transparent",
  "color:#fff7ec",
  "font-family:inherit",
  "font-weight:700",
  "letter-spacing:0.5px",
  "box-sizing:border-box",
  "pointer-events:auto",
  "touch-action:auto",
  "-webkit-appearance:none",
  "appearance:none",
  "border-radius:14px",
  "caret-color:#ff9f43",
].join(";");

export class FieldOverlay {
  private canvas: HTMLCanvasElement | null;
  private root: HTMLDivElement | null = null;
  private inputs = new Map<string, HTMLInputElement>();
  private specs = new Map<string, FieldSpec>();
  private styleInjected = false;

  constructor(canvas?: HTMLCanvasElement | null) {
    this.canvas = canvas ?? null;
  }

  private available(): boolean {
    return typeof document !== "undefined" && !!this.canvas;
  }

  private ensureRoot() {
    if (this.root || !this.available()) return;
    if (!this.styleInjected) {
      const st = document.createElement("style");
      st.textContent =
        "#field-overlay input::placeholder{color:#5c5248;font-weight:600}" +
        "#field-overlay input{transition:none}";
      document.head.appendChild(st);
      this.styleInjected = true;
    }
    const d = document.createElement("div");
    d.id = "field-overlay";
    d.style.cssText = "position:fixed;left:0;top:0;z-index:30;pointer-events:none";
    document.body.appendChild(d);
    this.root = d;
  }

  /** Ustawia zestaw pól widocznych w tej klatce (tworzy / aktualizuje / usuwa). */
  sync(specs: FieldSpec[]) {
    if (!this.available()) return;
    this.ensureRoot();
    const want = new Set(specs.map((s) => s.key));
    for (const [k, el] of this.inputs) {
      if (!want.has(k)) {
        el.remove();
        this.inputs.delete(k);
        this.specs.delete(k);
      }
    }
    for (const s of specs) {
      let el = this.inputs.get(s.key);
      if (!el) {
        el = document.createElement("input");
        el.type = s.type;
        el.setAttribute("autocomplete", s.autocomplete || "off");
        el.enterKeyHint = s.enterKeyHint || "done";
        if (s.maxLength) el.maxLength = s.maxLength;
        if (s.type === "email" || s.type === "text") {
          el.setAttribute("autocapitalize", s.type === "email" ? "none" : "sentences");
          el.setAttribute("autocorrect", "off");
          el.spellcheck = false;
        }
        if (s.type === "email") el.inputMode = "email";
        el.placeholder = s.placeholder || "";
        el.value = s.value;
        el.style.cssText = BASE_CSS;
        const key = s.key;
        el.addEventListener("input", () => this.specs.get(key)?.onInput(el!.value));
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const spec = this.specs.get(key);
            if (spec?.onEnter) {
              el!.blur();
              spec.onEnter();
            }
          }
        });
        this.root!.appendChild(el);
        this.inputs.set(key, el);
      } else {
        if (el.type !== s.type) el.type = s.type; // pokaż/ukryj hasło
        if (document.activeElement !== el && el.value !== s.value) {
          // zewnętrzny reset (np. zmiana trybu czyści hasło)
          el.value = s.value;
        }
      }
      this.specs.set(s.key, s);
    }
    this.reposition();
  }

  /** Przelicza pozycje pól (po resize / zmianie orientacji / scrollu klawiatury). */
  reposition() {
    if (!this.canvas || this.inputs.size === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const sc = viewport.scale || 1;
    for (const [k, el] of this.inputs) {
      const s = this.specs.get(k);
      if (!s) continue;
      el.style.left = `${Math.round(rect.left + s.x * sc)}px`;
      el.style.top = `${Math.round(rect.top + s.y * sc)}px`;
      el.style.width = `${Math.round(s.w * sc)}px`;
      el.style.height = `${Math.round(s.h * sc)}px`;
      // 16px minimum, żeby iOS nie zoomował przy focusie
      el.style.fontSize = `${Math.max(16, Math.round(19 * sc))}px`;
      el.style.paddingLeft = `${Math.round(20 * sc)}px`;
      el.style.paddingRight = `${Math.round(16 * sc)}px`;
      // etykieta jest rysowana na canvasie w górnej części ramki — tekst niżej
      el.style.paddingTop = `${Math.round(30 * sc)}px`;
      el.style.paddingBottom = `${Math.round(6 * sc)}px`;
    }
  }

  /** Zdejmuje focus z aktywnego pola (chowa klawiaturę). */
  blur() {
    if (typeof document === "undefined") return;
    for (const el of this.inputs.values()) if (document.activeElement === el) el.blur();
  }

  /** Usuwa wszystkie pola (wyjście z ekranu logowania / nicku). */
  clear() {
    if (this.inputs.size === 0) return;
    for (const el of this.inputs.values()) el.remove();
    this.inputs.clear();
    this.specs.clear();
  }
}
