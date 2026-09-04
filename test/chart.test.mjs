// Sanity-check generatora beatmapy (node --experimental-strip-types test/chart.test.mjs)
import { buildSynthSong as loadSong, LANES } from "../src/chart.ts";

let fail = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("  ✗", msg);
    fail++;
  } else console.log("  ✓", msg);
};

const s = loadSong();
const holds = s.notes.filter((n) => n.dur > 0);

ok(s.notes.length > 100, `liczba nut: ${s.notes.length}`);
ok(s.notes.every((n) => n.lane >= 0 && n.lane < LANES), "wszystkie tory w zakresie");
ok(
  s.notes.every((n, i) => i === 0 || n.time >= s.notes[i - 1].time),
  "czasy nut rosnące",
);
// lead-in to teraz ciche odliczanie 3-2-1 w grze — chart rusza od zera
ok(s.notes[0].time < 1, `pierwsza nuta od startu: ${s.notes[0].time.toFixed(2)}s`);
ok(
  s.notes.every((n) => n.time + n.dur < s.duration),
  "każda nuta (z ogonem) kończy się przed końcem utworu",
);

// nuty trzymane
ok(holds.length >= 4, `są nuty trzymane: ${holds.length}`);
ok(holds.every((h) => h.dur >= 0.25), "każde trzymanie ma sensowną długość");
const chordTimes = holds.map((h) => h.time.toFixed(3));
ok(new Set(chordTimes).size < holds.length, "istnieją akordy trzymane (2 tory w tym samym czasie)");

// żadna zwykła nuta nie koliduje z trwaniem trzymania w tym samym torze
let overlap = 0;
for (const h of holds) {
  for (const n of s.notes) {
    if (n === h || n.lane !== h.lane) continue;
    if (n.time > h.time + 0.001 && n.time < h.time + h.dur + 0.13) overlap++;
  }
}
ok(overlap === 0, `brak kolizji nuta↔trzymanie w tym samym torze: ${overlap}`);

// brak zwykłych nut w tym samym torze bliżej niż 90 ms
let clash = 0;
for (let i = 1; i < s.notes.length; i++) {
  const a = s.notes[i - 1];
  const b = s.notes[i];
  if (a.lane === b.lane && a.dur === 0 && b.dur === 0 && b.time - a.time < 0.09) clash++;
}
ok(clash === 0, `kolizje zwykłych nut w tym samym torze < 90ms: ${clash}`);

ok(
  s.notes.every((n) => !n.judged && !n.hit && !n.holding),
  "stan nut wyzerowany",
);

console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
