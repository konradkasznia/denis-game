# Grafiki do podłożenia

Wszystko wrzucasz do `public/assets/`. Nazwa `<utwor>` = `id` z pliku
`public/charts/<utwor>.json` (dla „Pan Młody" to `pan-mlody`).

## Tło ekranu gry — `public/assets/bg/<utwor>.jpg`

- Jeden obraz na utwór, pionowy (~9:16, np. **1080 × 1920**), skalowany „cover".
- Ścieżka jest w JSON: `"bg": "assets/bg/pan-mlody.jpg"`. Brak pliku → tło domyślne.

---

## Postać / animacje

Postać stoi na pierwszym planie (przed nutami) i **rusza się tak samo cały czas**
— podskok i kołysanie do tempa, niezależnie od tego czy trafiasz. Bez reakcji
na trafienie/pudło.

### W jakim formacie przygotować animację?

**Najlepiej: sprite sheet PNG** (jeden obraz = siatka klatek) **albo sekwencja
PNG** (`f-01.png`, `f-02.png`, …). Eksportuje to praktycznie każdy program:
After Effects, Rive, Spine, Procreate Dreams, Blender, Toon Boom, Photoshop
(„Wygeneruj → Zasoby obrazów" / „Eksportuj klatki wideo").

Wymagania klatek:
- **przezroczyste tło (PNG)**,
- ta sama wysokość i ta sama linia stóp na każdej klatce (żeby nie skakała),
- postać wyśrodkowana w poziomie,
- pętla płynna (ostatnia klatka wraca do pierwszej),
- ~**1–3 s pętli**, **12–24 fps** (czyli 18–60 klatek),
- wysokość klatki ~**900–1400 px**.

### Gdzie to wrzucić

Folder `public/assets/char/<nazwa>/` z plikiem `anim.json`:

**sprite sheet:**
```
public/assets/char/denis-1/sheet.png
public/assets/char/denis-1/anim.json
```
```json
{ "type": "sheet", "src": "sheet.png", "frames": 24, "cols": 6, "fps": 18 }
```
(`cols` = ile klatek w rzędzie; reszta liczy się sama)

**sekwencja PNG:**
```
public/assets/char/denis-1/f-01.png … f-24.png
public/assets/char/denis-1/anim.json
```
```json
{ "type": "frames", "src": "f-{}.png", "frames": 24, "fps": 18, "pad": 2 }
```
(`{}` = miejsce na numer, `pad: 2` → `01`, `02`, …)

### Kilka animacji w jednym utworze (np. inna postać od 30 s)

W pliku `public/charts/<utwor>.json`:
```json
"characters": [
  { "at": 0,  "sprite": "assets/char/denis-1" },
  { "at": 30, "sprite": "assets/char/denis-2" },
  { "at": 95, "sprite": "assets/char/denis-1" }
],
"characterScale": 1,
"characterY": 706
```
Przełączają się z krótkim przenikaniem. `characterScale` / `characterY` regulują
rozmiar i miejsce, gdzie postać stoi.

### Najprościej (jedna klatka)

Jeśli masz tylko jedną pozę: `"character": "assets/char/denis-1/character.png"`
(bez folderu z `anim.json`) — animuję ją proceduralnie (bob + spłaszczenie).

### Wolisz Lottie / After Effects?

Da się wpiąć animację **Lottie (JSON z Bodymovin)** — lepsza jakość wektorowa,
łatwe segmenty. Dodam wtedy bibliotekę `lottie-web`. Napisz jeśli tak wolisz.
