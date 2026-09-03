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
  /** ikonka „oczko" w polu (podgląd hasła). `revealed` = hasło widoczne. */
  reveal?: { revealed: boolean; onToggle: () => void };
  /** ikonka statusu po prawej w polu: zielony ✓ / czerwony ✗ (nieklikalna). */
  status?: "ok" | "bad" | null;
  /** czerwony obrys pola, gdy błąd dotyczy tego inputu. */
  error?: boolean;
}

const EYE_OPEN =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ffce8a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#c9b7a6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c7 0 10.5 6 10.5 6a17 17 0 0 1-3.4 4M6.2 8.2A16.7 16.7 0 0 0 1.5 12S5 18 12 18a10 10 0 0 0 4-.8"/><path d="M9.8 9.8a3.2 3.2 0 0 0 4.4 4.4"/></svg>';
const ICON_OK =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#3ddc84" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>';
const ICON_BAD =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

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
  "border-radius:11px",
  "caret-color:#ff9f43",
].join(";");

export class FieldOverlay {
  private canvas: HTMLCanvasElement | null;
  private root: HTMLDivElement | null = null;
  private inputs = new Map<string, HTMLInputElement>();
  private eyes = new Map<string, HTMLButtonElement>();
  private statusIcons = new Map<string, HTMLSpanElement>();
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
        "#field-overlay input:focus{border-color:#ff9f43;background:rgba(14,11,18,0.92)}" +
        "#field-overlay input.fld-err{border-color:#ff3b3b;box-shadow:0 0 0 2px rgba(255,59,59,0.38)}" +
        "#field-overlay input.fld-err:focus{border-color:#ff6161}";
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
    return (
      base +
      "|" +
      specs
        .map(
          (s) =>
            `${s.key}:${s.type}:${s.x},${s.y},${s.w},${s.h}:${s.reveal ? +s.reveal.revealed : "n"}:${s.status ?? "n"}:${s.error ? "e" : "n"}`,
        )
        .join(";")
    );
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
    for (const [k, btn] of this.eyes) {
      const spec = specs.find((s) => s.key === k);
      if (!spec || !spec.reveal) {
        btn.remove();
        this.eyes.delete(k);
      }
    }
    for (const [k, icon] of this.statusIcons) {
      const spec = specs.find((s) => s.key === k);
      if (!spec || !spec.status) {
        icon.remove();
        this.statusIcons.delete(k);
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

      el.classList.toggle("fld-err", !!s.error);

      // oczko w polu
      if (s.reveal) {
        let btn = this.eyes.get(s.key);
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.tabIndex = -1;
          btn.setAttribute("aria-label", "Pokaż lub ukryj hasło");
          btn.style.cssText =
            "position:fixed;display:flex;align-items:center;justify-content:center;" +
            "background:transparent;border:0;padding:0;margin:0;cursor:pointer;" +
            "pointer-events:auto;-webkit-tap-highlight-color:transparent";
          const key = s.key;
          // pointerdown + preventDefault -> nie zabiera focusu polu (klawiatura zostaje)
          btn.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.specs.get(key)?.reveal?.onToggle();
          });
          this.root!.appendChild(btn);
          this.eyes.set(key, btn);
        }
        btn.innerHTML = s.reveal.revealed ? EYE_OFF : EYE_OPEN;
      }

      // ikonka statusu (✓ / ✗) w polu — nieklikalna
      if (s.status) {
        let icon = this.statusIcons.get(s.key);
        if (!icon) {
          icon = document.createElement("span");
          icon.style.cssText =
            "position:fixed;display:flex;align-items:center;justify-content:center;" +
            "pointer-events:none;-webkit-tap-highlight-color:transparent";
          this.root!.appendChild(icon);
          this.statusIcons.set(s.key, icon);
        }
        icon.innerHTML = s.status === "ok" ? ICON_OK : ICON_BAD;
      }

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
      const left = Math.round(rect.left + s.x * sc);
      const top = Math.round(rect.top + s.y * sc);
      const w = Math.round(s.w * sc);
      const h = Math.round(s.h * sc);
      const adornW = s.reveal || s.status ? Math.round(52 * sc) : 0;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.fontSize = `${Math.max(16, Math.round(20 * sc))}px`;
      el.style.paddingLeft = `${Math.round(18 * sc)}px`;
      el.style.paddingRight = `${Math.round(18 * sc) + adornW}px`;
      el.style.paddingTop = "0px";
      el.style.paddingBottom = "0px";
      const bs = Math.round(44 * sc);
      const iss = Math.max(18, Math.round(24 * sc));
      const adornLeft = `${left + w - adornW - Math.round(4 * sc)}px`;
      const adornTop = `${top + (h - bs) / 2}px`;
      const btn = this.eyes.get(k);
      if (btn) {
        btn.style.left = adornLeft;
        btn.style.top = adornTop;
        btn.style.width = `${bs}px`;
        btn.style.height = `${bs}px`;
        const svg = btn.querySelector("svg");
        if (svg) {
          svg.setAttribute("width", `${iss}`);
          svg.setAttribute("height", `${iss}`);
        }
      }
      const icon = this.statusIcons.get(k);
      if (icon) {
        icon.style.left = adornLeft;
        icon.style.top = adornTop;
        icon.style.width = `${bs}px`;
        icon.style.height = `${bs}px`;
        const svg = icon.querySelector("svg");
        if (svg) {
          svg.setAttribute("width", `${iss}`);
          svg.setAttribute("height", `${iss}`);
        }
      }
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
    if (this.inputs.size === 0 && this.eyes.size === 0 && this.statusIcons.size === 0) return;
    for (const el of this.inputs.values()) el.remove();
    for (const btn of this.eyes.values()) btn.remove();
    for (const icon of this.statusIcons.values()) icon.remove();
    this.inputs.clear();
    this.eyes.clear();
    this.statusIcons.clear();
    this.specs.clear();
  }
}
