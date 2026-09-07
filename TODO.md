# TODO — DENIS Impulsywni Live

Lista rzeczy odłożonych na później. Dopisujemy tu zamiast rozpraszać po commitach.

## Przed premierą

- [ ] **APK / iOS: audio po głębokim tle** — po zminimalizowaniu + wygaszeniu ekranu
      + powrocie iOS potrafi ubić wątek renderu WebAudio (`state="running"`, ale
      `AudioContext.currentTime` STOI). Zrobione po stronie JS (2026-09-07):
      `audio.hardReset()` buduje świeży `AudioContext` w geście GRAJ/OD NOWA;
      `_unlock()` wykrywa martwy zegar i sam go odbudowuje; po nieudanym „wznów"
      z menu pauzy runda kończy się komunikatem „Zagraj rundę jeszcze raz".
      **Zostaje część natywna:** w projekcie iOS (jeszcze nie wygenerowany —
      brak katalogu `ios/`) ustawić `AVAudioSession` na kategorię `playback`
      (własny mostek Capacitora albo `capacitor-plugin-native-audio`) i
      przetestować scenariusz na urządzeniu. Patrz `SAFARI-AUDIO-BUG.md`.

## Anty-farm monet

- [x] ~~Bramka czasowa per utwór~~ — ZROBIONE (2026-09-07). `/api/scores` POST
      przyznaje monety za dany utwór najwyżej raz na `0,85 × długość utworu`
      (`scores.coin_at`, długość z chartu / `SONG_SECONDS`). Uczciwy gracz nigdy
      w to nie wpadnie (całą długość utworu i tak gra), a skrypt POST-ujący co
      kilka sekund dostaje 0 monet. Wynik do rankingu zapisuje się zawsze.
      Smoke test pokrywa 3 przypadki.
- [ ] **Walidacja przebiegu po stronie serwera** — nadal ufamy wynikowi klienta
      (po capie anty-cheat `notes × 3800 + 150000`). Zmodyfikowany klient może
      raz na długość utworu wysłać wynik bliski capa. Docelowo: podpisany „nonce"
      wydawany na starcie rundy + weryfikacja liczby/rozłożenia trafień, albo
      przynajmniej zacieśnienie capa do realistycznego maksimum „par score".

## Powiadomienia push

- [x] ~~Podstawowy obieg OneSignal~~ — DZIAŁA (potwierdził Konrad 2026-09-07):
      zgoda systemowa, dostarczenie, deep-link.
- [ ] **Segmenty** — w przyszłości budować segmenty odbiorców (np. „nie grał
      od 7 dni", „odblokował Pogrzebówkę") i wysyłać pod nie kampanie.

## Charty / edytor

- [x] ~~BPM Pogrzebówki / Księcia~~ — poprawione (Konrad, 2026-09-07):
      Pogrzebówka 130, Panna Młoda i Książę z bajki 155. Zapasowe charty w repo
      zsynchronizowane.
- [ ] **Panna Młoda: odbudować i opublikować mapę na czysto** — na serwerze
      siedzi wersja z 1 nutą (po publikacji z pustej siatki). Gra działa, bo
      cofa się do `public/charts/panna-mloda.json` (310 nut), ale porządek by
      się przydał.
