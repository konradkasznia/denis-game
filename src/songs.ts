// Rejestr utworów + śledzenie, które gracz już „poznał".
//
// Docelowo każdy wpis dostaje własny plik audio, beatmapę (chart) i okładkę
// w `public/assets/covers/<id>.jpg`. Na razie grywalny jest tylko podkład
// testowy; reszta to zablokowane „tajemnice", żeby pokazać ekran kolekcji.

export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  /** kolor akcentu / proceduralnej okładki, gdy brak pliku */
  accent: string;
  /** ścieżka do okładki (opcjonalnie), np. "assets/covers/xxx.jpg" */
  cover?: string;
  /** link do utworu w Spotify */
  spotifyUrl?: string;
  /** czy mamy komplet do zagrania (audio + chart) */
  playable: boolean;
}

// Kolejność = kolejność rund. „Kolejna runda" prowadzi do następnego playable.
// „Pan Młody" chwilowo wyłączony — skupiamy się na dopracowaniu „Panna Młoda".
// Chart + mp3 zostają w repo (public/charts/pan-mlody.json, assets/songs/), żeby
// łatwo przywrócić: wystarczy dodać wpis z powrotem.
export const SONGS: SongMeta[] = [
  {
    id: "panna-mloda",
    title: "Panna Młoda",
    artist: "Denis",
    accent: "#ff5e7e",
    spotifyUrl: "https://open.spotify.com/track/5xRECw5U5q3feZ63AMPOYZ",
    playable: true,
  },
  {
    id: "ksiaze-z-bajki",
    title: "Książę z bajki",
    artist: "Denis",
    accent: "#8ab6ff",
    spotifyUrl: "https://open.spotify.com/track/2rqt00ehpIhLjxuy2OTPa7",
    playable: true,
  },
  {
    id: "pogrzebowka",
    title: "Pogrzebówka",
    artist: "Denis",
    accent: "#ffd24c",
    spotifyUrl: "https://open.spotify.com/track/69CAp6C1Uj31gDryQJHdyl",
    playable: true,
  },
  {
    id: "pani-policjantko",
    title: "Pani policjantko",
    artist: "Denis",
    accent: "#8ab6ff",
    spotifyUrl: "https://open.spotify.com/track/1aIjxCDYeK0oECqNYMk9Cx",
    playable: false, // wkrótce
  },
];

/** Następna runda po utworze `id` (albo null, gdy to ostatnia). */
export function nextRound(id: string): string | null {
  const i = SONGS.findIndex((s) => s.id === id);
  for (let j = i + 1; j < SONGS.length; j++) if (SONGS[j].playable) return SONGS[j].id;
  return null;
}

export function spotifyUrl(id: string): string | undefined {
  return SONGS.find((s) => s.id === id)?.spotifyUrl;
}

const KEY = "denis.discovered";

export function discoveredIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function markDiscovered(id: string) {
  const s = discoveredIds();
  if (s.has(id)) return;
  s.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export function isDiscovered(id: string): boolean {
  return discoveredIds().has(id);
}

// ---- progresja poziomów (gwiazdki) --------------------------------------
//
// Poziom N+1 odblokowuje się po zaliczeniu poziomu N na >= UNLOCK_STARS gwiazdek.
// Najlepszy wynik gwiazdkowy per utwór trzymamy w localStorage jako mapę id -> 0..5.

const STARS_KEY = "denis.stars";
export const UNLOCK_STARS = 4;

function starsMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STARS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function bestStars(id: string): number {
  return starsMap()[id] ?? 0;
}

export function recordStars(id: string, stars: number) {
  const m = starsMap();
  const s = Math.max(0, Math.min(5, Math.round(stars)));
  if (s <= (m[id] ?? 0)) return;
  m[id] = s;
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** Scala postęp gwiazdkowy z serwera (z /api/auth/me) do lokalnej mapy —
 *  bierze wyższą wartość per utwór. Wołane po starcie i po zalogowaniu, żeby
 *  odblokowane poziomy wróciły po wyczyszczeniu localStorage / na nowym telefonie. */
export function mergeServerStars(server: Record<string, { stars?: number }>): void {
  const m = starsMap();
  let changed = false;
  for (const [id, v] of Object.entries(server || {})) {
    const s = Math.max(0, Math.min(5, Math.round(v?.stars ?? 0)));
    if (s > (m[id] ?? 0)) {
      m[id] = s;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** Czy poziom o danym indeksie w SONGS można zagrać. */
export function levelUnlocked(index: number): boolean {
  if (index <= 0) return true;
  const prev = SONGS[index - 1];
  return !!prev && bestStars(prev.id) >= UNLOCK_STARS;
}

/** Ile kolejnych poziomów od początku zaliczono na >= UNLOCK_STARS gwiazdek. */
export function clearedStreak(): number {
  let n = 0;
  for (const s of SONGS) {
    if (bestStars(s.id) >= UNLOCK_STARS) n++;
    else break;
  }
  return n;
}
