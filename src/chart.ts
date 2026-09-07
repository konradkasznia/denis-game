// Beatmapa (chart) dla jednej piosenki.
//
// W wersji docelowej każdy utwór Denisa dostanie własny plik JSON generowany
// w edytorze. Tutaj chart jest budowany proceduralnie z siatki perkusji, więc
// nuty są idealnie zsynchronizowane z syntezowanym podkładem z audio.ts.
// Gdy dostaniemy prawdziwy plik audio + BPM, podmieniamy tylko ten moduł.

export interface Note {
  /** numer toru 0..LANES-1 */
  lane: number;
  /** czas trafienia (głowy nuty) w sekundach od startu utworu */
  time: number;
  /** długość nuty trzymanej w sekundach; 0 = zwykły tap */
  dur: number;
  /** bomba — tapnięcie karze (-100 pkt) i ogłusza gracza na 3 s; omijać */
  bomb?: boolean;
  /** płonąca nuta — najpierw trzeba zgasić (tap w gaśnicę w okręgu), potem trafić normalnie */
  fire?: boolean;
  // --- stan runtime ---
  /** płonąca nuta: ogień już zgaszony (zachowuje się dalej jak zwykła nuta) */
  fireOut?: boolean;
  /** songTime zgaszenia ognia — do krótkiej animacji „stygnięcia" */
  fireOutAt?: number;
  /** rozliczona do końca (można pominąć w dalszej logice) */
  judged: boolean;
  /** głowa nuty trafiona */
  hit: boolean;
  /** nuta trzymana jest właśnie przytrzymywana */
  holding: boolean;
  /** ocena głowy nuty */
  headJ: "perfect" | "great" | "good" | "miss" | null;
  /** songTime rozliczenia — do animacji zejścia nuty */
  judgedAt: number;
}

/** Zdarzenie na osi czasu utworu (poza nutami) — „przeszkoda" z edytora. */
export interface SongEvent {
  type: "ice" | "spotlight" | "drunk";
  /** sekunda utworu, w której się uruchamia */
  at: number;
  /** LÓD: ile tapnięć trzeba, by rozbić lód */
  taps?: number;
  /** REFLEKTOR / PIJANY EKRAN: ile sekund trwa efekt */
  dur?: number;
}

export interface SongDef {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  /** ile pełnych taktów gra podkład (używane tylko przez syntezowany podkład) */
  bars: number;
  /** od którego taktu zaczynają lecieć nuty (lead-in) */
  startBar: number;
  lanes: number;
  /** ścieżka do prawdziwego pliku audio; brak = syntezowany podkład */
  audioUrl?: string;
  /** tło ekranu gry dla tego utworu (obraz); brak = domyślne */
  bg?: string;
  /** postać na pierwszym planie: pojedynczy PNG (animowany proceduralnie) */
  character?: string;
  /** animacje postaci na osi czasu utworu (sprite sheet / sekwencja PNG) */
  characters?: { at: number; sprite: string }[];
  characterScale?: number;
  characterY?: number;
  notes: Note[];
  /** zdarzenia na osi czasu (np. lód) */
  events?: SongEvent[];
  /** całkowita długość utworu w sekundach */
  duration: number;
}

export const LANES = 4;

// Kolejność torów dla strumienia nut — ręcznie dobrany „przebieg" po klawiszach,
// żeby granie było płynne i miało sens muzyczny.
const LANE_PATTERN = [0, 1, 2, 3, 2, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1];

export function mkNote(lane: number, time: number, dur = 0, bomb = false, fire = false): Note {
  const n: Note = {
    lane,
    time: +time.toFixed(4),
    dur,
    judged: false,
    hit: false,
    holding: false,
    headJ: null,
    judgedAt: 0,
  };
  if (bomb) n.bomb = true;
  if (fire && !bomb) {
    n.fire = true;
    n.fireOut = false;
  }
  return n;
}

export interface SynthOpts {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  bars: number;
  /** opcjonalne warstwy wizualne — działają też dla podkładu syntezowanego */
  bg?: string;
  character?: string;
  characters?: { at: number; sprite: string }[];
  characterScale?: number;
  characterY?: number;
  events?: SongEvent[];
  /** bomby — nuty-pułapki dokładane do wygenerowanego strumienia (tap = -100 pkt) */
  bombs?: { lane: number; time: number }[];
  /** płonące nuty — najbliższa nuta w torze zostaje oznaczona jako „do zgaszenia" */
  fires?: { lane: number; time: number }[];
}

function build(o: SynthOpts): SongDef {
  const bpm = o.bpm;
  const beat = 60 / bpm;
  const step = beat / 4; // 16-tka
  const bars = o.bars;
  // nuty i podkład ruszają od razu — właściwy lead-in to odliczanie 3-2-1
  // w grze (klip 321.mp3), więc tutaj żadnego pustego wstępu
  const startBar = 0;
  const barLen = 16 * step;
  // przesunięcie wzorca torów zależne od id — każdy utwór gra się inaczej
  const shift = [...o.id].reduce((a, c) => a + c.charCodeAt(0), 0) % LANES;

  // 1. Czasy nut: rzadki puls (stopa + werbel + 1 synkopa na takt) ≈ 1.5–2/s
  const beatTimes: number[] = [];
  for (let bar = startBar; bar < bars; bar++) {
    const barStart = bar * barLen;
    const steps = new Set<number>([0, 4, 8, 12, bar % 2 === 0 ? 6 : 10]);
    [...steps].sort((a, b) => a - b).forEach((s) => beatTimes.push(barStart + s * step));
  }

  // 2. Przypisz tory z wzorca, unikając powtórki tego samego toru zbyt blisko
  const notes: Note[] = [];
  let pi = 0;
  let lastLane = -1;
  let lastTime = -10;
  for (const t of beatTimes) {
    let lane = (LANE_PATTERN[pi % LANE_PATTERN.length] + shift) % LANES;
    pi++;
    if (lane === lastLane && t - lastTime < 0.18) {
      lane = (LANE_PATTERN[pi % LANE_PATTERN.length] + shift) % LANES;
      pi++;
    }
    notes.push(mkNote(lane, t));
    lastLane = lane;
    lastTime = t;
  }

  // 3. Nuty trzymane. Pojedyncze na downbeatach wybranych taktów oraz
  //    „akordy" trzymane — dwa tory naraz, które trzeba przytrzymać razem.
  const setHold = (time: number, lane: number, dur: number) => {
    const idx = notes.findIndex((x) => Math.abs(x.time - time) < 0.01 && x.lane === lane);
    if (idx >= 0) notes[idx].dur = dur;
    else notes.push(mkNote(lane, time, dur));
  };

  const laneAt = (time: number, fallback: number) =>
    notes.find((x) => Math.abs(x.time - time) < 0.01)?.lane ?? fallback;

  const hb1 = startBar + 4;
  const hb2 = Math.floor((startBar + bars) / 2); // akord w środku
  const hb3 = bars - 6;
  const finBar = bars - 2;
  if (hb1 < bars - 3) setHold(hb1 * barLen, laneAt(hb1 * barLen, 1), beat * 2);
  if (hb2 > hb1 + 2 && hb2 < bars - 3) {
    setHold(hb2 * barLen, 0, beat * 2);
    setHold(hb2 * barLen, 3, beat * 2);
  }
  if (hb3 > hb2 + 2 && hb3 < bars - 3) setHold(hb3 * barLen, laneAt(hb3 * barLen, 2), beat * 2);
  // finał — długi akord trzymany
  setHold(finBar * barLen, 1, beat * 3);
  setHold(finBar * barLen, 2, beat * 3);

  // 4. Usuń nuty w tym samym torze kolidujące z trwaniem trzymania.
  const holds = notes.filter((n) => n.dur > 0);
  const cleaned = notes.filter((n) => {
    if (n.dur > 0) return true;
    return !holds.some(
      (h) => h.lane === n.lane && n.time > h.time + 0.001 && n.time < h.time + h.dur + 0.14,
    );
  });

  // 5. Bomby — nuty-pułapki dokładane do strumienia. Usuwamy zwykłą nutę w tym
  //    samym torze bardzo blisko bomby (żeby okno trafienia nie było dwuznaczne).
  for (const b of o.bombs ?? []) {
    const lane = Math.max(0, Math.min(LANES - 1, Math.round(b.lane)));
    const time = +b.time.toFixed(4);
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i].lane === lane && Math.abs(cleaned[i].time - time) < 0.16) cleaned.splice(i, 1);
    }
    cleaned.push(mkNote(lane, time, 0, true));
  }

  // 6. Płonące nuty — oznacz najbliższą zwykłą nutę w tym torze; jak brak, dołóż tap.
  for (const f of o.fires ?? []) {
    const lane = Math.max(0, Math.min(LANES - 1, Math.round(f.lane)));
    const time = +f.time.toFixed(4);
    let best = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i].lane !== lane || cleaned[i].bomb) continue;
      const d = Math.abs(cleaned[i].time - time);
      if (d < bestAbs && d < 0.2) {
        bestAbs = d;
        best = i;
      }
    }
    if (best >= 0) {
      cleaned[best].fire = true;
      cleaned[best].fireOut = false;
    } else {
      cleaned.push(mkNote(lane, time, 0, false, true));
    }
  }

  cleaned.sort((a, b) => a.time - b.time || a.lane - b.lane);
  const duration = bars * barLen;

  return {
    id: o.id,
    title: o.title,
    artist: o.artist,
    bpm,
    bars,
    startBar,
    lanes: LANES,
    bg: o.bg,
    character: o.character,
    characters: o.characters,
    characterScale: o.characterScale,
    characterY: o.characterY,
    notes: cleaned,
    events: o.events,
    duration,
  };
}

const DEFAULT_SYNTH: SynthOpts = {
  id: "rozgrzewka",
  title: "Rozgrzewka",
  artist: "podkład testowy",
  bpm: 100,
  bars: 24,
};

/** Syntezowany podkład testowy dla utworu bez pliku audio. */
export function buildSynthSong(opts?: Partial<SynthOpts>): SongDef {
  const s = build({ ...DEFAULT_SYNTH, ...opts });
  return { ...s, notes: s.notes.map((n) => mkNote(n.lane, n.time, n.dur, n.bomb, n.fire)) };
}
