// Ładowanie utworów do rozgrywki.
//
// - "rozgrzewka" → syntezowany podkład testowy (bez pliku audio)
// - pozostałe id → beatmapa z `public/charts/<id>.json` + plik audio
//
// Beatmapy trzymamy jako zwykłe assety (fetch), nie importy — dzięki temu
// edytor będzie mógł je nadpisywać, a testy czytać przez `fs`.

import { buildSynthSong, LANES, mkNote, type Note, type SongDef, type SongEvent } from "./chart.ts";
import { isNative } from "./native.ts";

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
  bombs?: { lane: number; time: number }[];
  fires?: { lane: number; time: number }[];
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
  // „ksiaze-z-bajki" ma już prawdziwe mp3 + chart (public/{assets/songs,charts}/) —
  // wpis syntezowany usunięty zgodnie z konwencją.
  pogrzebowka: {
    title: "Pogrzebówka",
    artist: "Denis",
    bpm: 150, // tymczasowe, do mp3
    bars: 30,
    // ujęcia 1 (idle), 2 (akordeon), 3 (ręce w górę), 4 (pali w fotelu)
    characters: rotateShots("assets/char/pogrzebowka", [1, 2, 3, 4], 52),
    characterScale: 0.95,
    characterY: 704,
    // przykładowy układ przeszkód: reflektor kilka razy + serie bomb
    events: [
      { type: "spotlight", at: 13, dur: 5 },
      { type: "spotlight", at: 26, dur: 6 },
      { type: "spotlight", at: 36.5, dur: 5 },
    ],
    bombs: [
      // seria 1 (~8-11 s)
      { lane: 2, time: 8.2 },
      { lane: 1, time: 9.4 },
      { lane: 0, time: 10.6 },
      // seria 2 (~19-23 s)
      { lane: 3, time: 19.4 },
      { lane: 2, time: 20.6 },
      { lane: 1, time: 22.2 },
      { lane: 0, time: 23.4 },
      // seria 3 (~30-34 s)
      { lane: 0, time: 30.6 },
      { lane: 1, time: 31.8 },
      { lane: 2, time: 33.4 },
      // seria 4 (~41-45 s)
      { lane: 3, time: 41.4 },
      { lane: 2, time: 42.6 },
      { lane: 1, time: 43.8 },
      { lane: 3, time: 45.0 },
    ],
  },
  "byleby-nie-byla-ciepla": {
    title: "Byleby nie była ciepła",
    artist: "Denis",
    bpm: 140, // tymczasowe, do mp3
    bars: 30,
    // ujęcia: 1 boombox-bujanie, 2 tancerka, 3 break dance, 4 „wódka"-swagger
    characters: rotateShots("assets/char/byleby-nie-byla-ciepla", [1, 2, 3, 4], 52),
    characterScale: 0.95,
    characterY: 704,
    // poziom 5 — mechanika lodu: ekran zamarza, trzeba rozbić 20 tapnięć
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
  notes: { lane: number; time: number; dur?: number; bomb?: boolean; fire?: boolean }[];
  events?: SongEvent[];
}

const clampLane = (l: number) => Math.max(0, Math.min(LANES - 1, Math.round(l)));

// dwie nuty na TEJ SAMEJ ścieżce zbyt blisko siebie = błąd edytora (nałożone
// duplikaty), nie zamysł — jednym tapnięciem nie da się fizycznie rozdzielić
// dwóch nut, więc druga byłaby gwarantowanym PUDŁEM. 45 ms to i tak mniej niż
// jakikolwiek grywalny odstęp (16-tka przy 200 BPM to 75 ms), więc akordów
// (różne ścieżki) ani szybkich serii NIE rusza.
const MIN_SAME_LANE_GAP = 0.045;

export function rawToSong(raw: RawChart): SongDef {
  const sorted = raw.notes
    .map((n) => mkNote(clampLane(n.lane), n.time, n.dur || 0, !!n.bomb, !!n.fire))
    .sort((a, b) => a.time - b.time || a.lane - b.lane);
  const lastIdxByLane = new Map<number, number>();
  const notes: Note[] = [];
  let dropped = 0;
  for (const n of sorted) {
    const pi = lastIdxByLane.get(n.lane);
    const prev = pi !== undefined ? notes[pi] : undefined;
    if (pi !== undefined && prev !== undefined && n.time - prev.time < MIN_SAME_LANE_GAP) {
      dropped++;
      // z nałożonej pary zostaw korzystniejszą dla gracza: trzymanie > zwykła > bomba
      const rank = (x: Note) => (x.dur > 0 ? 2 : x.bomb ? 0 : 1);
      if (rank(n) > rank(prev)) notes[pi] = n;
      continue;
    }
    lastIdxByLane.set(n.lane, notes.length);
    notes.push(n);
  }
  if (dropped) {
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane); // podmiana mogła lekko rozjechać kolejność
    console.warn(`rawToSong(${raw.id}): pominięto ${dropped} nałożonych nut`);
  }
  // beatmapa z edytora może nie mieć sensownego `duration` (utwór bez mp3) —
  // wtedy licz go z ostatniej nuty, żeby podkład syntezowany nie skończył się
  // od razu i gra nie wpadła w „finish()" tuż po odliczaniu
  const lastNote = notes.length ? notes[notes.length - 1].time + notes[notes.length - 1].dur : 0;
  const duration = raw.duration > lastNote + 1 ? raw.duration : lastNote + 3;
  const bpm = raw.bpm > 20 ? raw.bpm : 120;
  return {
    id: raw.id,
    title: raw.title,
    artist: raw.artist,
    bpm,
    bars: Math.max(1, Math.ceil((duration * bpm) / 60 / 4)),
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
    duration,
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

/** Poniżej tylu nut opublikowaną mapę uznajemy za „przypadkowo pustą" (np. ktoś
 *  kliknął „Wyślij do aplikacji" po „wyczyść wszystko") i wolimy pełną mapę z repo. */
const MIN_PUBLISHED_NOTES = 12;

export async function loadTrack(id: string): Promise<SongDef> {
  // 1. beatmapa opublikowana z edytora (Turso) — TYLKO na webie. W apce
  //    natywnej (Android/iOS) wszystko jest już zaszyte w buildzie (dźwięk,
  //    grafiki, beatmapy), więc nie ma po co czekać na sieć przy KAŻDYM
  //    starcie poziomu — na słabszym łączu to właśnie dawało wrażenie
  //    „zawieszonego" ładowania. Aktualizacje beatmap w apce idą przez nowy
  //    build/release, nie przez edytor „na żywo" (to zostaje dla webu, gdzie
  //    Konrad testuje zmiany bez przebudowy).
  const published = isNative ? null : await fetchPublishedChart(id);

  // 2. plik beatmapy w repo — używany jako fallback ORAZ jako miara, czy
  //    opublikowana mapa nie jest przypadkowo okrojona. To zawsze plik
  //    LOKALNY (zaszyty w buildzie/bundlu) — krótki timeout, żeby ewentualne
  //    zacięcie nie kosztowało pełnych 35 s zewnętrznego watchdoga w game.ts
  //    (ta sama klasa błędu co przy audio — patrz audio.ts AudioLoadError).
  let repo: RawChart | null = null;
  try {
    const ctrl = typeof AbortController === "function" ? new AbortController() : undefined;
    const to = ctrl ? setTimeout(() => ctrl.abort(), 8000) : undefined;
    try {
      const res = await fetch(`charts/${id}.json`, { signal: ctrl?.signal });
      if (res.ok) {
        const raw = (await res.json()) as RawChart;
        if (raw && Array.isArray(raw.notes) && raw.notes.length) repo = raw;
      }
    } finally {
      if (to) clearTimeout(to);
    }
  } catch {
    /* brak pliku, nie JSON, albo timeout — lecimy dalej (syntezowany podkład) */
  }

  if (published) {
    const thin = (published.notes?.length ?? 0) < MIN_PUBLISHED_NOTES;
    const repoFull = !!repo && repo.notes.length >= MIN_PUBLISHED_NOTES;
    if (thin && repoFull) {
      console.warn(
        `loadTrack(${id}): opublikowana mapa ma tylko ${published.notes?.length ?? 0} nut — używam pełnej z repo`,
      );
    } else {
      return rawToSong(published);
    }
  }
  if (repo) return rawToSong(repo);

  // 3. syntezowany podkład
  const cfg = SYNTH_TRACKS[id] ?? SYNTH_TRACKS.rozgrzewka;
  return buildSynthSong({ id: id === "placeholder-01" ? "rozgrzewka" : id, ...cfg });
}
