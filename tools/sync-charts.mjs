#!/usr/bin/env node
// Ściąga aktualne, OPUBLIKOWANE (z edytora, Turso) beatmapy i zapisuje je do
// public/charts/<id>.json — czyli do plików, które apka NATYWNA (Android/iOS)
// gra bezpośrednio z buildu, bez pytania serwera przy starcie poziomu
// (patrz src/tracks.ts: `isNative ? null : await fetchPublishedChart(id)`).
//
// WAŻNE: od kiedy apka natywna nie sprawdza już serwera przy starcie poziomu
// (celowo — to było źródło długiego ładowania na słabszych telefonach), plik
// w repo jest JEDYNYM źródłem beatmapy w APK. Jeśli Konrad poprawi mapę w
// edytorze i tego nie zsynchronizuje do repo PRZED zbudowaniem nowego APK,
// apka natywna gra starą/inną mapę niż web — dokładnie to zgłoszenie
// „nutki i animacje źle poustawiane" w tej sesji.
//
// Uruchamiać RĘCZNIE po każdej sesji edycji beatmapy w edytorze, PRZED
// pushem, który buduje nowy APK:
//
//   node tools/sync-charts.mjs
//
// (albo `node tools/sync-charts.mjs panna-mloda` żeby zsynchronizować tylko
// jeden utwór).

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARTS_DIR = join(__dirname, "..", "public", "charts");
const API_BASE = "https://denis-game.vercel.app";

// utwory z prawdziwą (nie syntezowaną) beatmapą — patrz src/tracks.ts SYNTH_TRACKS
const SONG_IDS = ["panna-mloda", "ksiaze-z-bajki", "pogrzebowka"];

async function syncOne(id) {
  const path = join(CHARTS_DIR, `${id}.json`);
  const r = await fetch(`${API_BASE}/api/chart?songId=${encodeURIComponent(id)}`);
  if (!r.ok) {
    console.warn(`  ${id}: serwer odpowiedział ${r.status} — pomijam`);
    return;
  }
  const j = await r.json();
  if (!j?.ok || !j.chart || !Array.isArray(j.chart.notes) || !j.chart.notes.length) {
    console.warn(`  ${id}: brak opublikowanej mapy (albo pusta) — repo bez zmian`);
    return;
  }
  const before = existsSync(path)
    ? (() => {
        try {
          return JSON.parse(readFileSync(path, "utf8")).notes?.length ?? "brak";
        } catch {
          return "brak";
        }
      })()
    : "brak pliku";
  writeFileSync(path, JSON.stringify(j.chart, null, 2) + "\n");
  console.log(`  ${id}: ${before} → ${j.chart.notes.length} nut (zaktualizowano: ${j.updatedAt ?? "?"})`);
}

const only = process.argv[2];
const ids = only ? [only] : SONG_IDS;
console.log(`Synchronizacja beatmap z ${API_BASE} do public/charts/ ...`);
for (const id of ids) {
  await syncOne(id);
}
console.log("Gotowe. Sprawdź `git diff public/charts/` i zacommituj, jeśli coś się zmieniło.");
