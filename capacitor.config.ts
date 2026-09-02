import type { CapacitorConfig } from "@capacitor/cli";

// DENIS Impulsywni Live — konfiguracja Capacitora (na razie tylko Android, do testów).
//
// TRYB TESTOWY: `server.url` = apka to natywna powłoka ładująca żywą stronę
// (denis-game.vercel.app). Dzięki temu API działa (ten sam origin), a każda
// zmiana w grze = tylko redeploy Vercela, bez przebudowy APK.
//
// PRZED PRODUKCJĄ: usunąć `server.url`, zbundlować `dist/` do apki (assety
// lokalnie) i dodać `Access-Control-Allow-Origin` do `/api/*` (origin
// `https://localhost` w Capacitorze). Wtedy gra działa offline poza rankingiem.
const config: CapacitorConfig = {
  appId: "pl.impulsywni.denis",
  appName: "DENIS Impulsywni Live",
  webDir: "dist",
  backgroundColor: "#0b0b12",
  server: {
    url: "https://denis-game.vercel.app",
    cleartext: false,
  },
  android: {
    backgroundColor: "#0b0b12",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 700,
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
