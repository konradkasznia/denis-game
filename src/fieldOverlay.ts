// Nakładka z prawdziwymi polami <input> nad canvasem.
//
// Gra rysuje etykietę pola nad ramką, a tu kładziemy na miejscu ramki prawdziwy
// <input> (z własnym, półprzezroczystym tłem), żeby na telefonie wysuwała się
// natywna klawiatura. Pozycje przeliczamy z układu gry (VW×VH) na piksele ekranu
// przez `viewport.scale` i prostokąt canvasu.
//
// WAŻNE (iOS): nie ruszamy stylów pola co klatkę — tylko gdy realnie się zmieni
// układ (sygnatura) albo przyjdzie zdarzenie resize. Ciągłe zapisy stylów do
// pola z focusem powodują „mruganie" klawiatury.

import { viewport } from "./viewport.ts";

export interface FieldSpec {
  key: string;
  type: "password" | "text";
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
  "background:rgba(9,7,13,0.86)",
  "border:1.5px solid rgba(255,206,138,0.30)",
  "outline:0",
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
  private sig = "";

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
        "#field-overlay input::placeholder{color:#7a6c5e;font-weight:600}" +
        "#field-overlay input:focus{border-color:#ff9f43;background:rgba(14,11,18,0.92)}";
      document.head.appendChild(st);
      this.styleInjected = true;
    }
    const d = document.createElement("div");
    d.id = "field-overlay";
    d.style.cssText = "position:fixed;left:0;top:0;z-index:30;pointer-events:none";
    document.body.appendChild(d);
    this.root = d;
  }

  private layoutSig(specs: FieldSpec[]): string {
    const rect = this.canvas ? this.canvas.getBoundingClientRect() : ({ left: 0, top: 0 } as DOMRect);
    const sc = Math.round((viewport.scale || 1) * 1000);
    const base = `${Math.round(rect.left)},${Math.round(rect.top)},${sc}`;
    return base + "|" + specs.map((s) => `${s.key}:${s.type}:${s.x},${s.y},${s.w},${s.h}`).join(";");
  }

  /** Ustawia zestaw pól. DOM ruszamy tylko gdy zmieni się układ (sygnatura). */
  sync(specs: FieldSpec[]) {
    if (!this.available()) return;
    const nextSig = this.layoutSig(specs);
    if (nextSig === this.sig && this.inputs.size === specs.length) return;
    this.sig = nextSig;
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
        el.setAttribute("autocapitalize", "none");
        el.setAttribute("autocorrect", "off");
        el.spellcheck = false;
        el.enterKeyHint = s.enterKeyHint || "done";
        if (s.maxLength) el.maxLength = s.maxLength;
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
      } else if (el.type !== s.type) {
        el.type = s.type; // pokaż / ukryj hasło
      }
      // wartość z zewnątrz podmieniamy tylko gdy pole nie jest edytowane
      if (document.activeElement !== el && el.value !== s.value) el.value = s.value;
      this.specs.set(s.key, s);
    }
    this.reposition();
  }

  /** Przelicza pozycje pól (po resize / zmianie orientacji). */
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
      el.style.fontSize = `${Math.max(16, Math.round(20 * sc))}px`;
      el.style.paddingLeft = `${Math.round(18 * sc)}px`;
      el.style.paddingRight = `${Math.round(18 * sc)}px`;
      el.style.paddingTop = "0px";
      el.style.paddingBottom = "0px";
    }
  }

  /** Czy któreś z pól ma teraz focus (klawiatura otwarta). */
  isFocused(): boolean {
    if (typeof document === "undefined") return false;
    for (const el of this.inputs.values()) if (document.activeElement === el) return true;
    return false;
  }

  /** Zdejmuje focus z aktywnego pola (chowa klawiaturę). */
  blur() {
    if (typeof document === "undefined") return;
    for (const el of this.inputs.values()) if (document.activeElement === el) el.blur();
  }

  /** Usuwa wszystkie pola (wyjście z ekranu logowania). */
  clear() {
    this.sig = "";
    if (this.inputs.size === 0) return;
    for (const el of this.inputs.values()) el.remove();
    this.inputs.clear();
    this.specs.clear();
  }
}
