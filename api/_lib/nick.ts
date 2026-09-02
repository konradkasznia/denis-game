// Filtr nicków: nazwy zarezerwowane + podstawowy filtr wulgaryzmów (PL + EN).
// Nick jest widoczny publicznie w rankingu, więc walidujemy przy rejestracji
// i przy zmianie nazwy wyświetlanej.

const RESERVED = new Set([
  "denis",
  "denisimpulsywni",
  "impulsywni",
  "admin",
  "administrator",
  "moderator",
  "mod",
  "root",
  "system",
  "support",
  "kontakt",
  "official",
  "oficjalny",
  "grzegorztymoczko",
  "null",
  "undefined",
  "anonymous",
  "gracz",
  "guest",
  "gosc",
]);

// baza — do rozbudowy w razie potrzeby
const PROFANITY = [
  "kurwa",
  "chuj",
  "chuja",
  "chuje",
  "pierdol",
  "jebac",
  "jebal",
  "jebana",
  "jebany",
  "jebie",
  "spierdalaj",
  "wypierdalaj",
  "pizda",
  "pizdy",
  "cipa",
  "cwel",
  "skurwiel",
  "skurwysyn",
  "kutas",
  "huj",
  "dziwka",
  "szmata",
  "pedal",
  "zjeb",
  "ciota",
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "whore",
  "asshole",
  "pussy",
  "nazi",
  "hitler",
  "kys",
];

/** Normalizuje do porównań: bez ogonków, bez leet-speak, tylko litery. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[0@]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}

export function nickAllowed(nick: string): { ok: true } | { ok: false; error: string } {
  const raw = String(nick || "").trim();
  const n = norm(raw);
  if (!n) return { ok: true }; // pusty nick = brak nazwy wyświetlanej (dozwolone przy zmianie)
  if (RESERVED.has(raw.toLowerCase().replace(/[\s._-]/g, "")) || RESERVED.has(n)) {
    return { ok: false, error: "Ten nick jest zarezerwowany. Wybierz inny." };
  }
  for (const w of PROFANITY) {
    if (n.includes(w)) return { ok: false, error: "Nick zawiera niedozwolone słowo." };
  }
  return { ok: true };
}
