// Wyświetla dokument (regulamin / polityka) w nakładce z <iframe> NAD grą,
// zamiast otwierać nową kartę / wyrzucać z aplikacji. Działa też w webview
// Capacitora (iframe ładuje lokalny plik z tego samego origin).

let root: HTMLDivElement | null = null;

function build() {
  if (root || typeof document === "undefined") return;
  root = document.createElement("div");
  root.id = "doc-overlay";
  root.style.cssText =
    "position:fixed;inset:0;z-index:50;display:none;flex-direction:column;background:#0b0b12";

  const bar = document.createElement("div");
  bar.style.cssText =
    "flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;" +
    "padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 12px;" +
    "background:#15121c;border-bottom:1px solid #2c2636";

  const title = document.createElement("span");
  title.id = "doc-overlay-title";
  title.style.cssText = "color:#ffce8a;font:800 17px system-ui,-apple-system,sans-serif";

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕  Zamknij";
  close.style.cssText =
    "background:#ff9f43;color:#1a0d12;border:0;border-radius:10px;padding:11px 18px;" +
    "font:800 15px system-ui,-apple-system,sans-serif;cursor:pointer";
  close.addEventListener("click", hideDoc);

  const frame = document.createElement("iframe");
  frame.id = "doc-overlay-frame";
  frame.setAttribute("title", "Dokument");
  frame.style.cssText = "flex:1 1 auto;width:100%;border:0;background:#0b0b12";

  bar.append(title, close);
  root.append(bar, frame);
  document.body.appendChild(root);
}

export function showDoc(url: string, title: string) {
  build();
  if (!root) return;
  (root.querySelector("#doc-overlay-title") as HTMLElement).textContent = title;
  (root.querySelector("#doc-overlay-frame") as HTMLIFrameElement).src = url;
  root.style.display = "flex";
}

export function hideDoc() {
  if (!root) return;
  root.style.display = "none";
  (root.querySelector("#doc-overlay-frame") as HTMLIFrameElement).src = "about:blank";
}

export function docOpen(): boolean {
  return !!root && root.style.display !== "none";
}
