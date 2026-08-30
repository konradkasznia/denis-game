// Beatmapa (chart) dla jednej piosenki.
//
// W wersji docelowej każdy utwór Denisa dostanie własny plik JSON generowany
// w edytorze. Tutaj chart jest budowany proceduralnie z siatki perkusji, więc
// nuty są idealnie zsynchronizowane z syntezowanym podkładem z audio.ts.
// Gdy dostaniemy prawdziwy plik audio + BPM, podmieniamy tylko ten moduł.

export interface Note {
  /** numer toru 0..LANES-1 */
  lane: number;
  /** czas trafienia w sekundach od startu utworu */
  time: number;
  // stan runtime:
  judged: boolean;
  hit: boolean;
}

export interface SongDef {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  /** ile pełnych taktów gra podkład */
  bars: number;
  /** od którego taktu zaczynają lecieć nuty (lead-in) */
  startBar: number;
  lanes: number;
  notes: Note[];
  /** całkowita długość utworu w sekundach */
  duration: number;
}

export const LANES = 4;

// Kolejność torów dla strumienia nut — ręcznie dobrany „przebieg" po klawiszach,
// żeby granie było płynne i miało sens muzyczny.
const LANE_PATTERN = [0, 1, 2, 3, 2, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1];

function makeSong(): SongDef {
  const bpm = 100;
  const beat = 60 / bpm;
  const step = beat / 4; // 16-tka
  const bars = 26;
  const startBar = 2;
  const lanes = LANES;

  // 1. Zbierz czasy uderzeń (te same, które gra sekwencer perkusji w audio.ts)
  const beatTimes: number[] = [];
  for (let bar = startBar; bar < bars; bar++) {
    const barStart = bar * 16 * step;
    // stopa: ćwiartki
    const kickSteps = [0, 4, 8, 12];
    // werbel: 2 i 4
    const snareSteps = [4, 12];
    // w gęstszych fragmentach dokładamy off-beaty
    const busy = (bar >= 8 && bar < 14) || (bar >= 18 && bar < 24);
    const hatSteps = busy ? [2, 6, 10, 14] : bar % 2 === 0 ? [6] : [10];

    const stepsThisBar = new Set<number>([...kickSteps, ...snareSteps, ...hatSteps]);
    [...stepsThisBar]
      .sort((a, b) => a - b)
      .forEach((s) => beatTimes.push(barStart + s * step));
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
    notes.push({ lane, time: +t.toFixed(4), judged: false, hit: false });
    lastLane = lane;
    lastTime = t;
  }

  const duration = bars * 16 * step;

  return {
    id: "placeholder-01",
    title: "Podkład testowy",
    artist: "Denis",
    bpm,
    bars,
    startBar,
    lanes,
    notes,
    duration,
  };
}

/** Świeża kopia utworu (nuty z wyzerowanym stanem) do rozpoczęcia rozgrywki. */
export function loadSong(): SongDef {
  const s = makeSong();
  return {
    ...s,
    notes: s.notes.map((n) => ({ ...n, judged: false, hit: false })),
  };
}
