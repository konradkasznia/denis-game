// Test integracyjny: pełny przebieg rozgrywki na zaślepkach (bez canvasu/audio).
// Uruchamia prawdziwą pętlę update()/render() klasy Game przez ~63 s wirtualnego
// czasu przy 60 fps i sprawdza, że mechanika liczy się poprawnie.
//
//   node --experimental-strip-types test/integration.test.mjs

// --- uniwersalna zaślepka (dowolny .method() / .prop = x nie wybucha) ---
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

async function playthrough(strategy) {
  const g = new Game();
  await new Promise((r) => setTimeout(r, 5)); // wczytanie obrazka → menu
  await g.startPlay();
  const ac = g.audio.ctx;

  const dt = 1 / 60;
  let frame = 0;
  const maxFrames = 60 * 90;
  while (g.scene !== "results" && frame < maxFrames) {
    ac._t += dt;
    g.update(dt, frame * 16.67);
    if (strategy === "perfect") {
      const st = g.songTime;
      for (const n of g.song.notes) {
        if (!n.judged && st >= n.time && st - n.time < dt) {
          g.onTap({ x: -1, y: -1, lane: n.lane });
        }
      }
    }
    g.render(ctx);
    frame++;
  }
  return g;
}

console.log("· przebieg idealny:");
const perfect = await playthrough("perfect");
ok(perfect.scene === "results", "kończy się ekranem wyniku");
ok(perfect.counts.miss === 0, `zero pudeł (${perfect.counts.miss})`);
ok(perfect.counts.perfect > 100, `dużo PERFECT (${perfect.counts.perfect})`);
ok(perfect.judgedCount === perfect.song.notes.length, "wszystkie nuty ocenione");
ok(perfect.score > 40000, `wysoki wynik (${perfect.score})`);
ok(perfect.maxCombo === perfect.song.notes.length, `pełne combo (${perfect.maxCombo})`);
ok(perfect.accuracy() > 0.99, `celność ~100% (${(perfect.accuracy() * 100).toFixed(1)}%)`);
ok(Number(localStorage.getItem("denis.best")) === perfect.score, "rekord zapisany");

console.log("· przebieg bierny (nic nie klikamy):");
const idle = await playthrough("idle");
ok(idle.scene === "results", "kończy się ekranem wyniku");
ok(idle.counts.miss === idle.song.notes.length, `same pudła (${idle.counts.miss})`);
ok(idle.score === 0, "wynik 0");
ok(idle.combo === 0, "combo 0");

console.log(fail === 0 ? "\nOK" : `\n${fail} błędów`);
process.exit(fail === 0 ? 0 : 1);
