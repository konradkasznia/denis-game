// Wykrywanie środowiska natywnego (Capacitor: Android / iOS).
// Na webie `isNative` = false i wszystkie mostki natywne są nieaktywne.

import { Capacitor } from "@capacitor/core";
import { AppLauncher } from "@capacitor/app-launcher";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "android" | "ios" | "web"

/** Otwiera link poza grą (Spotify, TikTok, sklep) przez system: na Androidzie
 *  Intent ACTION_VIEW (otwiera aplikację Spotify/TikTok, jeśli jest), na iOS
 *  UIApplication.open. Samo `window.open(url, "_system")` w WebView Androida
 *  bywało blokowane, bo tap gry idzie z pointerdown, a to dla Chrome nie jest
 *  „gestem" uprawniającym do otwarcia okna — przycisk Spotify nic nie robił. */
export async function openUrlNative(url: string): Promise<boolean> {
  try {
    const r = await AppLauncher.openUrl({ url });
    return r.completed !== false;
  } catch {
    return false;
  }
}
