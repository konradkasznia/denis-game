import { isUnlocked, UNLOCK_COST } from "./coins.ts";
import { LEMON_ROUND, lemonCount, LEMONS_NEEDED } from "./lemons.ts";
import { WEDDING, WEDDING_AFTER } from "./wedding.ts";

// Rejestr utworów + śledzenie, które gracz już „poznał".
//
// Docelowo każdy wpis dostaje własny plik audio, beatmapę (chart) i okładkę
// w `public/assets/covers/<id>.jpg`. Na razie grywalny jest tylko podkład
// testowy; reszta to zablokowane „tajemnice", żeby pokazać ekran kolekcji.

export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  /** kolor akcentu / proceduralnej okładki, gdy brak pliku */
  accent: string;
  /** ścieżka do okładki (opcjonalnie), np. "assets/covers/xxx.jpg" */
  cover?: string;
  /** link do utworu w Spotify */
  spotifyUrl?: string;
  /** czy mamy komplet do zagrania (audio + chart) */
  playable: boolean;
  /** poziom testowy — widoczny/grywalny tylko na koncie dewelopera (login Konrad) */
  devOnly?: boolean;
  /** runda weselna — widoczna tylko dla zaproszonych (i konta dewelopera) */
  inviteOnly?: boolean;
  /** schowana przed WSZYSTKIMI (także kontami deweloperskimi) — do odsłonięcia później */
  hidden?: boolean;
}

// Kolejność = kolejność rund. „Kolejna runda" prowadzi do następnego playable.
// „Pan Młody" chwilowo wyłączony — skupiamy się na dopracowaniu „Panna Młoda".
// Chart + mp3 zostają w repo (public/charts/pan-mlody.json, assets/songs/), żeby
// łatwo przywrócić: wystarczy dodać wpis z powrotem.
export const SONGS: SongMeta[] = [
  {
    id: "panna-mloda",
    title: "Panna Młoda",
    artist: "Denis",
    accent: "#ff5e7e",
    spotifyUrl: "https://open.spotify.com/track/5xRECw5U5q3feZ63AMPOYZ",
    playable: true,
  },
  {
    id: "ksiaze-z-bajki",
    title: "Książę z bajki",
    artist: "Denis",
    accent: "#8ab6ff",
    spotifyUrl: "https://open.spotify.com/track/2rqt00ehpIhLjxuy2OTPa7",
    playable: true,
  },
  {
    // runda 3: mini-gra „Pociąg weselny" (Snake na sali weselnej, src/train.ts)
    id: "pociag-weselny",
    title: "A Ty teraz tańcz!",
    artist: "Denis",
    accent: "#ffd6e0",
    playable: true,
  },
  {
    id: "pogrzebowka",
    title: "Pogrzebówka",
    artist: "Denis",
    accent: "#ffd24c",
    spotifyUrl: "https://open.spotify.com/track/69CAp6C1Uj31gDryQJHdyl",
    playable: true,
  },
  {
    id: "pani-policjantko",
    title: "Pani policjantko",
    artist: "Denis",
    accent: "#8ab6ff",
    spotifyUrl: "https://open.spotify.com/track/1aIjxCDYeK0oECqNYMk9Cx",
    playable: true,
  },
  {
    id: "byleby-nie-byla-ciepla",
    title: "Byleby nie była ciepła",
    artist: "Denis",
    accent: "#7fd4ff",
    spotifyUrl: "https://open.spotify.com/track/2SlIvA9k1wAsOX0dBnuRBO",
    playable: true,
  },
  {
    id: "pan-strazak",
    title: "Pan strażak",
    artist: "Denis",
    accent: "#ff9f43",
    spotifyUrl: "https://open.spotify.com/track/2AgxGvvM3Bg3fnXDAmUjhP",
    playable: true,
  },
  {
    id: "wodka-cytrynowka",
    title: "Wódka Cytrynówka",
    artist: "Denis",
    accent: "#e8f53a",
    spotifyUrl: "https://open.spotify.com/track/3PWrBc88jjw3fbSvhZrNEj",
    playable: true,
    // zwykły poziom (numeracja, progresja): po przejściu poprzedniego
    // poziomu odblokowanie za 5 cytryn + 500 monet
  },
  {
    id: "pan-mlody",
    title: "Pan Młody",
    artist: "Denis",
    accent: "#ffd6e0",
    spotifyUrl: "https://open.spotify.com/track/5Qjs6MBqkJYIxnGmt1HxBa",
    playable: true,
    // runda bonusowa z zaproszeniem (akcja na TikToku, api/invite.ts)
    inviteOnly: true,
  },
  {
    id: "wesele-trwa",
    title: "Wesele trwa",
    artist: "Denis",
    accent: "#ff9fc0",
    playable: true,
    // odblokowuje koperta >= 1000 monet w rundzie Pan Młody
    inviteOnly: true,
    hidden: true, // na razie schowana (premiera później)
  },
];

/** Czy runda ma się w ogóle pokazywać na karuzeli temu graczowi. */
export function songVisible(s: SongMeta | undefined): boolean {
  if (!s) return false;
  if (s.hidden) return false;
  if (s.devOnly) return devUnlocked();
  // Pan Młody: widoczny dla wszystkich; bez zaproszenia zamiast GRAJ! jest
  // „ZAPROSZENIE WESELNE" (film na TikToku). Wesele trwa: po zaproszeniu.
  if (s.id === WEDDING) return true;
  if (s.inviteOnly) return devUnlocked() || isUnlocked(WEDDING);
  return true;
}

/** Najbliższa widoczna runda od `from` w kierunku `dir` (albo -1). */
export function visibleStep(from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < SONGS.length; i += dir) {
    if (songVisible(SONGS[i])) return i;
  }
  return -1;
}

/** Konto dewelopera (i oficjalne konto Denisa) — odblokowuje poziomy oznaczone `devOnly`. */
export function devUnlocked(): boolean {
  try {
    const l = (localStorage.getItem("denis.login") || "").trim().toLowerCase();
    // konta deweloperskie + oficjalne konto Denisa — widzą rundy testowe (devOnly)
    return l === "konrad" || l === "konraddd" || l === "denisimpulsywni";
  } catch {
    return false;
  }
}

/** Następna runda po utworze `id` (albo null, gdy to ostatnia). */
export function nextRound(id: string): string | null {
  const i = SONGS.findIndex((s) => s.id === id);
  for (let j = i + 1; j < SONGS.length; j++) {
    const s = SONGS[j];
    if (s.playable && songVisible(s)) return s.id;
  }
  return null;
}

export function spotifyUrl(id: string): string | undefined {
  return SONGS.find((s) => s.id === id)?.spotifyUrl;
}

const KEY = "denis.discovered";

export function discoveredIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function markDiscovered(id: string) {
  const s = discoveredIds();
  if (s.has(id)) return;
  s.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export function isDiscovered(id: string): boolean {
  return discoveredIds().has(id);
}

// ---- progresja poziomów --------------------------------------------------
//
// Poziom N+1 odblokowuje się, gdy poziom N zostanie choć raz przejechany do
// końca (patrz prevRoundCleared/markCompleted) — bez progu punktowego/gwiazdek.
// Gwiazdki (niżej) zostają jako sama ocena jakości przebiegu na karuzeli/wynikach.

const STARS_KEY = "denis.stars";
export const UNLOCK_STARS = 4;

function starsMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STARS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function bestStars(id: string): number {
  return starsMap()[id] ?? 0;
}

export function recordStars(id: string, stars: number) {
  const m = starsMap();
  const s = Math.max(0, Math.min(5, Math.round(stars)));
  if (s <= (m[id] ?? 0)) return;
  m[id] = s;
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** Scala postęp gwiazdkowy z serwera (z /api/auth/me) do lokalnej mapy —
 *  bierze wyższą wartość per utwór. Wołane po starcie i po zalogowaniu, żeby
 *  odblokowane poziomy wróciły po wyczyszczeniu localStorage / na nowym telefonie. */
export function mergeServerStars(server: Record<string, { stars?: number }>): void {
  const m = starsMap();
  let changed = false;
  for (const [id, v] of Object.entries(server || {})) {
    const s = Math.max(0, Math.min(5, Math.round(v?.stars ?? 0)));
    if (s > (m[id] ?? 0)) {
      m[id] = s;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

const COMPLETED_KEY = "denis.completed";

function completedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COMPLETED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** Odnotowuje, że runda została przejechana do końca (wołane z finish()).
 *  Zwraca `true`, gdy to PIERWSZE ukończenie tego utworu (do komunikatu
 *  „Odblokowano kolejny poziom!" na ekranie podsumowania). */
export function markCompleted(id: string): boolean {
  const s = completedIds();
  if (s.has(id)) return false;
  s.add(id);
  try {
    localStorage.setItem(COMPLETED_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
  return true;
}

/** Czy poprzedni poziom został choć raz przejechany do końca (bez progu punktowego). */
function prevRoundCleared(index: number): boolean {
  // poprzedni ZWYKŁY poziom — rundy bonusowe (Pogrzebówka, Pan Młody) i schowane
  // nie blokują progresji
  let p = index - 1;
  while (p > 0 && (isBonusRound(SONGS[p]?.id) || SONGS[p]?.hidden)) p--;
  const prev = SONGS[p];
  if (!prev || p >= index) return false;
  // completedIds() to nowy zapis (od wprowadzenia progresji bez progu). Gracze,
  // którzy przeszli poziom WCZEŚNIEJ (stary kod, bez tego zapisu) mieliby go
  // teraz zablokowanego mimo realnego ukończenia — bestStars > 0 zawsze
  // oznacza dojechaną do końca rundę (recordStars leci tylko z finish()),
  // więc to samo w sobie wystarcza jako dowód ukończenia z dowolnej przeszłości.
  return completedIds().has(prev.id) || bestStars(prev.id) > 0;
}

/** Runda odblokowywana zakupem za monety (albo zaproszeniem na wesele),
 *  a nie samym przejściem poprzedniego poziomu. */
export function isPaidRound(id: string | undefined): boolean {
  return !!id && (!!UNLOCK_COST[id] || id === WEDDING || id === WEDDING_AFTER);
}

/** Płatne rundy liczone jak ZWYKŁE poziomy (numer „POZIOM N", progresja),
 *  mimo zakupu: Wódka Cytrynówka (5 cytryn + monety). */
const COUNTED_PAID = new Set<string>([LEMON_ROUND]);

/** Runda BONUSOWA (poza główną numeracją poziomów — patrz levelNumber),
 *  np. Pogrzebówka, Pan Młody. */
export function isBonusRound(id: string | undefined): boolean {
  return isPaidRound(id) && !COUNTED_PAID.has(id!);
}

/** Czy cytryny mają się pojawiać w rundach (runda-cel widoczna dla gracza). */
export function lemonsActive(): boolean {
  const target = SONGS.find((s) => s.id === LEMON_ROUND);
  return !!target && (!target.devOnly || devUnlocked());
}

/** Runda czeka jeszcze na cytryny (przycisk „Zbierz cytryny i 500 monet").
 *  Dopiero po przejściu poprzedniego poziomu (wcześniej: „przejdź poprzedni"). */
export function lemonGated(index: number): boolean {
  const id = SONGS[index]?.id;
  return id === LEMON_ROUND && !isUnlocked(id) && lemonCount() < LEMONS_NEEDED && progressOk(index);
}

/** Płatna runda liczona jak zwykły poziom wymaga też przejścia poprzedniego
 *  (konta deweloperskie omijają bramkę, żeby dało się testować). */
function progressOk(index: number): boolean {
  const id = SONGS[index]?.id;
  if (!id || !COUNTED_PAID.has(id) || devUnlocked()) return true;
  return prevRoundCleared(index);
}

/** Czy poziom o danym indeksie w SONGS można zagrać. */
export function levelUnlocked(index: number): boolean {
  if (index <= 0) return true;
  const id = SONGS[index]?.id;
  if (!songVisible(SONGS[index])) return false;
  // runda bonusowa omija bramkę progresji, liczy się tylko zakup (coins.ts) —
  // także testowa (Wódka Cytrynówka), żeby dało się sprawdzić całą ścieżkę
  if (isPaidRound(id)) return isUnlocked(id!) && progressOk(index);
  if (SONGS[index]?.devOnly) return true; // poziom testowy — omija progresję
  // konta deweloperskie (konrad, DenisImpulsywni): ich wyniki nie trafiają na serwer,
  // więc postęp nie przetrwałby wylogowania / czyszczenia Safari — zwykłe poziomy
  // są dla nich zawsze otwarte (rundy płatne i weselne dalej wymagają zakupu/zaproszenia)
  if (devUnlocked()) return true;
  // kto już kiedyś ten poziom ukończył, nie traci do niego dostępu, gdy przed nim
  // dojdzie nowa runda (np. Pociąg weselny wstawiony jako runda 3)
  if (completedIds().has(id!) || bestStars(id!) > 0) return true;
  if (!prevRoundCleared(index)) return false;
  return true;
}

// ---- „ODBLOKUJ" nowo dostępnego poziomu ----------------------------------
//
// Gdy gracz zdobędzie dostęp do kolejnego poziomu (przejdzie poprzedni), poziom
// na karuzeli jest jeszcze szary z przyciskiem „ODBLOKUJ" — stuknięcie odpala
// konfetti i dopiero wtedy kolor + GRAJ!. Raz na poziom. Poziom, w który gracz
// już kiedyś grał (discovered / gwiazdki, też z serwera), nie wymaga odsłonięcia.

const REVEALED_KEY = "denis.revealed";

function revealedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(REVEALED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** Czy poziom czeka na „ODBLOKUJ" (dostępny, ale jeszcze nieodsłonięty). */
export function needsReveal(index: number): boolean {
  const s = SONGS[index];
  if (!s || index <= 0 || !s.playable || s.devOnly || s.inviteOnly) return false;
  if (isPaidRound(s.id)) return false; // rundy płatne mają własne odblokowanie
  if (devUnlocked()) return false; // konta deweloperskie: bez „ODBLOKUJ" na każdym poziomie
  if (!levelUnlocked(index)) return false;
  if (isDiscovered(s.id) || bestStars(s.id) > 0) return false;
  return !revealedIds().has(s.id);
}

export function markRevealed(id: string): void {
  const s = revealedIds();
  if (s.has(id)) return;
  s.add(id);
  try {
    localStorage.setItem(REVEALED_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Ile monet potrzeba, by odblokować ten poziom TERAZ (0 = nie dotyczy /
 *  już odblokowany). Rundy bonusowe można kupić w dowolnym momencie. */
export function coinUnlockPrice(index: number): number {
  const id = SONGS[index]?.id;
  if (!isPaidRound(id) || isUnlocked(id!)) return 0;
  if (!progressOk(index)) return 0; // najpierw „przejdź poprzedni poziom"
  if (!songVisible(SONGS[index])) return 0;
  return UNLOCK_COST[id!] ?? 0;
}

/** Numer „POZIOM N" do wyświetlenia — liczy tylko utwory NIE-bonusowe, żeby
 *  runda bonusowa (Pogrzebówka) nie przesuwała numeracji kolejnych poziomów
 *  (Pani policjantko zostaje „POZIOM 3", mimo że w SONGS jest na indeksie 3). */
export function levelNumber(index: number): number {
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (!isBonusRound(SONGS[i]?.id)) n++;
  }
  return n;
}

/** Ile kolejnych poziomów od początku zaliczono na >= UNLOCK_STARS gwiazdek. */
export function clearedStreak(): number {
  let n = 0;
  for (const s of SONGS) {
    if (bestStars(s.id) >= UNLOCK_STARS) n++;
    else break;
  }
  return n;
}
