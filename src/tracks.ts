// Ładowanie utworów do rozgrywki.
//
// - "rozgrzewka" → syntezowany podkład testowy (bez pliku audio)
// - pozostałe id → beatmapa z `public/charts/<id>.json` + plik audio
//
// Beatmapy trzymamy jako zwykłe assety (fetch), nie importy — dzięki temu
// edytor będzie mógł je nadpisywać, a testy czytać przez `fs`.

import { buildSynthSong, LANES, mkNote, type Note, type SongDef, type SongEvent } from "./chart.ts";

export const DEFAULT_TRACK = "panna-mloda";

// Utwory bez własnego pliku audio — grane na syntezowanym podkładzie.
// Gdy wpłynie mp3 danego utworu: dodajemy `public/charts/<id>.json`
// z `audioUrl` i prawdziwą beatmapą, a wpis stąd znika.
type SynthCfg = {
  title: string;
  artist: string;
  bpm: number;
  bars: number;
  bg?: string;
  characters?: { at: number; sprite: string }[];
  characterScale?: number;
  characterY?: number;
  events?: SongEvent[];
};

/** naprzemienne ujęcia postaci co `every` s przez `secs` s utworu */
function rotateShots(base: string, ujecia: number[], secs: number, every = 4): { at: number; sprite: string }[] {
  const out: { at: number; sprite: string }[] = [];
  for (let t = 0, i = 0; t < secs; t += every, i++) {
    out.push({ at: t, sprite: `${base}/ujecie${ujecia[i % ujecia.length]}` });
  }
  return out;
}

const SYNTH_TRACKS: Record<string, SynthCfg> = {
  rozgrzewka: { title: "Rozgrzewka", artist: "podkład testowy", bpm: 100, bars: 22 },
  "panna-mloda": {
    title: "Panna Młoda",
    artist: "Denis",
    bpm: 155, // podane przez Konrada (do potwierdzenia z mp3)
    bars: 31,
    // tymczasowo: ujęcia 1→2→3→4 zmieniają się co 4 s (docelowe sekundy do ustalenia)
    characters: rotateShots("assets/char/panna-mloda", [1, 2, 3, 4], 52),
    characterScale: 0.95,
    characterY: 704,
  },
  "ksiaze-z-bajki": {
    title: "Książę z bajki",
    artist: "Denis",
    bpm: 112,
    bars: 28,
    // ujęcia 1–3 gotowe (4 dojdzie); rotacja co 4 s (docelowe sekundy do mp3)
    characters: rotateShots("assets/char/ksiaze-z-bajki", [1, 2, 3], 52),
    characterScale: 0.95,
    characterY: 704,
  },
  pogrzebowka: {
    title: "Pogrzebówka",
    artist: "Denis",
    bpm: 150, // tymczasowe, do mp3
    bars: 30,
    // ujęcia 1 (idle), 2 (akordeon), 3 (ręce w górę), 4 (pali w fotelu)
    characters: rotateShots("assets/char/pogrzebowka", [1, 2, 3, 4], 52),
    characterScale: 0.95,
    characterY: 704,
  },
  "byleby-nie-byla-ciepla": {
    title: "Byleby nie była ciepła",
    artist: "Denis",
    bpm: 140, // tymczasowe, do mp3
    bars: 30,
    characterScale: 0.95,
    characterY: 704,
    // poziom 5 — mechanika lodu: ekran zamarza, trzeba rozbić 10 tapnięć
    events: [
      { type: "ice", at: 20, taps: 20 },
      { type: "ice", at: 46, taps: 24 },
    ],
  },
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
  events?: SongEvent[];
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
    events: raw.events,
    duration: raw.duration,
  };
}

/** Baza API (dla apki natywnej ustawiane przez VITE_API_BASE; na webie puste = ten sam host). */
function apiBase(): string {
  try {
    const b = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE;
    if (b) return b.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  return "";
}

/** Beatmapa opublikowana z edytora (jeśli jest) — ma pierwszeństwo przed plikiem w repo. */
async function fetchPublishedChart(id: string): Promise<RawChart | null> {
  try {
    if (typeof fetch !== "function") return null;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/chart?songId=${encodeURIComponent(id)}`, { signal: ctrl?.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; chart?: RawChart };
    if (j?.ok && j.chart && Array.isArray(j.chart.notes) && j.chart.notes.length) return j.chart;
  } catch {
    /* brak backendu / offline / timeout → lecimy dalej na plik */
  }
  return null;
}

export async function loadTrack(id: string): Promise<SongDef> {
  // 1. beatmapa opublikowana z edytora (Turso)
  const published = await fetchPublishedChart(id);
  if (published) return rawToSong(published);

  // 2. prawdziwy utwór z pliku beatmapy w repo
  try {
    const res = await fetch(`charts/${id}.json`);
    if (res.ok) {
      const raw = (await res.json()) as RawChart;
      if (raw && Array.isArray(raw.notes) && raw.notes.length) return rawToSong(raw);
    }
  } catch {
    /* brak pliku albo to nie JSON — lecimy na podkład */
  }
  // 3. syntezowany podkład
  const cfg = SYNTH_TRACKS[id] ?? SYNTH_TRACKS.rozgrzewka;
  return buildSynthSong({ id: id === "placeholder-01" ? "rozgrzewka" : id, ...cfg });
}
