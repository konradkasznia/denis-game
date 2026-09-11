// Sprawdzanie dostępności nowej wersji APLIKACJI (nie mylić z syncSession —
// to tam sprawdzamy postęp GRACZA). Działa niezależnie od tego, jak apka jest
// dystrybuowana dzisiaj (surowy APK z GitHub) i jutro (Google Play / App
// Store): serwer trzyma jeden mały rekord „aktualna wersja + link", a klient
// porównuje go z lokalnym numerkiem wbudowanym w build (APP_VERSION w
// game.ts). Dzięki temu przejście na sklepy nie wymaga zmiany tego modułu —
// wystarczy zaktualizować `api/app-version.ts` (docelowo: linki do Play/App
// Store zamiast release'u na GitHubie).
//
// Web NIE jest sprawdzany — przeglądarka zawsze ładuje to, co jest wdrożone,
// więc pojęcie „stara wersja" tam nie istnieje.

import { isNative, platform } from "./native.ts";
import { api, backendReachable } from "./net.ts";

export interface UpdateInfo {
  version: string;
  url: string;
  message: string;
}

const DISMISSED_KEY = "denis.updateDismissed";

function versionParts(v: string): number[] {
  return String(v)
    .trim()
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/** true, gdy `a` jest nowsza niż `b` (porównanie X.Y.Z segment po segmencie). */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Ostatnia wersja, którą gracz świadomie odrzucił („Nie teraz") — nie
 *  nagabujemy o nią ponownie, ale NOWSZA wersja niż ta i tak pokaże modal. */
export function dismissedUpdateVersion(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) || "";
  } catch {
    return "";
  }
}
export function dismissUpdate(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* ignore */
  }
}

interface ServerAppVersion {
  version?: string;
  message?: string;
  url?: string;
  urls?: { android?: string; ios?: string };
}

/** Pyta serwer o najnowszą wersję. Zwraca info do modala/przycisku w
 *  Ustawieniach TYLKO gdy jest faktycznie nowsza niż `currentVersion` i
 *  serwer ma dla tej platformy link do aktualizacji. `null` = nic do pokazania
 *  (apka aktualna, offline, web, albo brak linku dla tej platformy). */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  if (!isNative || !backendReachable()) return null;
  try {
    const r = await api<ServerAppVersion>("/api/app-version");
    if (!r?.version || !isNewerVersion(r.version, currentVersion)) return null;
    const url = (platform === "ios" ? r.urls?.ios : r.urls?.android) || r.url || "";
    if (!url) return null;
    return {
      version: r.version,
      url,
      message: r.message || "Dostępna jest nowa wersja gry.",
    };
  } catch {
    return null; // offline / backend nieosiągalny — nie nagabujemy, spróbujemy przy następnym starcie
  }
}
