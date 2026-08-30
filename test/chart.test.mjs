// Szybki sanity-check generatora beatmapy (uruchom: node test/chart.test.mjs)
import { loadSong, LANES } from "../src/chart.ts";

let fail = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("  ✗", msg);
    fail++;
  } else console.log("  ✓", msg);
};

const s = loadSong();

ok(s.notes.length > 100, `liczba nut: ${s.notes.length}`);
ok(
  s.notes.every((n) => n.lane >= 0 && n.lane < LANES),
  "wszystkie tory w zakresie",
);
ok(
  s.notes.every((n, i) => i === 0 || n.time >= s.notes[i - 1].time),
  "czasy nut rosnące",
);
ok(s.notes[0].time > 3, `pierwsza nuta po lead-inie: ${s.notes[0].time.toFixed(2)}s`);
ok(
  s.notes[s.notes.length - 1].time < s.duration,
  `ostatnia nuta przed końcem: ${s.notes.at(-1).time.toFixed(2)} < ${s.duration.toFixed(2)}`,
);

// brak nut w tym samym torze bliżej niż 90 ms
let clash = 0;
for (let i = 1; i < s.notes.length; i++) {
  const a = s.notes[i - 1];
  const b = s.notes[i];
  if (a.lane === b.lane && b.time - a.time < 0.09) clash++;
}
ok(clash === 0, `kolizje w tym samym torze < 90ms: ${clash}`);

// świeża kopia ma wyzerowany stan
ok(
  s.notes.every((n) => !n.judged && !n.hit),
  "stan nut wyzerowany",
);

console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
