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
    id: "pan-mlody",
    title: "Pan Młody",
    artist: "Denis",
    accent: "#ffd24c",
    // TODO: podmienić na bezpośredni link do utworu
    spotifyUrl: "https://open.spotify.com/search/Denis%20Pan%20M%C5%82ody",
    playable: true,
  },
  {
    id: "rozgrzewka",
    title: "Rozgrzewka",
    artist: "podkład testowy",
    accent: "#ff9f43",
    playable: true,
  },
  { id: "panna-mloda", title: "???", artist: "Denis", accent: "#ff5e7e", playable: false },
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
