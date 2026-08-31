// Ładowanie utworów do rozgrywki.
//
// - "rozgrzewka" → syntezowany podkład testowy (bez pliku audio)
// - pozostałe id → beatmapa z `public/charts/<id>.json` + plik audio
//
// Beatmapy trzymamy jako zwykłe assety (fetch), nie importy — dzięki temu
// edytor będzie mógł je nadpisywać, a testy czytać przez `fs`.

import { buildSynthSong, LANES, mkNote, type Note, type SongDef } from "./chart.ts";

export const DEFAULT_TRACK = "pan-mlody";
export const SYNTH_TRACK = "rozgrzewka";

interface RawChart {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  gridOffset?: number;
  duration: number;
  audioUrl: string;
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
    notes,
    duration: raw.duration,
  };
}

export async function loadTrack(id: string): Promise<SongDef> {
  if (id === SYNTH_TRACK || id === "placeholder-01") return buildSynthSong();
  const res = await fetch(`charts/${id}.json`);
  if (!res.ok) throw new Error(`nie znaleziono beatmapy: charts/${id}.json`);
  return rawToSong((await res.json()) as RawChart);
}
