# TODO — DENIS Impulsywni Live

Lista rzeczy odłożonych na później. Dopisujemy tu zamiast rozpraszać po commitach.

## Przed premierą

- [ ] **Przetestować powiadomienia (OneSignal / push)** — pełny obieg: zgoda systemowa,
      dostarczenie, deep-link do właściwego ekranu, iOS + Android. Krytyczne przed premierą.

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
