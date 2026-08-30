# DENIS — gra rytmiczna (prototyp)

Gra rytmiczna typu tap-to-beat (jak *LIT killah: The Game* / Beatstar) z postacią
Denisa i jego piosenkami. Ten etap to **vertical slice** — mechanika, nie grafika.

## Stan

- [x] Silnik czasu oparty o `AudioContext` (nuty nie rozjeżdżają się z muzyką)
- [x] Syntezowany podkład tymczasowy (perkusja + bas + arp), 100 BPM
- [x] 4 tory, spadające nuty, okna oceny: PERFECT / SUPER / OK / PUDŁO
- [x] Punktacja z mnożnikiem combo, licznik celności
- [x] Ekran wyniku (ocena S–D, pełne combo, rekord w `localStorage`)
- [x] Kalibracja opóźnienia dźwięku (menu, ± 5 ms)
- [x] Sterowanie: dotyk (tor = kolumna) oraz klawisze `D F J K`
- [ ] Prawdziwe pliki audio Denisa + BPM
- [ ] Edytor beatmap (chart editor)
- [ ] Intro fabularne
- [ ] Pakowanie do apki (Capacitor → Android + iOS)

## Uruchomienie

```bash
npm install
npm run dev
```

Vite wypisze adres `Network:` — otwórz go na iPhonie w tej samej sieci Wi-Fi,
żeby testować dotykiem.

## Podmiana podkładu na prawdziwy utwór

Docelowo `src/audio.ts` ładuje plik przez `decodeAudioData` zamiast syntezy,
a `src/chart.ts` czyta beatmapę z JSON. Reszta (`getSongTime`, ocena, HUD) bez zmian.
