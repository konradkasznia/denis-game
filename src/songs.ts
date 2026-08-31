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
export const SONGS: SongMeta[] = [
  {
    id: "panna-mloda",
    title: "Panna Młoda",
    artist: "Denis",
    accent: "#ff5e7e",
    spotifyUrl: "https://open.spotify.com/search/Denis%20Panna%20M%C5%82oda",
    playable: true,
  },
  {
    id: "ksiaze-z-bajki",
    title: "Książę z bajki",
    artist: "Denis",
    accent: "#8ab6ff",
    spotifyUrl: "https://open.spotify.com/search/Denis%20Ksi%C4%85%C5%BC%C4%99%20z%20bajki",
    playable: true,
  },
  {
    id: "to-ty",
    title: "To Ty!",
    artist: "Denis",
    accent: "#ffd24c",
    spotifyUrl: "https://open.spotify.com/search/Denis%20To%20Ty",
    playable: true,
  },
  {
    id: "pan-mlody",
    title: "Pan Młody",
    artist: "Denis",
    accent: "#ff9f43",
    spotifyUrl: "https://open.spotify.com/search/Denis%20Pan%20M%C5%82ody",
    playable: true,
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
