// Mostek do funkcji natywnych (Capacitor / Android). Na webie wszystko no-op.
//
// - splash: chowany ręcznie gdy gra gotowa (żeby nie było błysku czarnego canvasu)
// - status bar: ciemny, kolor tła jak gra
// - sprzętowy „wstecz": cofa ekran w grze, a na ekranie głównym wychodzi z apki
// - schowanie apki w tło: pauza rozgrywki

import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import type { Game } from "./game.ts";
import { setLoopActive } from "./main.ts";
import { isNative } from "./native.ts";

let splashHidden = false;

export function hideSplash() {
  if (splashHidden || !isNative) return;
  splashHidden = true;
  void SplashScreen.hide().catch(() => {});
}

export function initNativeShell(game: Game) {
  if (!isNative) return;

  void (async () => {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: "#0b0b12" }).catch(() => {});
    } catch {
      /* iOS / brak wsparcia — trudno */
    }
  })();

  void App.addListener("backButton", () => {
    if (!game.handleBack()) void App.exitApp();
  });

  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      setLoopActive(true);
      game.onAppForeground();
    } else {
      game.onAppBackground(); // pauza PRZED zatrzymaniem pętli
      setLoopActive(false); // w tle pętla renderu całkiem stoi (bateria / temperatura)
    }
  });

  // klawiatura (resize:"none" w config) — gra sama podnosi układ logowania,
  // żeby pole z focusem nie chowało się za klawiaturą
  void Keyboard.addListener("keyboardWillShow", (info) => {
    game.onKeyboard(info?.keyboardHeight || 0);
  }).catch(() => {});
  void Keyboard.addListener("keyboardWillHide", () => game.onKeyboard(0)).catch(() => {});

  // bezpiecznik: gdyby gra nie zdążyła zawołać hideSplash()
  setTimeout(hideSplash, 4000);
}
