import type { CapacitorConfig } from "@capacitor/cli";

// DENIS Impulsywni Live — Capacitor (Android; iOS w fazie późniejszej).
//
// Wersja NATYWNA: assety gry (`dist/`) są zbundlowane w APK — gra działa
// offline poza rankingiem/kontem. Backend `/api/*` wołany cross-origin z
// origin `https://localhost`, więc API ma `Access-Control-Allow-Origin: *`.
// Adres backendu wstrzykiwany przy buildzie: `VITE_API_BASE` (patrz workflow).
const config: CapacitorConfig = {
  appId: "pl.impulsywni.denis",
  appName: "DENIS Impulsywni Live",
  webDir: "dist",
  backgroundColor: "#0b0b12",
  android: {
    backgroundColor: "#0b0b12",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: false, // chowamy ręcznie, gdy gra gotowa (main.ts)
      backgroundColor: "#0b0b12",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0b12",
      overlaysWebView: false,
    },
  },
};

export default config;
