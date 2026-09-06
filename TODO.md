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

- [ ] **Podkład syntezowany po powrocie z tła** — `resumeMp3()` odbudowuje tylko
      źródło mp3. Dla utworów bez mp3 (`ksiaze-z-bajki`) po dłuższym zejściu w tło
      synth może zamilknąć (iOS ubija zakolejkowane oscylatory). Do zrobienia:
      seek-aware restart podkładu syntezowanego od bieżącej sekundy. Patrz
      `SAFARI-AUDIO-BUG.md`.
