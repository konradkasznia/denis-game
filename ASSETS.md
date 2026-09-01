# Grafiki do podłożenia

Wszystko wrzucasz do `public/assets/`. Nazwa `<utwor>` = `id` z pliku
`public/charts/<utwor>.json` (dla „Panna Młoda" to `panna-mloda`).

## Ekrany menu / WYBIERZ HIT — `public/assets/ui/`

Grafiki z makiety Figma (`Bez pośredników`, node 131-7466). Format PNG, przezroczyste tło:

| plik | co to | rozmiar wg makiety |
|---|---|---|
| `wybierz-hit.png` | logo „WYBIERZ HIT" | ~840×280 |
| `stage-bg.png` | tło sceny 4K (wspólne dla poziomów) | ~1428×2129 |
| `gear.png` | ikona zębatki (→ profil) | ~106×116 |
| `star-full.png` / `star-half.png` / `star-empty.png` | gwiazdki oceny | ~54×55 |
| `select-<utwor>.png` | postać na ekranie wyboru (statyczna poza) | ~750×1000 |
| `reward-denis.png` | Denis z prezentem na ekran NAGRODY | ~572×858 |

Brak pliku → zapas rysowany w kodzie (logo/gwiazdki/tło) albo pierwsza klatka
`assets/char/<utwor>/ujecie1/dance.png` (postać). Poziom zablokowany → postać
automatycznie czarno-biała (w kodzie, bez osobnego pliku).

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

### Niektóre klatki dłużej (np. zatrzymanie na pozie / „zdjęciu")

Dwa sposoby, oba opcjonalne — działają i dla `sheet`, i dla `frames`:

- **`holds`** — krotność bazowego taktu (`1000/fps`) na każdą klatkę. Najprostsze.
  ```json
  { "type": "sheet", "src": "dance.png", "frames": 6, "cols": 6, "fps": 12,
    "holds": [4, 1, 1, 3, 1, 1] }
  ```
  → klatka 1 trzyma 4× dłużej, klatka 4 — 3× dłużej, reszta normalnie.

- **`frameMs`** — dokładny czas każdej klatki w milisekundach (ma pierwszeństwo
  przed `fps`/`holds`).
  ```json
  { "type": "frames", "src": "f-{}.png", "frames": 6, "fps": 12, "pad": 2,
    "frameMs": [800, 90, 90, 500, 90, 90] }
  ```

### Powtarzanie klatek bez duplikowania grafiki — `sequence`

Gdy pętla wraca do tej samej klatki (np. `1-2-3-4-3-2`), arkusz PNG trzyma
**tylko unikalne klatki**, a kolejność odtwarzania jest w `sequence`:
```json
{ "type": "sheet", "src": "dance.png", "frames": 4, "cols": 4, "fps": 8,
  "sequence": [0, 1, 2, 3, 2, 1],
  "frameMs":  [100, 100, 200, 400, 200, 100] }
```
`sequence` = indeks obrazu z arkusza (0..frames-1) na każdy krok. Długość
`frameMs` / `holds` = długość `sequence` (a jak nie ma `sequence` — = `frames`).
Dzięki temu 12-krokowa animacja z 5 zdjęć waży tyle co 5 zdjęć, nie 12.

Podgląd z uwzględnieniem czasów i sekwencji:
`node tools/preview.mjs <utwor>` → `dance-preview.gif`.

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
