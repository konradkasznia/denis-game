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
  ok(g.scene === "play" && g.audio.running, mode + ": gra startuje od razu po GRAJ!");
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
const acc = perfect.accSum / perfect.judgedCount;
ok(acc > 0.99, `celność ~100% (${(acc * 100).toFixed(1)}%)`);
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
for (const sc of ["loading", "auth", "hits", "board", "rewards", "profile", "results", "play"]) {
  gr.scene = sc;
  gr.render(ctx);
}
gr.soundModal = true;
gr.render(ctx);
gr.soundModal = false;
ok(true, "wszystkie ekrany renderują się bez błędu");

// rejestracja: login + hasło (bez e-maila, bez ekranu nicku)
console.log("\n· rejestracja / ranking:");
localStorage.removeItem("denis.account");
localStorage.removeItem("denis.users");
localStorage.removeItem("denis.token");
const ga = new Game();
await new Promise((r) => setTimeout(r, 5));
ok(ga.scene === "auth" && ga.authMode === "register", "bez konta start na ekranie PIERWSZY RAZ");
ga.authLogin = "TestGracz";
ga.authPassword = "haslo12345";
ga.onPress(1, 360, 618); // STWÓRZ KONTO bez zgody -> blokada
await new Promise((r) => setTimeout(r, 5));
ok(ga.scene === "auth" && !!ga.authError, "rejestracja bez zgody na regulamin zablokowana");
ga.onPress(1, 360, 500); // checkbox: akceptuję regulamin
ga.onPress(1, 360, 618); // STWÓRZ KONTO
await new Promise((r) => setTimeout(r, 5));
ok(ga.scene === "hits", "po rejestracji z akceptacją -> od razu WYBIERZ HIT");
const savedAcc = JSON.parse(localStorage.getItem("denis.account"));
ok(savedAcc.terms === true && savedAcc.login === "TestGracz", "konto zapisane z loginem i akceptacją");
const { login: apiLogin2 } = await import("../src/authApi.ts");
const bad = await apiLogin2("TestGracz", "zlehaslo1");
ok(bad.ok === false, "logowanie ze złym hasłem odrzucone");
const good = await apiLogin2("testgracz", "haslo12345");
ok(good.ok === true, "logowanie z poprawnym hasłem OK (login bez rozróżniania wielkości liter)");

// ranking: wynik trafia do tablicy, liczy się miejsce
const { submitScore, myEntry, topN, gapToTop } = await import("../src/leaderboard.ts");
localStorage.removeItem("denis.board.pogrzebowka");
const rank = submitScore("pogrzebowka", 250000);
ok(rank >= 1, `wynik ma miejsce w rankingu (#${rank})`);
ok(myEntry("pogrzebowka")?.score === 250000, "moj wynik w tablicy");
ok(topN("pogrzebowka", 10).length === 10, "tablica ma top 10");
ok(gapToTop("pogrzebowka", 10) >= 0, "policzony dystans do top 10");
const rank2 = submitScore("pogrzebowka", 1500000);
ok(rank2 <= rank, "lepszy wynik = wyzsze miejsce");

// nawigacja: modal dźwięku → WYBIERZ HIT → tablica / nagrody / profil
localStorage.setItem("denis.account", JSON.stringify({ login: "Test", nick: "", terms: true, method: "login" }));
const gn = new Game();
await new Promise((r) => setTimeout(r, 5));
ok(gn.scene === "hits" && gn.soundModal === true, "po wczytaniu: modal dźwięku nad karuzelą");
gn.onPress(-1, -1, -1); // ROZUMIEM
ok(gn.soundModal === false && gn.scene === "hits", "modal zamyka się, zostaje WYBIERZ HIT");
gn.onPress(1, 80, 1140); // WYNIKI (lewy przycisk dolnego rzędu)
ok(gn.scene === "board", "WYNIKI otwiera tablicę utworu");
gn.onPress(-1, 60, 66); // WRÓĆ
ok(gn.scene === "hits", "WRÓĆ z tablicy wraca do karuzeli");
gn.onPress(1, 640, 1140); // NAGRODY (prawy przycisk)
ok(gn.scene === "rewards", "NAGRODY otwiera ekran nagród");
gn.onPress(-1, 60, 1120); // POWRÓT
ok(gn.scene === "hits", "POWRÓT z nagród wraca do karuzeli");
gn.onPress(1, 665, 60); // zębatka (prawy górny róg)
ok(gn.scene === "profile", "zębatka otwiera profil");

// progresja: poziom 2 zablokowany dopóki poziom 1 nie ma 4 gwiazdek
const { bestStars, levelUnlocked, recordStars } = await import("../src/songs.ts");
localStorage.removeItem("denis.stars");
ok(levelUnlocked(0) === true && levelUnlocked(1) === false, "start: gra się tylko poziom 1");
recordStars("panna-mloda", 4);
ok(bestStars("panna-mloda") === 4, "zapis gwiazdek");
ok(levelUnlocked(1) === true, "4 gwiazdki na poziomie 1 odblokowują poziom 2");

// kolejność rund
const { nextRound } = await import("../src/songs.ts");
ok(nextRound("panna-mloda") === "ksiaze-z-bajki", "runda 1 -> runda 2");
ok(nextRound("pogrzebowka") === null, "po ostatniej rundzie brak kolejnej");
{
  // KONTYNUUJ po zaliczeniu -> ekran wyboru, ustawiony na następny poziom
  localStorage.setItem("denis.stars", JSON.stringify({ "panna-mloda": 5, "ksiaze-z-bajki": 5 }));
  const gp = new Game();
  gp.trackId = "panna-mloda";
  await new Promise((r) => setTimeout(r, 5));
  await gp.startPlay();
  gp.score = 999999;
  gp.parScore = 1000;
  gp.finish();
  gp.resultsAt = performance.now() - 5000; // po animacji
  gp.onPress(-1, 360, 1200); // KONTYNUUJ
  await new Promise((r) => setTimeout(r, 5));
  ok(gp.scene === "hits" && gp.hitIndex === 1, "KONTYNUUJ po zaliczeniu -> wybór, następny poziom");
}
{
  // KONTYNUUJ po porażce -> ekran wyboru, ten sam poziom
  const gf = new Game();
  gf.trackId = "ksiaze-z-bajki";
  await new Promise((r) => setTimeout(r, 5));
  await gf.startPlay();
  gf.score = 0;
  gf.parScore = 1000;
  gf.finish();
  gf.resultsAt = performance.now() - 5000;
  gf.onPress(-1, 360, 1200);
  await new Promise((r) => setTimeout(r, 5));
  ok(gf.scene === "hits" && gf.hitIndex === 1, "KONTYNUUJ po porażce -> wybór, ten sam poziom");
}

console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
