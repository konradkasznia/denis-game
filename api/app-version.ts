// Najnowsza wersja APLIKACJI (nie mylić z zawartością gry) + link do
// aktualizacji. Sprawdzane przez klienta (src/appUpdate.ts) przy starcie —
// TYLKO natywnie (APK/Play Store/App Store), web zawsze jest aktualny.
//
//   GET /api/app-version → { version, message, urls: { android, ios } }
//
// Statyczne — bez bazy, bez auth (to nie są dane usera). Przy każdym REALNYM
// wydaniu nowej wersji: podbij `VERSION` tutaj ORAZ `APP_VERSION` w
// src/game.ts, i zaktualizuj linki (dziś: release na GitHubie / APK poza
// sklepem; po publikacji: adresy Google Play i App Store).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allow, json } from "./_lib/util.js";

// Musi zgadzać się z APP_VERSION w src/game.ts w chwili wydania. Zostaw RÓWNE
// bieżącej wersji apki, dopóki nie ma czego ogłaszać — inaczej modal
// "aktualizacja dostępna" pokaże się wszystkim bez faktycznej nowej wersji.
const VERSION = "0.9.1";

const MESSAGE =
  "Dostępna jest nowa wersja gry. Uaktualnij! Jeśli przycisk nie zadziała, otwórz App Store lub Sklep Google Play i zaktualizuj grę.";

// WYMUSZONA aktualizacja (blokujący ekran bez „Nie teraz"): apka starsza niż
// MIN_VERSION danej platformy nie da się używać, dopóki gracz nie zaktualizuje.
// Zasada: podbijamy przy KAŻDYM wydaniu z nowymi rundami — ale dopiero gdy ta
// wersja jest NAPRAWDĘ dostępna w danym sklepie (iOS i Android wychodzą osobno,
// dlatego osobne progi). Działa w apkach od 1.0.1 (1.0 zna tylko miękki modal).
const MIN_VERSION = { ios: "1.0", android: "1.0" };

const URLS = {
  android: "https://play.google.com/store/apps/details?id=pl.impulsywni.denis",
  ios: "https://apps.apple.com/app/id6819725079",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET"])) return;
  return json(res, 200, {
    version: VERSION,
    message: MESSAGE,
    urls: URLS,
    minVersion: MIN_VERSION,
    forceMessage:
      "Nowa wersja gry ma nowe rundy! Zaktualizuj aplikację, żeby grać dalej. Jeśli przycisk nie zadziała, otwórz App Store lub Sklep Google Play i zaktualizuj grę.",
  });
}
