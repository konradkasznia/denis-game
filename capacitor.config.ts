import type { CapacitorConfig } from "@capacitor/cli";

// DENIS Impulsywni Live — Capacitor (Android; iOS w fazie późniejszej).
//
// Dwa warianty budowania:
//  - PRODUKCJA (domyślnie): assety gry (`dist/`) zbundlowane w APK — gra działa
//    offline poza rankingiem/kontem.
//  - DEV-SHELL: gdy ustawione `CAP_SERVER_URL`, apka to cienka powłoka, która
//    ładuje żywą stronę z tego adresu (szybka iteracja — deploy web zamiast
//    rebuilda APK). Buduje job `.github/workflows/android-dev.yml`.
//
// Backend `/api/*` wołany cross-origin z origin `https://localhost` (albo
// `https://denis-game.vercel.app` w dev-shell), więc API ma
// `Access-Control-Allow-Origin: *`. `VITE_API_BASE` (build web) → adres backendu.
const serverUrl = process.env.CAP_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "pl.impulsywni.denis",
  appName: "DENIS Impulsywni Live",
  webDir: "dist",
  backgroundColor: "#0b0b12",
  ...(serverUrl
    ? { server: { url: serverUrl, cleartext: false, androidScheme: "https" } }
    : {}),
  android: {
    backgroundColor: "#0b0b12",
  },
  plugins: {
    SplashScreen: {
      // chowamy ręcznie po 1. klatce (main.ts); auto-hide = twardy bezpiecznik
      launchShowDuration: 2500,
      launchAutoHide: true,
      backgroundColor: "#0b0b12",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0b12",
      overlaysWebView: false,
    },
    Keyboard: {
      // NIE zmieniaj rozmiaru WebView przy klawiaturze — canvas jest 100vh i
      // przeskalowanie w trakcie pisania powoduje „skakanie" układu. Pola
      // <input> (fieldOverlay) same przesuwają się nad klawiaturę.
      resize: "none",
      style: "DARK",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
