// Powiadomienia push — OneSignal.
//
// KATEGORIA: NIE-marketingowa. Wyłącznie informacje o nowej zawartości gry
// (nowe poziomy / utwory). Użytkownik włącza je świadomie przyciskiem
// „Powiadom mnie" na ekranie utworu „wkrótce", a wyłącza w Ustawieniach albo
// w ustawieniach systemu (wtedy apka też sama zdejmuje flagę).
//
// Na webie i bez skonfigurowanego OneSignal (VITE_ONESIGNAL_APP_ID) moduł jest
// bezczynny — wszystkie funkcje kończą się bez efektu, `pushAvailable()` = false.

import { isNative } from "./native.ts";

const OPT_KEY = "denis.push.optin"; // nasza flaga: user CHCE powiadomienia
const CONTENT_TAG = "nowa_zawartosc"; // tag w OneSignal do segmentacji wysyłek

// OneSignal to wtyczka Cordova — typów nie ciągniemy, trzymamy `any` + guardy.
type AnyOS = {
  initialize: (id: string) => void;
  Notifications: {
    requestPermission: (fallbackToSettings: boolean) => Promise<boolean>;
    getPermissionAsync: () => Promise<boolean>;
    addEventListener: (ev: "permissionChange", cb: (granted: boolean) => void) => void;
  };
  User: {
    addTag: (k: string, v: string) => void;
    removeTag: (k: string) => void;
    pushSubscription: { optIn: () => void; optOut: () => void };
  };
};

let OS: AnyOS | null = null;
let initTried = false;

function appId(): string {
  try {
    return (import.meta as { env?: Record<string, string> }).env?.VITE_ONESIGNAL_APP_ID || "";
  } catch {
    return "";
  }
}

/** Czy push jest w ogóle możliwy: natywna apka + skonfigurowany OneSignal. */
export function pushAvailable(): boolean {
  return isNative && !!appId();
}

async function os(): Promise<AnyOS | null> {
  if (!pushAvailable()) return null;
  if (initTried) return OS;
  initTried = true;
  try {
    const mod = (await import("onesignal-cordova-plugin")) as unknown as { default: AnyOS };
    OS = mod.default;
    OS.initialize(appId());
    // system OFF (np. user cofnął zgodę w Ustawieniach) -> wyłączamy też w apce
    OS.Notifications.addEventListener("permissionChange", (granted) => {
      if (!granted) {
        writeOptIn(false);
        try {
          OS?.User.pushSubscription.optOut();
        } catch {
          /* ignore */
        }
      }
    });
  } catch (e) {
    console.warn("OneSignal init nieudane:", e);
    OS = null;
  }
  return OS;
}

/** Woła się raz na starcie apki (natywnie). Inicjalizuje SDK i dosynchronizowuje stan. */
export async function initPush(): Promise<void> {
  if (!pushAvailable()) return;
  await os();
  await syncPushState();
}

function readOptIn(): boolean {
  try {
    return localStorage.getItem(OPT_KEY) === "1";
  } catch {
    return false;
  }
}
function writeOptIn(v: boolean) {
  try {
    if (v) localStorage.setItem(OPT_KEY, "1");
    else localStorage.removeItem(OPT_KEY);
  } catch {
    /* ignore */
  }
}

/** Szybki, synchroniczny odczyt naszej flagi — do rysowania UI bez awaita. */
export function pushOptedInSync(): boolean {
  return readOptIn();
}

/** Prosi o zgodę systemową (natywny modal) i włącza subskrypcję.
 *  Zwraca finalny stan (true = powiadomienia włączone). */
export async function enablePush(): Promise<boolean> {
  const o = await os();
  if (!o) {
    // brak SDK (web / dev) — zapamiętujemy chęć, realnie zadziała w apce
    writeOptIn(true);
    return true;
  }
  try {
    const granted = await o.Notifications.requestPermission(true);
    if (granted) {
      o.User.pushSubscription.optIn();
      o.User.addTag(CONTENT_TAG, "1");
      writeOptIn(true);
      return true;
    }
    writeOptIn(false);
    return false;
  } catch (e) {
    console.warn("enablePush nieudane:", e);
    return false;
  }
}

/** Wyłącza powiadomienia (z Ustawień). */
export async function disablePush(): Promise<void> {
  writeOptIn(false);
  const o = await os();
  try {
    o?.User.pushSubscription.optOut();
    o?.User.removeTag(CONTENT_TAG);
  } catch {
    /* ignore */
  }
}

/** Gdy user cofnął zgodę systemowo — zdejmij też naszą flagę i subskrypcję.
 *  Woła się na starcie i po powrocie apki na wierzch. */
export async function syncPushState(): Promise<void> {
  if (!readOptIn()) return;
  const o = await os();
  if (!o) return;
  try {
    const granted = await o.Notifications.getPermissionAsync();
    if (!granted) {
      writeOptIn(false);
      o.User.pushSubscription.optOut();
    }
  } catch {
    /* ignore */
  }
}
