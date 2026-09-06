# TODO — DENIS Impulsywni Live

Lista rzeczy odłożonych na później. Dopisujemy tu zamiast rozpraszać po commitach.

## Przed premierą

- [ ] **Przetestować powiadomienia (OneSignal / push)** — pełny obieg: zgoda systemowa,
      dostarczenie, deep-link do właściwego ekranu, iOS + Android. Krytyczne przed premierą.
- [ ] **APK iOS: audio po głębokim tle** — na mobilnym Safari po zminimalizowaniu +
      wygaszeniu ekranu + powrocie NIE wraca dźwięk (muzyka ani klawisze), pomaga tylko
      reload strony. Mobilny Safari używa kategorii `ambient` i dławi WebAudio najmocniej.
      W APK (Capacitor/WKWebView) mamy kontrolę nad `AVAudioSession` — ustawić kategorię
      `playback` (np. `capacitor-plugin-native-audio` / własny bridge) i PRZETESTOWAĆ NA
      URZĄDZENIU ten sam scenariusz. Jeśli w APK też pada: watchdog wykrywa martwy zegar
      po powrocie z tła i pokazuje „stuknij, aby wznowić dźwięk" → twardy rebuild
      AudioContextu w tym geście (jedyny pewny fix na WebKicie). Web-Safari zostaje jak
      jest (użytkownik OK z tym, że apka to docelowo natywka). Patrz `SAFARI-AUDIO-BUG.md`.

## Rozgrywka

- [ ] **Samouczki przed zaawansowanymi rundami** — krótkie wprowadzenie do nowych
      mechanik (bomby, lód, płonące nutki, pijany ekran) tuż przed rundą, w której
      się pojawiają. Jeszcze nie teraz.

## Audio (iOS)

- [x] ~~Podkład syntezowany po powrocie z tła~~ — ZROBIONE (2026-09-06):
      `audio.renderSynth()` pre-renderuje aranż do jednego `AudioBuffer`
      (OfflineAudioContext), `start()` gra go jak mp3, `resumeFromBackground()`
      wznawia od właściwej sekundy. Fallback (brak OfflineAudioContext):
      przełożenie live-aranżu. Patrz `SAFARI-AUDIO-BUG.md`.
- [ ] **Docelowo: prawdziwe mp3 pod rundy 2–3** — synth to placeholder.
      Gdy będą pliki, `public/charts/<id>.json` z `audioUrl` + realny chart;
      pre-render syntezy przestanie być używany dla tych utworów.
