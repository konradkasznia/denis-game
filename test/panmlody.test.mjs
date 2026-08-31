// Walidacja beatmapy Pan Młody (node --experimental-strip-types test/panmlody.test.mjs)
import fs from "node:fs";
import { rawToSong } from "../src/tracks.ts";
import { LANES } from "../src/chart.ts";

let fail = 0;
const ok = (c, m) => {
  if (!c) {
    console.error("  ✗", m);
    fail++;
  } else console.log("  ✓", m);
};

const raw = JSON.parse(fs.readFileSync(new URL("../public/charts/pan-mlody.json", import.meta.url)));
ok(raw.id === "pan-mlody", "id = pan-mlody");
ok(raw.bpm === 140, `bpm = ${raw.bpm}`);
ok(raw.audioUrl === "assets/songs/pan-mlody.mp3", "wskazuje na plik audio");
ok(fs.existsSync(new URL("../public/assets/songs/pan-mlody.mp3", import.meta.url)), "plik mp3 istnieje");
ok(raw.notes.length > 200, `liczba nut: ${raw.notes.length}`);

const song = rawToSong(raw);
ok(song.notes.every((n) => n.lane >= 0 && n.lane < LANES), "tory w zakresie");
ok(
  song.notes.every((n, i) => i === 0 || n.time >= song.notes[i - 1].time),
  "czasy rosnące po sortowaniu",
);
ok(song.notes[0].time >= 4, `pierwsza nuta po intrze: ${song.notes[0].time.toFixed(2)}s`);
ok(
  song.notes[song.notes.length - 1].time < song.duration,
  `ostatnia nuta przed końcem (${song.notes.at(-1).time.toFixed(1)} < ${song.duration})`,
);

let clash = 0;
for (let i = 1; i < song.notes.length; i++) {
  const a = song.notes[i - 1];
  const b = song.notes[i];
  if (a.lane === b.lane && b.time - a.time < 0.08) clash++;
}
ok(clash === 0, `brak nut w tym samym torze < 80ms: ${clash}`);

const dens = song.notes.length / (song.notes.at(-1).time - song.notes[0].time);
ok(dens > 1 && dens < 7, `gęstość ${dens.toFixed(2)} nut/s w rozsądnym zakresie`);

console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
