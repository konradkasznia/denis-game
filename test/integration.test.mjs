// Test integracyjny: pełny przebieg rozgrywki na zaślepkach (bez canvasu/audio).
// Uruchamia prawdziwą pętlę update()/render() klasy Game przez wirtualny czas
// przy 60 fps i sprawdza mechanikę — w tym nuty trzymane i akordy.
//
//   node --experimental-strip-types test/integration.test.mjs

function chain() {
  const f = function () {
    return f;
  };
  return new Proxy(f, {
    get: (t, p) => (p in t ? t[p] : chain()),
    set: () => true,
    apply: () => chain(),
  });
}

class FakeAudioContext {
  constructor() {
    this._t = 0;
    this.state = "running";
    this.sampleRate = 48000;
    this.destination = chain();
  }
  get currentTime() {
    return this._t;
  }
  resume() {
    return Promise.resolve();
  }
  createGain() {
    return chain();
  }
  createOscillator() {
    return chain();
  }
  createDynamicsCompressor() {
    return chain();
  }
  createBiquadFilter() {
    return chain();
  }
  createBufferSource() {
    return chain();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(4) };
  }
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.Image = class {
  set src(_v) {
    queueMicrotask(() => this.onload && this.onload());
  }
  get width() {
    return 100;
  }
  get height() {
    return 100;
  }
};
globalThis.window = { AudioContext: FakeAudioContext };

const { Game } = await import("../src/game.ts");

let fail = 0;
const ok = (c, m) => {
  if (!c) {
    console.error("  ✗", m);
    fail++;
  } else console.log("  ✓", m);
};

const ctx = chain();

async function playthrough(mode) {
  const g = new Game();
  g.trackId = "panna-mloda"; // syntezowany podkład (runda 1) — bez fetch/audio
  await new Promise((r) => setTimeout(r, 5));
  await g.startPlay();
  ok(g.awaitingStart === true, mode + ": po wczytaniu czeka na dotyk startu");
  g.onPress(-1, 360, 640); // świeży dotyk uruchamia utwór
  const ac = g.audio.ctx;
  const dt = 1 / 60;
  let frame = 0;

  while (g.scene !== "results" && frame < 60 * 100) {
    ac._t += dt;
    g.update(dt, frame * 16.67);
    const st = g.songTime;

    if (mode !== "idle") {
      // wciśnij głowy nut w idealnym momencie
      for (const n of g.song.notes) {
        if (!n.judged && !n.holding && st >= n.time && st - n.time < dt) {
          g.onPress(n.lane, -1, -1);
        }
      }
      // puść nuty trzymane
      for (let lane = 0; lane < 4; lane++) {
        const h = g.held[lane];
        if (!h) continue;
        const end = h.time + h.dur;
        if (mode === "hold-perfect" && st >= end && st < end + dt * 3) {
          g.onRelease(lane); // puszczenie równo na końcu
        }
        if (mode === "hold-break" && st >= h.time + h.dur * 0.4) {
          g.onRelease(lane); // puszczenie stanowczo za wcześnie
        }
      }
    }
    g.render(ctx);
    frame++;
  }
  return g;
}

console.log("· przebieg idealny (głowy + poprawne puszczanie trzymań):");
const perfect = await playthrough("hold-perfect");
const holdCount = perfect.song.notes.filter((n) => n.dur > 0).length;
console.log(`(nut trzymanych w utworze: ${holdCount})`);
ok(perfect.scene === "results", "kończy się ekranem wyniku");
ok(perfect.counts.miss === 0, `zero pudeł (${perfect.counts.miss})`);
ok(perfect.holdsDone === holdCount, `wszystkie trzymania utrzymane (${perfect.holdsDone}/${holdCount})`);
ok(perfect.holdsBroken === 0, `zero zerwanych trzymań (${perfect.holdsBroken})`);
ok(perfect.judgedCount === perfect.song.notes.length, "wszystkie nuty ocenione");
ok(perfect.combo === perfect.maxCombo, "combo nieprzerwane do końca");
ok(perfect.accuracy() > 0.99, `celność ~100% (${(perfect.accuracy() * 100).toFixed(1)}%)`);
ok(perfect.score > 40000, `wysoki wynik (${perfect.score})`);
ok(perfect.flowTier === 4, `mnożnik dobity do x5 (tier ${perfect.flowTier})`);
ok(perfect.maxFlow >= 40, `flow rośnie z serią perfektów (${perfect.maxFlow})`);
ok(perfect.starFill() >= 4.9, `5 gwiazdek za idealny przebieg (${perfect.starFill().toFixed(2)})`);
ok(perfect.rating() >= 0.7, `runda zaliczona (ocena ${(perfect.rating() * 100).toFixed(0)}%)`);
ok(Number(localStorage.getItem("denis.best")) === perfect.score, "rekord zapisany");

console.log("\n· trzymania puszczane za wcześnie:");
const brk = await playthrough("hold-break");
ok(brk.scene === "results", "kończy się ekranem wyniku");
ok(brk.holdsBroken === holdCount, `wszystkie trzymania zerwane (${brk.holdsBroken}/${holdCount})`);
ok(brk.holdsDone === 0, "zero utrzymanych");
ok(brk.counts.perfect > 0, "głowy trzymań i tak liczone jako trafienia");
ok(brk.score < perfect.score, "wynik niższy niż przy idealnym przebiegu");

console.log("\n· przebieg bierny (nic nie klikamy):");
const idle = await playthrough("idle");
ok(idle.scene === "results", "kończy się ekranem wyniku");
ok(idle.counts.miss === idle.song.notes.length, `same pudła (${idle.counts.miss})`);
ok(idle.score === 0, "wynik 0");
ok(idle.combo === 0, "combo 0");
ok(idle.rating() < 0.7, "runda niezaliczona przy samych pudłach");

// auto-domknięcie: trzymamy głowy, ale nigdy nie puszczamy palca
console.log("\n· trzymania bez puszczenia palca (auto-domknięcie na końcu):");
const noRelease = await playthrough("heads-only");
ok(noRelease.holdsDone === holdCount, `trzymania domknięte automatycznie (${noRelease.holdsDone}/${holdCount})`);
ok(noRelease.holdsBroken === 0, "żadne nie zerwane");

// smoke: każdy ekran rysuje się bez wyjątku
console.log("\n· render wszystkich ekranów:");
const gr = new Game();
await new Promise((r) => setTimeout(r, 5));
for (const sc of ["loading", "auth", "nick", "menu", "songs", "boards", "board", "results", "play"]) {
  gr.scene = sc;
  gr.render(ctx);
}
ok(true, "wszystkie ekrany renderują się bez błędu");

// rejestracja → nick
console.log("\n· rejestracja / ranking:");
localStorage.removeItem("denis.account");
const ga = new Game();
await new Promise((r) => setTimeout(r, 5));
ok(ga.scene === "auth", "bez konta start na ekranie rejestracji");
ga.onPress(-1, 360, 620); // ZALOGUJ
ok(ga.scene === "nick", "po zalogowaniu ekran 'Twój nick'");

// ranking: wynik trafia do tablicy, liczy się miejsce
const { submitScore, myEntry, topN, gapToTop } = await import("../src/leaderboard.ts");
localStorage.removeItem("denis.board.to-ty");
const rank = submitScore("to-ty", 250000);
ok(rank >= 1, `wynik ma miejsce w rankingu (#${rank})`);
ok(myEntry("to-ty")?.score === 250000, "moj wynik w tablicy");
ok(topN("to-ty", 10).length === 10, "tablica ma top 10");
ok(gapToTop("to-ty", 10) >= 0, "policzony dystans do top 10");
const rank2 = submitScore("to-ty", 1500000);
ok(rank2 <= rank, "lepszy wynik = wyzsze miejsce");

// nawigacja menu → songs → menu i oznaczanie „poznanych"
const gn = new Game();
await new Promise((r) => setTimeout(r, 5));
gn.scene = "menu";
gn.onPress(-1, 255, 742); // Poznane Utwory (lewy chip)
ok(gn.scene === "songs", "klik w Poznane Utwory otwiera kolekcje");
gn.onPress(-1, 60, 66); // wroc
ok(gn.scene === "menu", "przycisk Wroc wraca do menu");
gn.onPress(-1, 465, 742); // Tablice wyników (prawy chip)
ok(gn.scene === "boards", "klik w Tablice wyników otwiera ranking");
gn.onPress(-1, 60, 66);
ok(gn.scene === "menu", "wroc z tablic do menu");
ok(new Game().discoveredCount() >= 1, "zagrany utwor jest oznaczony jako poznany");

// kolejność rund + "Kolejna runda" po zaliczeniu
const { nextRound } = await import("../src/songs.ts");
ok(nextRound("pan-mlody") === "panna-mloda", "runda 1 -> runda 2");
ok(nextRound("panna-mloda") === "ksiaze-z-bajki", "runda 2 -> runda 3");
ok(nextRound("to-ty") === null, "po ostatniej rundzie brak kolejnej");
{
  const gp = new Game();
  gp.trackId = "panna-mloda";
  await new Promise((r) => setTimeout(r, 5));
  await gp.startPlay();
  gp.score = 999999;
  gp.parScore = 1000;
  gp.finish();
  gp.resultsAt = performance.now() - 5000; // po animacji
  gp.onPress(-1, 360, 1060); // KOLEJNA RUNDA
  await new Promise((r) => setTimeout(r, 5));
  ok(gp.trackId === "ksiaze-z-bajki", "przycisk Kolejna runda przełącza na następny utwór");
}

console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
