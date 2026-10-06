// Zaszywa w paczce apki AKTUALNE beatmapy z edytora (i brakujące mp3).
//
// Gra NIE pobiera map ani muzyki z serwera w trakcie działania: gra dokładnie
// to, co jest w public/charts/*.json i public/assets/songs/*.mp3 w chwili
// buildu. Po zmianach w edytorze („Wyślij do aplikacji") uruchom:
//
//   node tools/pull-charts.mjs            # wszystkie grywalne utwory z src/songs.ts
//   node tools/pull-charts.mjs pan-strazak # tylko wybrane
//
// i zacommituj zmienione pliki. Utwór bez publikacji zostaje z mapą z repo.

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.CHART_API || "https://denis-game.vercel.app";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");

function playableSongIds() {
  const src = fs.readFileSync(path.join(root, "src/songs.ts"), "utf8");
  const ids = [];
  for (const m of src.matchAll(/id: "([^"]+)"[\s\S]*?playable: (true|false)/g)) if (m[2] === "true") ids.push(m[1]);
  return ids;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : playableSongIds();
let changed = 0;

for (const id of ids) {
  const res = await fetch(`${BASE}/api/chart?songId=${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) {
    console.log(`${id}: brak publikacji w edytorze, zostaje mapa z repo`);
    continue;
  }
  if (!res.ok) throw new Error(`${id}: /api/chart HTTP ${res.status}`);
  const j = await res.json();
  const chart = j?.chart;
  if (!chart || !Array.isArray(chart.notes) || !chart.notes.length) throw new Error(`${id}: pusta mapa z serwera`);

  const file = path.join(root, "public/charts", `${id}.json`);
  const next = JSON.stringify(chart, null, 2) + "\n";
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (prev !== next) {
    fs.writeFileSync(file, next);
    changed++;
    const holds = chart.notes.filter((n) => (n.dur || 0) > 0).length;
    console.log(`${id}: mapa zapisana (${chart.notes.length} nut, ${holds} trzymanych, publikacja ${j.updatedAt || "?"})`);
  } else {
    console.log(`${id}: mapa bez zmian`);
  }

  // muzyka: musi leżeć w paczce pod adresem z mapy
  const audioRel = chart.audioUrl;
  if (audioRel && !/^https?:/i.test(audioRel)) {
    const audioFile = path.join(root, "public", audioRel);
    if (!fs.existsSync(audioFile)) {
      const a = await fetch(`${BASE}/api/song-audio?id=${encodeURIComponent(id)}`);
      if (!a.ok) throw new Error(`${id}: brak mp3 w repo i /api/song-audio HTTP ${a.status}`);
      fs.mkdirSync(path.dirname(audioFile), { recursive: true });
      fs.writeFileSync(audioFile, Buffer.from(await a.arrayBuffer()));
      changed++;
      console.log(`${id}: pobrano mp3 -> public/${audioRel}`);
    }
  }
}

console.log(changed ? `Zmienione pliki: ${changed}. Zacommituj je przed buildem.` : "Wszystko aktualne.");
