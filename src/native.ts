// Wykrywanie środowiska natywnego (Capacitor: Android / iOS).
// Na webie `isNative` = false i wszystkie mostki natywne są nieaktywne.

import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "android" | "ios" | "web"
