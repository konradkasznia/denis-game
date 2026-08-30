// Testy czystej logiki oceny (node test/judge.test.mjs)
import { classify, pickNote, isMissed, comboMultiplier, W_PERFECT, W_GREAT, W_GOOD } from "../src/judge.ts";

let fail = 0;
const eq = (a, b, msg) => {
  if (a !== b) {
    console.error(`  ✗ ${msg} — oczekiwano ${b}, jest ${a}`);
    fail++;
  } else console.log(`  ✓ ${msg}`);
};

// classify
eq(classify(0), "perfect", "Δ0 → perfect");
eq(classify(W_PERFECT - 0.001), "perfect", "tuż przed granicą perfect");
eq(classify(W_PERFECT + 0.001), "great", "tuż za granicą perfect → great");
eq(classify(W_GREAT + 0.001), "good", "za great → good");
eq(classify(W_GOOD + 0.001), null, "za good → null (pudło przy stuknięciu ignorowane)");

// comboMultiplier
eq(comboMultiplier(0), 1, "combo 0 → x1.0");
eq(comboMultiplier(25), 1.5, "combo 25 → x1.5");
eq(comboMultiplier(999), 2, "combo capuje się na x2.0");

// pickNote — wybiera najbliższą nutę w torze
const notes = [
  { lane: 0, time: 10.0, judged: false, hit: false },
  { lane: 0, time: 10.3, judged: false, hit: false },
  { lane: 1, time: 10.02, judged: false, hit: false },
];
const p1 = pickNote(notes, 0, 10.02, 0);
eq(p1?.note.time, 10.0, "tor 0, t=10.02 → nuta 10.0");
eq(Math.abs(p1.absDt - 0.02) < 1e-9, true, "absDt ≈ 0.02");

const p2 = pickNote(notes, 0, 10.5, 0);
eq(p2, null, "t=10.5 poza oknem → brak");

const p3 = pickNote(notes, 1, 10.06, 0);
eq(p3?.note.time, 10.02, "inny tor oceniany niezależnie");

// offset (kalibracja) przesuwa moment oceny
const p4 = pickNote(notes, 0, 10.1, 0.1);
eq(p4?.note.time, 10.0, "offset +100ms: stuknięcie 10.1 pasuje do nuty 10.0");

// judged pomijane
const p5 = pickNote([{ lane: 0, time: 10.0, judged: true, hit: true }], 0, 10.0, 0);
eq(p5, null, "oceniona nuta pomijana");

// isMissed
eq(isMissed({ lane: 0, time: 10, judged: false }, 10.2, 0), true, "0.2s po nucie → pudło");
eq(isMissed({ lane: 0, time: 10, judged: false }, 10.1, 0), false, "0.1s po nucie → jeszcze nie");
eq(isMissed({ lane: 0, time: 10, judged: true }, 99, 0), false, "oceniona nie może być pudłem");

console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
