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
  // --- stan runtime ---
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
  notes: Note[];
  /** całkowita długość utworu w sekundach */
  duration: number;
}

export const LANES = 4;

// Kolejność torów dla strumienia nut — ręcznie dobrany „przebieg" po klawiszach,
// żeby granie było płynne i miało sens muzyczny.
const LANE_PATTERN = [0, 1, 2, 3, 2, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1];

export function mkNote(lane: number, time: number, dur = 0): Note {
  return { lane, time: +time.toFixed(4), dur, judged: false, hit: false, holding: false, headJ: null, judgedAt: 0 };
}

function build(): SongDef {
  const bpm = 100;
  const beat = 60 / bpm;
  const step = beat / 4; // 16-tka
  const bars = 26;
  const startBar = 2;
  const barLen = 16 * step;

  // 1. Zbierz czasy uderzeń (te same, które gra sekwencer perkusji w audio.ts)
  const beatTimes: number[] = [];
  for (let bar = startBar; bar < bars; bar++) {
    const barStart = bar * barLen;
    const kickSteps = [0, 4, 8, 12];
    const snareSteps = [4, 12];
    const busy = (bar >= 8 && bar < 14) || (bar >= 18 && bar < 24);
    const hatSteps = busy ? [2, 6, 10, 14] : bar % 2 === 0 ? [6] : [10];
    const stepsThisBar = new Set<number>([...kickSteps, ...snareSteps, ...hatSteps]);
    [...stepsThisBar].sort((a, b) => a - b).forEach((s) => beatTimes.push(barStart + s * step));
  }

  // 2. Przypisz tory z wzorca, unikając powtórki tego samego toru zbyt blisko
  const notes: Note[] = [];
  let pi = 0;
  let lastLane = -1;
  let lastTime = -10;
  for (const t of beatTimes) {
    let lane = LANE_PATTERN[pi % LANE_PATTERN.length];
    pi++;
    if (lane === lastLane && t - lastTime < 0.18) {
      lane = LANE_PATTERN[pi % LANE_PATTERN.length];
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

  // pojedyncze trzymania — tor bierzemy z nuty stojącej na tym downbeacie
  const laneAt = (time: number, fallback: number) =>
    notes.find((x) => Math.abs(x.time - time) < 0.01)?.lane ?? fallback;
  setHold((startBar + 4) * barLen, laneAt((startBar + 4) * barLen, 1), beat * 2);
  setHold((startBar + 20) * barLen, laneAt((startBar + 20) * barLen, 2), beat * 2);

  // akord trzymany w połowie utworu (dwa tory jednocześnie)
  const midT = (startBar + 12) * barLen;
  setHold(midT, 0, beat * 2);
  setHold(midT, 3, beat * 2);

  // finał — długi akord trzymany
  const finT = (bars - 2) * barLen;
  setHold(finT, 1, beat * 3.5);
  setHold(finT, 2, beat * 3.5);

  // 4. Usuń nuty w tym samym torze kolidujące z trwaniem trzymania.
  const holds = notes.filter((n) => n.dur > 0);
  const cleaned = notes.filter((n) => {
    if (n.dur > 0) return true;
    return !holds.some(
      (h) => h.lane === n.lane && n.time > h.time + 0.001 && n.time < h.time + h.dur + 0.14,
    );
  });

  cleaned.sort((a, b) => a.time - b.time || a.lane - b.lane);
  const duration = bars * barLen;

  return {
    id: "rozgrzewka",
    title: "Rozgrzewka",
    artist: "podkład testowy",
    bpm,
    bars,
    startBar,
    lanes: LANES,
    notes: cleaned,
    duration,
  };
}

/** Syntezowany podkład testowy — świeża kopia z wyzerowanym stanem nut. */
export function buildSynthSong(): SongDef {
  const s = build();
  return { ...s, notes: s.notes.map((n) => mkNote(n.lane, n.time, n.dur)) };
}
