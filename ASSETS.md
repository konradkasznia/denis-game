# Grafiki do podłożenia

Wszystko wrzucasz do `public/assets/`. Nazwa `<utwor>` = `id` z pliku
`public/charts/<utwor>.json` (dla „Pan Młody" to `pan-mlody`).

## Tło ekranu gry — `public/assets/bg/<utwor>.jpg`

- Jeden obraz na utwór, pionowy (proporcje ~9:16, np. **1080 × 1920**).
- Wypełnia cały ekran (skalowane „cover"), więc ważne rzeczy trzymaj w środku.
- Jasność bez znaczenia — gra i tak przyciemnia dół pod pole gry.
- Wpisz ścieżkę w JSON utworu: `"bg": "assets/bg/pan-mlody.jpg"` (już jest dla Pan Młody).
- Brak pliku → używane jest tło domyślne.

## Postać (tańcząca / śpiewająca) — `public/assets/char/<utwor>/`

Na razie w grze jest **placeholder** (patykowy tancerz reagujący na bit).
Gdy narysujesz postać, podeślij klatki:

- `dance-1.png`, `dance-2.png`, … `dance-N.png` — pętla tańca (min. 2, optymalnie 4–8 klatek).
  Przełączają się do bitu utworu.
- `hit.png` *(opcjonalnie)* — poza przy trafieniu (np. ręce w górze).
- `miss.png` *(opcjonalnie)* — poza przy pudle (np. zgarbiona).

Wymagania klatek:
- **PNG z przezroczystym tłem**.
- Ta sama wysokość i ten sam „grunt" (stopy na tej samej linii) na każdej klatce,
  żeby nie skakała.
- Wysokość ~**900–1200 px**, postać wyśrodkowana w poziomie.
- Styl dowolny — dopasuję skalę i pozycję w grze.

Jak wolisz jedną animację (sprite sheet / GIF / Lottie JSON) zamiast osobnych
klatek — też dam radę, tylko napisz w jakim formacie.
