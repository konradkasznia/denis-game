# Problem audio na iOS Safari — DIAGNOZA + naprawa

**Status (2026-09-03):** naprawione (`81vwxvgr4` + hartowanie `qo94jwlak`).
Konrad potwierdził: gra działa, muzyka gra. Zostawiam notatkę na wypadek regresji.

## DIAGNOZA (zrzut z iPhone'a)

Komunikat błędu pokazał: `state=running  t=0.00  start=0.25  run=1  resume×2`.

`AudioContext.state === "running"`, ale **`AudioContext.currentTime` STOI na 0.00
i nie rusza** — znany błąd WebKit: kontekst „działa", lecz wątek renderu audio
nie wystartował, więc zegar jest martwy. Nasila się, gdy kontekst powstał lub
został odbudowany (`ctx.close()` + `new AudioContext()`) POZA gestem. Wcześniejsza
„naprawa" z odbudową kontekstu **pogarszała sprawę**.

`getSongTime() = currentTime - startTime = -0.25` → `< 0.1` przez 6 s → watchdog
(`src/game.ts` w `update()`) → „Nie udało się uruchomić dźwięku". Wspólny kontekst
→ padał KAŻDY utwór (potwierdzone: `panna-mloda` mp3 + `byleby` synth).

## Naprawa (kolejno)

| commit | zmiana | efekt |
|---|---|---|
| `easn7fx23` | `audio.prefetch(url)` — pobiera bajty mp3 BEZ tworzenia AudioContextu; modal „WŁĄCZ DŹWIĘK" woła `unlock()` | kontekst powstaje tylko w geście |
| `coojlj63e` | usunięto odbudowę ctx; `getSongTime()` fallback na `performance.now()` gdy zegar martwy | gra rusza, ale wciąż bez dźwięku |
| **`81vwxvgr4`** | **stały cichy zapętlony bufor `keepAlive` (gain=0) podłączony do destination przez całe życie kontekstu** (`startKeepAlive()` w `buildCtx()`) — trik iOS z Tone.js / Howler | **zegar chodzi, mp3 gra** |
| `qo94jwlak` | hartowanie po analizie Opus 5 (niżej) | odporność |

### Hartowanie (`qo94jwlak`)

1. **`clockAlive()` był zatrzaskiem jednorazowym** (`currentTime - ctxAtStart > 0.05`).
   Gdy zegar ruszył o 60 ms i zamarł → na zawsze `true` → fallback się nie
   włączał. Teraz: **ciągły** dryf względem zegara ściennego (0.5 s karencji),
   z akumulacją czasu pauz (`pausedTotalMs` / `pauseStartMs` w `pause()` /
   `resumePlayback()`), żeby `ctx.suspend()` przy pauzie nie fałszował predykatu.
2. **Stan WebKit `"interrupted"`** (Siri / telefon / przełącznik ciszy) — kod
   porównywał `=== "suspended"` w `resumePlayback()` / `paused` / `start()`.
   Teraz `!== "running"` (z pominięciem `"closed"`, bo `resume()` by rzucił).
3. **`decodeAudioData` odłącza (detach) ArrayBuffer** — `this.decode(arr.slice(0))`,
   żeby po nieudanym dekodowaniu oryginał w `trackRaw` nadał się do retry.

## Powrót z tła (2026-09-06)

Osobny objaw: minimalizacja Safari podczas gry → powrót → GRAJ w menu pauzy →
**muzyka nie wraca**. iOS podczas dłuższej przerwy ubija źródło mp3 i keep-alive;
samo `ctx.resume()` (stare `resumePlayback()`) nie odtwarza dźwięku, a
`clockAlive()` nie odróżnia tego od zwykłej krótkiej pauzy (oba zamrażają
`ctx.currentTime` i oba są wyłączone z `wallElapsed()` przez `pausedTotalMs`).

**Naprawa:** `audio.resumeMp3()` — po `resumePlayback()` bezwarunkowo odbudowuje
keep-alive i odtwarza świeże źródło mp3 od `wallElapsed() - leadIn` (pozycję
przechował zegar ścienny). Wołane z `game.ts` `update()` przy końcu odliczania
3-2-1 z pauzy. `mp3Buf` trzyma bufor bieżącego utworu; podkład syntezowany =
`null` (patrz TODO.md — synth po tle wciąż może zamilknąć).

## Jeśli regresja

- Diagnostyka w błędzie: `[state=... t=... clock=ok|MARTWY  run=... resume×N ...]`.
- `clock=MARTWY` mimo keep-alive → sprawdź czy `keepAlive` w ogóle wystartował
  (log w `startKeepAlive`); rozważ oscylator zamiast buffer-source.
- Sprawdź: przełącznik ciszy na obudowie iPhone'a (WebAudio idzie kategorią
  ambient — cisza go wycina!), Low Power Mode, tryb prywatny, wersja iOS.
- WebKit ma twardy limit ~4 żywych `AudioContext` na kartę — jeśli działa w
  świeżej karcie a nie po kilku próbach, to jest to (stąd: nigdy `close()+new`).

## Opcja docelowa (odłożona)

Rada Opus 5: muzykę utworu (mp3) przenieść na `HTMLAudioElement` (`playsinline`,
`.play()` w geście), zegar = `audioEl.currentTime` interpolowany `performance.now()`.
`<audio>` na iOS/WKWebView jest dużo przewidywalniejsze niż WebAudio. `AudioContext`
zostałby tylko do SFX. Duża zmiana — synth-tracki (`byleby`/`ksiaze`/`pogrzebowka`)
i tak wymagają WebAudio, więc `<audio>` pomaga tylko przy jednym utworze mp3.
Robić dopiero jeśli keep-alive okaże się niestabilny między wersjami iOS.

## Pliki

- `src/audio.ts` — `_unlock()`, `startKeepAlive()`, `buildCtx()`, `getSongTime()`,
  `clockAlive()`, `wallElapsed()`, `pause()`/`resumePlayback()`, `start()`, `diag()`.
- `src/game.ts` — watchdog w `update()` (~L456), GRAJ w `handleHitsTap` (~L1443),
  `preloadHitAudio` (~L1378, woła `prefetch`), modal (~L956, woła `unlock`).
