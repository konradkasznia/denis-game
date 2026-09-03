# Problem audio na iOS Safari — DIAGNOZA + obejście

**Status (2026-09-03):** zdiagnozowany; obejście wdrożone (`coojlj63e`), czeka
na potwierdzenie od Konrada.

## DIAGNOZA (zrzut z iPhone'a)

Komunikat błędu pokazał: `state=running  t=0.00  start=0.25  run=1  resume×2  rebuilt`.

Czyli: `AudioContext.state === "running"`, ale **`AudioContext.currentTime` STOI
na 0.00 i nie rusza**. To znany błąd WebKit — kontekst „działa", lecz wątek
renderu audio nie wystartował, więc zegar jest martwy. Nasila się, gdy kontekst
powstał (albo został odbudowany przez `ctx.close()` + `new AudioContext()`) POZA
gestem użytkownika. Poprzednia „naprawa" z odbudową kontekstu **pogarszała
sprawę** (tworzyła running-z-martwym-zegarem).

`getSongTime() = currentTime - startTime = 0 - 0.25 = -0.25` → `< 0.1` przez 6 s
→ watchdog → „Nie udało się uruchomić dźwięku". Dotyczy KAŻDEGO utworu (wspólny
kontekst).

## Obejście (`coojlj63e`)

- Usunięto odbudowę kontekstu z `_unlock`.
- `_unlock` odpala krótki oscylator na `gain=0` (budzi wątek renderu), potem
  czeka do ~1.2 s aż `currentTime` faktycznie ruszy.
- `getSongTime()` — gdy `currentTime` nie posunął się od startu (`clockAlive()
  === false`) → liczy z `performance.now()`. Gra rusza nawet przy zablokowanym
  audio (nuty lecą, choćby bez dźwięku).
- `start()` dla mp3 — jeśli po 0.45 s zegar wciąż stoi, restartuje źródło przez
  `src.start()` bez czasu docelowego.
- Diagnostyka w błędzie: `clock=ok|MARTWY`.

## Gdyby DALEJ nie działało

Jeśli `clock=MARTWY` i mimo obejścia brak dźwięku:
- Sprawdź, czy oscylator/`resume()` w ogóle budzi zegar na tym iOS (dodaj log
  `currentTime` co 100 ms w `_unlock`).
- Rozważ: trzymać jeden „keep-alive" oscylator gain=0 podłączony przez CAŁY
  czas życia kontekstu (część projektów tak robi na iOS).
- Sprawdź ustawienia: Safari → auto-play; iOS Low Power Mode; tryb prywatny;
  wersja iOS.

---

## (historyczne) Objaw wyjściowy

## Objaw

- GRAJ! na dowolnym utworze (potwierdzone: `panna-mloda` — prawdziwy mp3, oraz
  `byleby-nie-byla-ciepla` — podkład syntezowany).
- Utwór „wchodzi" (scena `play`), ale **odliczanie stoi na „3"**, nuty nie lecą.
- Po ~6 s watchdog (`src/game.ts`, w `update()`, `wall > 6000`) wraca do karuzeli
  z komunikatem „Nie udało się uruchomić dźwięku".
- Na Androidzie (APK / Chrome) działa normalnie. Problem tylko na Safari.

## Mechanika watchdoga

`audio.getSongTime()` = `ctx.currentTime - startTime`. Jeśli zwraca `< 0.1` przez
6 s → błąd. Czyli: **`AudioContext.currentTime` nie rusza** = kontekst utknął w
`suspended` i `resume()` go nie odblokowuje.

## Co już próbowano (bez skutku)

1. `audio.prefetch(url)` — pobiera bajty mp3 BEZ tworzenia AudioContextu; preload
   w karuzeli nie woła już `unlock()` poza gestem. (`easn7fx23`)
2. Modal „WŁĄCZ DŹWIĘK / ROZUMIEM" woła `audio.unlock()` (wczesny, czysty gest).
3. `_unlock()`: po nieudanym `resume()` zamyka kontekst i buduje świeży w tym
   samym geście (`ctx.close()` + `new AudioContext()` + `resume()`).
4. Wcześniej: mechanika lodu (poziom 5) dławiła wątek (rekurencja / `ctx.shadow` /
   alokacja dużego canvasu przy starcie) — to naprawiono, ale NIE to było
   źródłem błędu audio (pada też `panna-mloda`, która nie ma lodu).

## Diagnostyka w buildzie (`m3z279f4c`)

Komunikat błędu pokazuje teraz realny stan:
`[state=... t=... start=... run=... resume×N  rebuilt  err:...]`
→ **zrzut ekranu z tą linijką to klucz do dalszej diagnozy.**

`state` = `AudioContext.state`. Jeśli po `resume×2` i `rebuilt` dalej jest
`suspended` → Safari odmawia odblokowania na poziomie systemu/ustawień, nie kodu.

## Hipotezy do sprawdzenia

- **Ustawienia Safari na iPhone:** Ustawienia → Safari → (lub ikona „aA" w pasku
  adresu na stronie) → „Ustawienia witryny" → Auto-Play / dźwięk.
- **Tryb niskiego zużycia energii** (Low Power Mode) — bywa, że wstrzymuje audio.
- **Prywatna karta** — ograniczenia.
- Wersja iOS (16 vs 17 vs 18) — polityki `AudioContext` się zmieniały.
- Czy `ctx.resume()` promise się w ogóle rozwiązuje (patrz `err:` w diagnostyce).

## Pliki

- `src/audio.ts` — `_unlock()`, `unlock()`, `start()`, `getSongTime()`, `diag()`.
- `src/game.ts` — watchdog w `update()` (~L456), `handleHitsTap` / GRAJ (~L1443),
  `preloadHitAudio` (~L1378), modal (~L956).
