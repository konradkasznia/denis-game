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
const VERSION = "0.9.0";

const MESSAGE = "Dostępna jest nowa wersja gry z nowymi poziomami do przejścia. Uaktualnij!";

const URLS = {
  // dziś: stały link do najnowszego APK (release "android-latest" — patrz
  // .github/workflows/android.yml). Po publikacji w Google Play: podmienić
  // na https://play.google.com/store/apps/details?id=pl.impulsywni.denis
  android: "https://github.com/konradkasznia/denis-game/releases/tag/android-latest",
  // uzupełnić po publikacji w App Store
  ios: "",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allow(req, res, ["GET"])) return;
  return json(res, 200, { version: VERSION, message: MESSAGE, urls: URLS });
}
