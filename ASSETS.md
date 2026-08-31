# Grafiki do podłożenia

Wszystko wrzucasz do `public/assets/`. Nazwa `<utwor>` = `id` z pliku
`public/charts/<utwor>.json` (dla „Pan Młody" to `pan-mlody`).

## Tło ekranu gry — `public/assets/bg/<utwor>.jpg`

- Jeden obraz na utwór, pionowy (proporcje ~9:16, np. **1080 × 1920**).
- Wypełnia cały ekran (skalowane „cover"), więc ważne rzeczy trzymaj w środku.
- Jasność bez znaczenia — gra i tak przyciemnia dół pod pole gry.
- Ścieżka jest już wpisana w JSON: `"bg": "assets/bg/pan-mlody.jpg"`.
- Brak pliku → tło domyślne.

## Postać (na pierwszym planie, przed nutami)

Postać stoi z przodu i rusza się **do bitu** (podskok, kołysanie, spłaszczenie
przy „lądowaniu"), reaguje na trafienie (podskok + rozciągnięcie), pudło
(przechył) i wejście na wyższy mnożnik (wyskok).

### Najprościej: JEDEN plik PNG

`public/assets/char/pan-mlody/character.png`

- **PNG z przezroczystym tłem**, cała postać w jednej pozie (na wprost, stojąca).
- Wysokość ~**1000–1600 px**, postać wyśrodkowana w poziomie, **stopy przy dolnej
  krawędzi** obrazka (grunt = dół pliku).
- Ścieżka jest już w JSON. Dostrojenie rozmiaru/pozycji:
  `"characterScale": 1` (mnożnik) i `"characterY": 706` (linia gruntu w px).

Tę jedną grafikę animuję proceduralnie (transformacje canvasu) — bez dodatkowych
klatek. Wystarczy do dobrego „groove".

### Lepszy ruch (opcjonalnie): osobne części ciała

Jeśli chcesz płynniejszą animację kończyn, podeślij zamiast tego:
`head.png`, `torso.png`, `arm-left.png`, `arm-right.png`, `leg-left.png`,
`leg-right.png` (wszystkie w tej samej „scenie", przezroczyste tło). Zrobię
z tego lalkę (skeletal) z prawdziwym machaniem rękami/nogami.

### Albo klatki / sprite sheet

`dance-1.png … dance-N.png` (4–8 klatek, ta sama wysokość i grunt) albo jeden
sprite sheet + info o siatce. Też obsłużę.

---

Napisz w mailu/wiadomości którą wersję wysyłasz, to od razu wiem jak wpiąć.
