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

export const SONGS: SongMeta[] = [
  {
    id: "placeholder-01",
    title: "Podkład testowy",
    artist: "Denis Impulsywni",
    accent: "#ff9f43",
    // TODO: podmienić na link do prawdziwego utworu
    spotifyUrl: "https://open.spotify.com/search/Denis%20Impulsywni",
    playable: true,
  },
  { id: "mystery-1", title: "???", artist: "Denis Impulsywni", accent: "#ff5e7e", playable: false },
  { id: "mystery-2", title: "???", artist: "Denis Impulsywni", accent: "#8ab6ff", playable: false },
];

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
