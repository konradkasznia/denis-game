// Ładowanie utworów do rozgrywki.
//
// - "rozgrzewka" → syntezowany podkład testowy (bez pliku audio)
// - pozostałe id → beatmapa z `public/charts/<id>.json` + plik audio
//
// Beatmapy trzymamy jako zwykłe assety (fetch), nie importy — dzięki temu
// edytor będzie mógł je nadpisywać, a testy czytać przez `fs`.

import { buildSynthSong, LANES, mkNote, type Note, type SongDef } from "./chart.ts";

export const DEFAULT_TRACK = "pan-mlody";

// Utwory bez własnego pliku audio — grane na syntezowanym podkładzie.
// Gdy wpłynie mp3 danego utworu: dodajemy `public/charts/<id>.json`
// z `audioUrl` i prawdziwą beatmapą, a wpis stąd znika.
const SYNTH_TRACKS: Record<string, { title: string; artist: string; bpm: number; bars: number }> = {
  rozgrzewka: { title: "Rozgrzewka", artist: "podkład testowy", bpm: 100, bars: 22 },
  "panna-mloda": { title: "Panna Młoda", artist: "Denis", bpm: 128, bars: 26 },
  "ksiaze-z-bajki": { title: "Książę z bajki", artist: "Denis", bpm: 112, bars: 28 },
  "to-ty": { title: "To Ty!", artist: "Denis", bpm: 144, bars: 30 },
};

interface RawChart {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  gridOffset?: number;
  duration: number;
  audioUrl: string;
  bg?: string;
  character?: string;
  characters?: { at: number; sprite: string }[];
  characterScale?: number;
  characterY?: number;
  notes: { lane: number; time: number; dur?: number }[];
}

const clampLane = (l: number) => Math.max(0, Math.min(LANES - 1, Math.round(l)));

export function rawToSong(raw: RawChart): SongDef {
  const notes: Note[] = raw.notes
    .map((n) => mkNote(clampLane(n.lane), n.time, n.dur || 0))
    .sort((a, b) => a.time - b.time || a.lane - b.lane);
  return {
    id: raw.id,
    title: raw.title,
    artist: raw.artist,
    bpm: raw.bpm,
    bars: Math.max(1, Math.ceil((raw.duration * raw.bpm) / 60 / 4)),
    startBar: 0,
    lanes: LANES,
    audioUrl: raw.audioUrl,
    bg: raw.bg,
    character: raw.character,
    characters: raw.characters,
    characterScale: raw.characterScale,
    characterY: raw.characterY,
    notes,
    duration: raw.duration,
  };
}

export async function loadTrack(id: string): Promise<SongDef> {
  // 1. prawdziwy utwór z pliku beatmapy
  try {
    const res = await fetch(`charts/${id}.json`);
    if (res.ok) {
      const raw = (await res.json()) as RawChart;
      if (raw && Array.isArray(raw.notes) && raw.notes.length) return rawToSong(raw);
    }
  } catch {
    /* brak pliku albo to nie JSON — lecimy na podkład */
  }
  // 2. syntezowany podkład
  const cfg = SYNTH_TRACKS[id] ?? SYNTH_TRACKS.rozgrzewka;
  return buildSynthSong({ id: id === "placeholder-01" ? "rozgrzewka" : id, ...cfg });
}
