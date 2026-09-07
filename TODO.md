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

- Samouczki przed rundami — **ODRZUCONE** (Konrad, 2026-09-07). Zostają same znaki
  ostrzegawcze na sliderze + info po kliknięciu.
- Spotify „zapisz do biblioteki" przez OAuth — **ODRZUCONE**. Deep-link do utworu
  („OTWÓRZ W SPOTIFY") zostaje jak jest.

## Audio (iOS)

- [x] ~~Podkład syntezowany po powrocie z tła~~ — ZROBIONE (2026-09-06):
      `audio.renderSynth()` pre-renderuje aranż do jednego `AudioBuffer`
      (OfflineAudioContext), `start()` gra go jak mp3, `resumeFromBackground()`
      wznawia od właściwej sekundy. Fallback (brak OfflineAudioContext):
      przełożenie live-aranżu. Patrz `SAFARI-AUDIO-BUG.md`.
- [x] ~~mp3 pod rundę 2 (Książę z bajki)~~ — ZROBIONE (2026-09-07). Konrad wgrał mp3
      z edytora; ściągnięte do repo: `public/assets/songs/ksiaze-z-bajki.mp3` (2,7 MB)
      + `public/charts/ksiaze-z-bajki.json` (80 nut). Wpis w `SYNTH_TRACKS` usunięty.
      **Wszystkie 3 grywalne rundy mają teraz prawdziwe mp3.**

## Charty / edytor

- [ ] **Panna Młoda: odbudować i opublikować mapę na czysto** — na serwerze siedzi
      wersja z 1 nutą (po publikacji z pustej siatki). Gra działa, bo cofa się do
      `public/charts/panna-mloda.json` (310 nut), ale porządek by się przydał.
- [x] ~~Pogrzebówka: wyeksportować chart do repo jako zapas~~ — ZROBIONE
      (2026-09-07): `public/charts/pogrzebowka.json` (464 nuty, 46 bomb, 8 przeszkód).
- [ ] **Sprawdzić BPM Pogrzebówki** — opublikowany chart ma `bpm 66` (może miało być
      132?). Przy prawdziwym mp3 bpm prawie nie wpływa na grę (nuty są czasowe), ale
      warto potwierdzić.
